import { Alert, Button, Input, Modal, QRCode, Space, Spin, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { api, APIError, post, type Publication } from "./api";
import {
  cloudEffectiveState,
  cloudMiniappSchemeURL,
  preserveCloudLaunch,
} from "./mobile-model";
import type { MobileSession, MobileState } from "./mobile-types";
import "./mobile-publish.css";
import DouyinPreview from "./DouyinPreview";

export function canPublishOnPhone(p: Publication): boolean {
  return (
    ((p.target_platform === "douyin" &&
      p.kind === "video" &&
      p.asset_ids.length === 1) ||
      ((!p.target_platform || p.target_platform === "xhs") &&
        (p.kind === "image" || (p.kind === "video" && p.asset_ids.length === 1)))) &&
    p.ready &&
    p.manual_status !== "published" &&
    !p.deleted_at &&
    !p.published_at &&
    !p.remote_work_id &&
    (!p.online_state || p.online_state === "failed")
  );
}

const labels: Record<MobileState, string> = {
  created: "等待手机扫码",
  scanned: "手机已打开稿件",
  claimed: "手机已接收稿件",
  editor_opened: "已交接到手机",
  cancelled: "二维码已撤销",
  expired: "二维码已过期",
  unknown: "上传结果待确认",
};

export default function MobilePublishDialog({
  publication,
  onClose,
}: {
  publication: Publication;
  onClose: () => void;
}) {
  const douyin = publication.target_platform === "douyin";
  const path = `/publications/${encodeURIComponent(publication.id)}/${douyin ? "douyin-handoff" : "mobile-handoff"}`;
  const [capability, setCapability] = useState<{
    available: boolean;
    reason?: string;
    note?: string;
    launch_environment?: string;
  }>();
  const [session, setSession] = useState<MobileSession>();
  const development =
    douyin && capability?.launch_environment === "development";
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const running = useRef(false);
  const requestID = useRef("");
  const alive = useRef(true);
  const effectiveState = session && cloudEffectiveState(session, now);
  const active =
    !!session && effectiveState !== "expired" && effectiveState !== "cancelled";
  const qrURL =
    effectiveState === "created" ? cloudMiniappSchemeURL(session) : undefined;
  const qrImage =
    effectiveState === "created" &&
    /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(
      session?.qr_image || "",
    )
      ? session?.qr_image
      : undefined;

  useEffect(() => {
    alive.current = true;
    const load = async () => {
      try {
        const [cap, previous] = await Promise.all([
          api<{
            available: boolean;
            reason?: string;
            note?: string;
            launch_environment?: string;
          }>(douyin ? "/miniapp/douyin/cloud" : "/miniapp/cloud"),
          api<MobileSession>(path).catch((e) => {
            if (e instanceof APIError && e.status === 404) return undefined;
            throw e;
          }),
        ]);
        if (alive.current) {
          setCapability(cap);
          setSession(previous);
        }
      } catch (e) {
        if (alive.current) setError((e as Error).message);
      } finally {
        if (alive.current) setLoading(false);
      }
    };
    void load();
    return () => {
      alive.current = false;
    };
  }, [path]);

  // Only status is polled, while the dialog is visible. No repeated upload,
  // native editor launch or publication-success mutation occurs here.
  useEffect(() => {
    if (!active || busy) return;
    let stopped = false;
    let polling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (stopped || document.hidden || polling) return;
      polling = true;
      try {
        const next = await api<MobileSession>(path);
        if (!stopped) {
          setSession((previous) => preserveCloudLaunch(previous, next));
          setError("");
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      } finally {
        polling = false;
        if (!stopped) {
          setNow(Date.now());
          if (!document.hidden) timer = setTimeout(poll, 2000);
        }
      }
    };
    const visible = () => {
      clearTimeout(timer);
      if (!document.hidden) {
        setNow(Date.now());
        void poll();
      }
    };
    const clock = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    document.addEventListener("visibilitychange", visible);
    timer = setTimeout(poll, 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [active, busy, path]);

  const generate = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      if (effectiveState === "expired" || effectiveState === "cancelled")
        requestID.current = "";
      if (!requestID.current) {
        if (typeof crypto.randomUUID !== "function")
          throw new Error("请通过 HTTPS 或本机地址打开工作台后再生成二维码");
        requestID.current = crypto.randomUUID().replaceAll("-", "");
      }
      const next = await post<MobileSession>(path, {
        request_id: requestID.current,
      });
      if (alive.current) {
        setSession(next);
        setNow(Date.now());
      }
      requestID.current = "";
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        try {
          const next = await api<MobileSession>(path);
          if (alive.current) setSession(next);
        } catch {
          /* Original failure remains visible. */
        }
      }
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const revoke = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await post<MobileSession>(path + "/cancel");
      if (alive.current) setSession(next);
      requestID.current = "";
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="手机扫码发布"
      onCancel={onClose}
      footer={null}
      width={500}
      destroyOnHidden
      maskClosable={!busy}
      closable={!busy}
    >
      <div className="mobile-publish-dialog">
        <div
          className="mobile-handoff-steps"
          role="list"
          aria-label="手机发布步骤"
        >
          {["准备内容", "手机打开", "手机核对"].map((label, index) => {
            const step = ["scanned", "claimed", "editor_opened"].includes(
              effectiveState || "",
            )
              ? effectiveState === "editor_opened"
                ? 2
                : 1
              : 0;
            return (
              <div
                role="listitem"
                key={label}
                className={index === step ? "current" : ""}
                aria-current={index === step ? "step" : undefined}
              >
                <b>{index + 1}</b>
                {label}
              </div>
            );
          })}
        </div>
        {loading ? (
          <Spin />
        ) : (
          <>
            {capability && !capability.available && (
              <Alert
                type="warning"
                showIcon
                message={capability.reason || "手机发布尚未配置"}
              />
            )}
            {error && <Alert type="error" showIcon message={error} />}
            {douyin && capability?.note && (
              <Alert type="info" showIcon message={capability.note} />
            )}
            {douyin && publication.cover_id && (
              <Alert
                type="info"
                message="视频封面请在抖音发布界面选择，本次不会带入自选封面。"
              />
            )}
            {session?.qr_error && (
              <Alert type="warning" showIcon message={session.qr_error} />
            )}
            {session && effectiveState !== "created" && (
              <Tag color={active ? "processing" : "default"}>
                {douyin && effectiveState === "editor_opened"
                  ? "手机已发起发布，结果待核实"
                  : labels[effectiveState!]}
              </Tag>
            )}
            {qrURL && (
              <div className="mobile-publish-qr">
                <QRCode value={qrURL} size={232} />
                <p>
                  用小红书扫一扫 ·{" "}
                  {Math.max(
                    0,
                    Math.ceil((Date.parse(session!.expires_at) - now) / 1000),
                  )}{" "}
                  秒后过期
                </p>
              </div>
            )}
            {qrImage && (
              <div className="mobile-publish-qr">
                <img
                  src={qrImage}
                  width={232}
                  height={232}
                  alt="抖音扫码发布二维码"
                />
                <p>
                  用抖音扫一扫 ·{" "}
                  {Math.max(
                    0,
                    Math.ceil((Date.parse(session!.expires_at) - now) / 1000),
                  )}{" "}
                  秒后任务过期
                </p>
              </div>
            )}
            {development &&
              effectiveState === "created" &&
              /^pages\/publish\/index\?ticket=[A-Za-z0-9_-]{24,512}$/.test(
                session?.launch_path || "",
              ) && (
                <>
                  <DouyinPreview
                    key={session!.id}
                    launchPath={session!.launch_path!}
                    expiresAt={session!.expires_at}
                  />
                  <Alert
                    type="info"
                    message="任务已上传，请使用开发者工具预览"
                    description="启动页面选择 pages/publish/index，填入下面的启动参数。进入场景选扫一扫，生成预览码后用手机抖音扫描。请勿将参数分享给他人。"
                  />
                  <Input.TextArea
                    aria-label="抖音调试启动参数"
                    readOnly
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    value={
                      session!.launch_path!.split("?")[1] + "&manualClaim=1"
                    }
                  />
                  <p>
                    剩余{" "}
                    {Math.max(
                      0,
                      Math.ceil((Date.parse(session!.expires_at) - now) / 1000),
                    )}{" "}
                    秒；过期后撤销并重新创建任务。
                  </p>
                </>
              )}
            {effectiveState === "created" &&
              !qrURL &&
              !qrImage &&
              !session?.qr_error &&
              !session?.launch_path && (
                <Alert
                  type="info"
                  showIcon
                  message={
                    development
                      ? "当前任务的启动参数关闭或刷新后不会恢复。请撤销任务后重新创建。"
                      : "当前交接已有二维码，关闭或刷新后不会恢复。请撤销后重新生成。"
                  }
                />
              )}
            {effectiveState === "unknown" && (
              <Alert
                type="warning"
                showIcon
                message="上传结果尚未确认，为避免重复上传，请等待本次票据过期后重新生成。"
              />
            )}
            {["scanned", "claimed", "editor_opened"].includes(
              effectiveState || "",
            ) && (
              <Alert
                type="success"
                showIcon
                message="请在手机继续操作"
                description={
                  douyin
                    ? "手机端下载并检查视频，再点击「前往抖音发布」。请在抖音核对账号、封面和文案。"
                    : "小程序会复制标题、正文和标签。点击「发小红书」进入官方页面；如文案未带入，长按粘贴即可。"
                }
              />
            )}
            {douyin && session?.client_event === "client_publish_success" && (
              <Alert
                type="warning"
                showIcon
                message="手机返回发布成功，尚未取得平台核验结果；请在抖音核对作品后手动记录。"
              />
            )}
            {douyin &&
              session?.client_event === "client_publish_incomplete" && (
                <Alert
                  type="warning"
                  showIcon
                  message="手机报告发布未完成或已取消，请在手机核对后再试。"
                />
              )}
            <Space wrap className="mobile-publish-actions">
              {!active && (
                <Button
                  type="primary"
                  loading={busy}
                  disabled={
                    !capability?.available || !canPublishOnPhone(publication)
                  }
                  onClick={() => void generate()}
                >
                  {development
                    ? session
                      ? "重新创建调试任务"
                      : "创建调试任务"
                    : session
                      ? "重新生成二维码"
                      : "生成二维码"}
                </Button>
              )}
              {active && effectiveState !== "unknown" && (
                <Button disabled={busy} onClick={() => void revoke()}>
                  {development ? "撤销任务" : "撤销二维码"}
                </Button>
              )}
              <Button disabled={busy} onClick={onClose}>
                关闭
              </Button>
            </Space>
          </>
        )}
      </div>
    </Modal>
  );
}
