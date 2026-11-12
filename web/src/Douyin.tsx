import {
  Alert,
  App,
  Button,
  Image,
  Modal,
  Radio,
  Space,
  Spin,
  Tag,
} from "antd";
import { MobileOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { Job, Publication } from "./api";
import { api, date, fileURL, post } from "./api";
import { canPublishOnPhone } from "./MobilePublishDialog";
type Account = {
  user_id: string;
  username: string;
  is_logged_in: boolean;
  state: string;
  img?: string;
  main_verified: boolean;
  creator_verified: boolean;
};
type Preview = {
  token: string;
  expires_at: string;
  account: Account;
  title: string;
  caption: string;
  visibility: string;
  image: string;
  asset_ids: string[];
  cover_id: string;
};
const labels: Record<string, string> = {
  waiting_scan: "等待扫码",
  waiting_confirm: "已扫码，请在手机上点击确认",
  verifying: "验证中，正在核实创作者中心账号",
  verification_required: "需要在官方浏览器完成验证",
  success: "创作者中心已连接，可准备上传",
  expired: "二维码已过期",
  creator_connected: "创作者中心已登录，请点击检查账号",
  main_connected: "抖音主站已登录，创作者中心账号尚未核实",
  identity_mismatch: "请核对本次使用的创作者中心账号",
  unverified: "扫码会话未能核实账号",
  logged_out: "未连接",
  browser_open: "请在专用浏览器完成操作",
};
const states: Record<string, string> = {
  preparing: "正在上传准备",
  prepared: "待确认发布",
  manual_review: "待官网核对",
  submitting: "正在提交",
  submitted: "已提交／审核中",
  published: "已发布",
  rejected: "审核未通过",
  unknown: "发布结果不明",
  failed: "准备失败或已失效",
};
export default function Douyin({
  jobs,
  refresh,
  children,
  previewOnly = false,
  onPhone,
}: {
  children: (controls: {
    actions: (p: Publication) => ReactNode;
    status: (p: Publication) => ReactNode;
  }) => ReactNode;
  jobs: Job[];
  refresh: () => Promise<void>;
  previewOnly?: boolean;
  onPhone?: (p: Publication) => void;
}) {
  const { message, modal } = App.useApp();
  const [account, setAccount] = useState<Account>();
  const [login, setLogin] = useState(false);
  const [qr, setQR] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Publication>();
  const [visibility, setVisibility] = useState("public");
  const [preview, setPreview] = useState<Preview>();
  const [previewID, setPreviewID] = useState("");
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const [qrLoading, setQRLoading] = useState(false);
  const loginAttempt = useRef(0);
  const qrRequest = useRef(false);
  const pollUntil = useRef(0);
  const loginPoll = useRef<Promise<void> | null>(null);
  const [loginSession, setLoginSession] = useState(0);
  useEffect(
    () => () => {
      loginAttempt.current++;
    },
    [],
  );
  const closeLogin = () => setLogin(false);
  const loginNow = async () => {
    if (busy) return;
    if (qrRequest.current) {
      setLogin(true);
      setError("上一次二维码请求尚未结束，请稍后再点刷新");
      return;
    }
    qrRequest.current = true;
    const attempt = ++loginAttempt.current;
    setQR("");
    setAccount(undefined);
    setError("");
    setLogin(true);
    setQRLoading(true);
    pollUntil.current = Date.now() + 240000;
    try {
      await loginPoll.current;
      if (attempt !== loginAttempt.current) return;
      const a = await post<Account>("/platforms/douyin/login");
      if (attempt !== loginAttempt.current) return;
      if (["waiting_scan", "waiting_confirm"].includes(a.state) && !a.img)
        throw Error("官方登录页未返回二维码，请刷新或打开专用官方浏览器检查");
      setAccount(a);
      setQR(a.img || "");
      if (a.state === "success") await refresh();
      else setLoginSession((v) => v + 1);
    } catch (e) {
      if (attempt === loginAttempt.current) setError((e as Error).message);
    } finally {
      qrRequest.current = false;
      if (attempt === loginAttempt.current) setQRLoading(false);
    }
  };
  useEffect(() => {
    if (!loginSession || !pollUntil.current) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = loginAttempt.current;
    const poll = async () => {
      if (!active || attempt !== loginAttempt.current) return;
      if (Date.now() > pollUntil.current) {
        setAccount((current) =>
          current?.is_logged_in
            ? current
            : current && { ...current, state: "expired" },
        );
        setQR("");
        return;
      }
      let terminal = false;
      loginPoll.current = (async () => {
        try {
          const a = await api<Account>("/platforms/douyin/login");
          if (active && attempt === loginAttempt.current) {
            setAccount(a);
            setError("");
            if (!["waiting_scan", "waiting_confirm"].includes(a.state))
              setQR("");
            if (a.state === "success") {
              terminal = true;
              await refresh();
              return;
            }
            if (["expired", "logged_out"].includes(a.state)) terminal = true;
          }
        } catch (e) {
          if (active && attempt === loginAttempt.current) {
            setError((e as Error).message);
          }
        }
      })();
      await loginPoll.current;
      if (
        active &&
        !terminal &&
        attempt === loginAttempt.current &&
        Date.now() < pollUntil.current
      )
        timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [loginSession]);
  const checkNow = () =>
    perform(async () => {
      await loginPoll.current;
      const a = await post<Account>("/platforms/douyin/account");
      setAccount(a);
      if (a.state === "success") {
        setQR("");
        await refresh();
      }
    });
  const openOfficial = () =>
    perform(async () => {
      await loginPoll.current;
      const opened = await post<Account>("/platforms/douyin/browser", {
        target: "creator",
      });
      setPreview(undefined);
      if (!account?.is_logged_in) {
        setAccount(opened);
        pollUntil.current = Date.now() + 240000;
        setLoginSession((v) => v + 1);
      }
      if (login) closeLogin();
      setQR("");
      message.info("已打开创作者中心；扫码后工作台会自动核实账号");
    });
  const showPreview = (p: Publication) =>
    perform(async () => {
      const v = await api<Preview>(
        "/publications/" + p.id + "/publish-preview",
      );
      setPreview(v);
      setPreviewID(p.id);
    });
  const pending = jobs.some(
    (j) =>
      j.kind.startsWith("douyin_") && ["queued", "running"].includes(j.state),
  );
  const renderStatus = (p: Publication) => (
    <Tag
      color={
        p.online_state === "unknown"
          ? "orange"
          : p.published_at
            ? "green"
            : "blue"
      }
    >
      {p.published_at
        ? "已发布"
        : states[p.online_state || ""] || (p.ready ? "等待发布" : "待准备")}
    </Tag>
  );
  const renderActions = (p: Publication) => (
    <Space wrap>
      <Button
        disabled={
          pending ||
          !p.ready ||
          !!p.published_at ||
          !["", "failed", "prepared", "manual_review"].includes(
            p.online_state || "",
          )
        }
        onClick={() => {
          setDraft(p);
          setVisibility(p.visibility || "public");
        }}
      >
        上传到抖音
      </Button>
      {p.online_state === "prepared" && (
        <Button type="primary" onClick={() => showPreview(p)}>
          核对并发布
        </Button>
      )}
      {p.online_state === "manual_review" && (
        <Button
          type="primary"
          disabled={pending || busy}
          onClick={() =>
            perform(async () => {
              await post("/platforms/douyin/browser", {
                target: "editor",
                publication_id: p.id,
              });
              message.info(
                "已打开这份稿件的官方编辑页，请核对上传进度、文案和可见范围后继续",
              );
            })
          }
        >
          继续官方编辑
        </Button>
      )}
      {p.remote_work_id && (
        <Button
          onClick={() =>
            perform(async () => {
              await post("/publications/" + p.id + "/publish-status");
              await refresh();
            })
          }
        >
          查询审核
        </Button>
      )}
      {p.online_state === "unknown" && (
        <Button
          onClick={() =>
            modal.confirm({
              title: "已在抖音创作平台核实没有发布？",
              content: "只有确认没有产生作品时才允许重新准备，避免重复发布。",
              okText: "已核实未发布",
              onOk: async () => {
                await post("/publications/" + p.id + "/resolve", {
                  not_published: true,
                });
                await refresh();
              },
            })
          }
        >
          核实未发布
        </Button>
      )}
    </Space>
  );
  if (previewOnly)
    return (
      <>
        {children({
          actions: (p) => (
            <Button
              type="text"
              shape="circle"
              icon={<MobileOutlined />}
              aria-label="手机扫码发布"
              disabled={!canPublishOnPhone(p)}
              title={
                p.kind !== "video"
                  ? "抖音扫码发布目前支持单视频稿件"
                  : "手机扫码发布"
              }
              onClick={() => onPhone?.(p)}
            />
          ),
          status: (p) => (
            <Tag
              color={
                p.published_at || (p.ready && p.kind === "video")
                  ? "green"
                  : "blue"
              }
            >
              {p.published_at
                ? "已发布"
                : !p.ready
                  ? "待准备"
                  : p.kind === "video"
                    ? "等待发布"
                    : "图文扫码暂未接入"}
            </Tag>
          ),
        })}
      </>
    );
  return (
    <>
      {children({ actions: renderActions, status: renderStatus })}
      <Modal
        title="扫码连接抖音"
        open={login}
        footer={
          <Space wrap>
            <Button
              onClick={openOfficial}
              disabled={pending || busy || qrLoading}
            >
              打开专用官方浏览器
            </Button>
            <Button onClick={checkNow} disabled={qrLoading} loading={busy}>
              检查登录状态
            </Button>
            <Button onClick={loginNow} disabled={busy} loading={qrLoading}>
              重新获取
            </Button>
            <Button onClick={closeLogin}>完成</Button>
          </Space>
        }
        onCancel={closeLogin}
      >
        {qrLoading ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <Spin />
            <p>正在从抖音官方页面获取新二维码…</p>
          </div>
        ) : (
          <p>
            {labels[account?.state || ""] ||
              (error ? "二维码加载失败，请刷新重试" : "等待获取二维码")}
          </p>
        )}
        {!qrLoading &&
          qr &&
          ["waiting_scan", "waiting_confirm"].includes(
            account?.state || "",
          ) && <Image width={240} src={qr} preview={false} />}
        {!qrLoading &&
          [
            "creator_connected",
            "main_connected",
            "identity_mismatch",
            "unverified",
            "verification_required",
          ].includes(account?.state || "") && (
            <Alert
              type="warning"
              showIcon
              message={labels[account?.state || ""]}
              description="请在专用官方浏览器完成扫码或官方要求的验证。工作台会继续自动核实；必要时可手动检查登录状态。"
            />
          )}
        {account?.state === "success" && (
          <Alert
            type="success"
            message={account.username + " · " + account.user_id}
          />
        )}
        {error && <Alert type="warning" message={error} />}
        <p>
          专用官方浏览器已打开；用抖音 App
          扫码并在手机确认。关闭此弹窗后仍会自动检查登录。验证码、实名认证和协议确认需本人在官方浏览器完成。
        </p>
      </Modal>
      <Modal
        title="上传到抖音编辑页"
        open={!!draft}
        confirmLoading={busy}
        onCancel={() => setDraft(undefined)}
        okText="开始上传"
        onOk={() =>
          perform(async () => {
            const a = await post<Account>("/platforms/douyin/account");
            setAccount(a);
            if (!a.is_logged_in || !a.creator_verified || !a.user_id)
              throw Error("请先扫码登录并核实创作者中心账号");
            await post("/publications/" + draft!.id + "/publish-prepare", {
              account_id: a.user_id,
              visibility,
            });
            setDraft(undefined);
            await refresh();
            message.info(
              "开始上传，专用抖音浏览器将打开；请留意任务状态和官方页面进度",
            );
          })
        }
      >
        <h3>{draft?.title}</h3>
        <p>自动选择素材并填写文案，不会点击发布。请保留弹出的官方编辑页。</p>
        <Radio.Group
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          options={[
            { label: "公开", value: "public" },
            { label: "仅自己可见", value: "self" },
          ]}
        />
        {error && <Alert type="warning" message={error} />}
      </Modal>
      <Modal
        title="核对抖音官方发布预览"
        width={860}
        open={!!preview}
        confirmLoading={busy}
        onCancel={() => setPreview(undefined)}
        okText="确认正式发布一次"
        onOk={() =>
          perform(async () => {
            await post("/publications/" + previewID + "/publish", {
              token: preview!.token,
              confirm: true,
            });
            setPreview(undefined);
            await refresh();
            message.success("已提交一次发布任务，请查看审核或结果状态");
          })
        }
      >
        {preview && (
          <>
            <p>
              <strong>{preview.account.username}</strong> ·{" "}
              {preview.account.user_id} ·{" "}
              {preview.visibility === "self" ? "仅自己可见" : "公开"}
            </p>
            <h3>{preview.title}</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{preview.caption}</p>
            <Space wrap>
              {preview.asset_ids.map((id, i) => (
                <span key={id}>
                  {i + 1}.{" "}
                  <a href={fileURL(id)} target="_blank" rel="noreferrer">
                    查看素材
                  </a>
                </span>
              ))}
            </Space>
            {preview.cover_id && (
              <p>
                选定封面：
                <Image width={100} src={fileURL(preview.cover_id)} />
              </p>
            )}
            <p>
              请核对下方官方编辑器中的图片顺序、视频封面、文案与可见性。有效期至{" "}
              {date(preview.expires_at)}。
            </p>
            <Image width="100%" src={preview.image} />
          </>
        )}
        {error && <Alert type="error" message={error} />}
      </Modal>
    </>
  );
}
