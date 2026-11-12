import PlatformAccountCard from "./components/PlatformAccountCard";
import {
  LogoutOutlined,
  QrcodeOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Modal, Space, Spin, Tag } from "antd";
import { useEffect, useState } from "react";
import { post } from "./api";
import { loginTerminal, publisherLoginLabels } from "./publisherLogin";
export type PublisherAccount = {
  is_logged_in: boolean;
  state?: string;
  message?: string;
  expires_at?: string;
  username: string;
  user_id: string;
};
export default function PublisherPanel({
  account,
  onAccount,
  open,
  onOpen,
}: {
  account?: PublisherAccount;
  onAccount: (a: PublisherAccount | undefined) => void;
  open: boolean;
  onOpen: (v: boolean) => void;
}) {
  const { message, modal } = App.useApp();
  const [qr, setQR] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let expires = Date.now() + 240000;
    setQR("");
    setError("");
    setLoading(true);
    const poll = async () => {
      if (cancelled) return;
      try {
        const a = await post<PublisherAccount>("/publisher/status");
        if (cancelled) return;
        onAccount(a);
        setError(a.message || "");
        if (a.expires_at && Number.isFinite(Date.parse(a.expires_at)))
          expires = Date.parse(a.expires_at);
        if (loginTerminal(a.state)) {
          setQR("");
          setError(a.message || publisherLoginLabels[a.state!]);
          return;
        }
        if (a.is_logged_in) {
          setQR("");
          setError(a.user_id ? "" : "已登录，但未能识别账号，请稍后检查连接");
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
      if (Date.now() < expires) timer = setTimeout(poll, 2000);
      else {
        setQR("");
        setError("二维码已过期，请点击重新获取");
      }
    };
    post<{ img?: string; is_logged_in: boolean; timeout?: string }>(
      "/publisher/qrcode",
    )
      .then((r) => {
        if (cancelled) return;
        if (!r.img && !r.is_logged_in)
          throw Error("未取得二维码，请查看专用浏览器页面后重试");
        expires = Date.now() + 240000;
        if (!r.is_logged_in)
          onAccount({
            is_logged_in: false,
            username: "",
            user_id: "",
            state: "waiting_scan",
            expires_at: new Date(expires).toISOString(),
          });
        setQR(r.img || "");
        setLoading(false);
        void poll();
      })
      .catch((e) => {
        if (!cancelled) {
          setLoading(false);
          setError((e as Error).message);
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, generation]);
  // Closing the QR dialog does not cancel the official login. Keep observing
  // the existing session, without requesting another QR or another browser.
  useEffect(() => {
    if (
      open ||
      !["waiting_scan", "verifying", "verification_required"].includes(
        account?.state || "",
      )
    )
      return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = account?.expires_at
      ? Date.parse(account.expires_at)
      : Date.now() + 240000;
    const poll = async () => {
      if (cancelled) return;
      try {
        const next = await post<PublisherAccount>("/publisher/status");
        if (cancelled) return;
        onAccount(next);
        if (
          next.is_logged_in ||
          loginTerminal(next.state) ||
          next.state === "logged_out"
        )
          return;
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
      if (Date.now() < deadline) timer = setTimeout(poll, 2000);
      else if (account)
        onAccount({
          ...account,
          is_logged_in: false,
          state: "expired",
          message: "本次扫码已超时，请重新连接",
        });
    };
    timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, account?.state, account?.expires_at]);
  const check = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const a = await post<PublisherAccount>("/publisher/status");
      onAccount(a);
      message.info(
        a.is_logged_in
          ? "登录状态已更新"
          : a.message ||
              publisherLoginLabels[a.state || "logged_out"] ||
              "正在核实登录状态",
      );
      if (open) {
        setError(a.message || "");
        if (a.is_logged_in || loginTerminal(a.state)) setQR("");
      }
    } catch (e) {
      onAccount(undefined);
      message.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <PlatformAccountCard
        platform="xhs"
        title={
          account?.is_logged_in
            ? account.username || "已登录账号"
            : "小红书账号"
        }
        description={
          account?.is_logged_in
            ? `账号 ID：${account.user_id || "身份待核实"}`
            : "连接后可上传到小红书官方编辑页"
        }
        status={
          <Tag
            bordered={false}
            color={account?.is_logged_in ? "green" : "default"}
          >
            {account?.is_logged_in
              ? "已登录"
              : publisherLoginLabels[account?.state || ""] || "待连接"}
          </Tag>
        }
        actions={
          <>
            <Button
              className="account-action-refresh"
              aria-label="刷新账号状态"
              icon={<ReloadOutlined />}
              loading={checking}
              onClick={check}
            />
            {!account?.is_logged_in ? (
              <Button
                className="account-action-connect"
                type="primary"
                icon={<QrcodeOutlined />}
                onClick={() => onOpen(true)}
              >
                扫码连接
              </Button>
            ) : (
              <Button
                className="account-action-connect"
                icon={<LogoutOutlined />}
                onClick={() =>
                  modal.confirm({
                    title: "断开此账号？",
                    content:
                      "将清除工作台保存的登录状态，再次发布需要重新扫码。",
                    onOk: async () => {
                      try {
                        await post("/publisher/disconnect");
                        onAccount(undefined);
                        message.success("已断开账号");
                      } catch (e) {
                        message.error((e as Error).message);
                        throw e;
                      }
                    },
                  })
                }
              >
                退出登录
              </Button>
            )}
          </>
        }
      >
        <details className="account-publish-help">
          <summary>发布说明</summary>
          <p>上传文案和素材后，在小红书官方页面预览并手动发布。</p>
        </details>
      </PlatformAccountCard>
      <Modal
        title="扫码连接小红书"
        open={open}
        onCancel={() => onOpen(false)}
        footer={
          <Space>
            <Button
              onClick={() => setGeneration((v) => v + 1)}
              disabled={loading || checking}
            >
              重新获取
            </Button>
            <Button loading={checking} disabled={loading} onClick={check}>
              检查登录状态
            </Button>
            <Button onClick={() => onOpen(false)}>完成</Button>
          </Space>
        }
      >
        <p>
          使用你自己的小红书 App
          扫码，并在手机上确认登录。系统会打开专用小红书浏览器，请保持它打开；如出现官方验证，请在该窗口完成。
        </p>
        <div style={{ textAlign: "center", padding: 24, minHeight: 240 }}>
          {loading ? (
            <>
              <Spin />
              <p>正在获取二维码，请稍候</p>
            </>
          ) : qr ? (
            <img
              alt="小红书登录二维码"
              src={qr}
              style={{ width: 220, height: 220 }}
            />
          ) : account?.is_logged_in ? (
            <>
              <h3>已连接：{account.username || "小红书账号"}</h3>
              <p>{account.user_id}</p>
            </>
          ) : null}
        </div>
        {!loading && !error && !account?.is_logged_in && qr && (
          <Alert
            type="info"
            showIcon
            message={
              publisherLoginLabels[account?.state || "waiting_scan"] ||
              "正在核实登录状态"
            }
          />
        )}
        {error && <Alert type="warning" showIcon message={error} />}
        <p className="muted">
          登录状态使用 Windows
          加密后保存在本机。发布时会再次核对账号；验证码和平台限制需要你在小红书处理。
        </p>
      </Modal>
    </>
  );
}
