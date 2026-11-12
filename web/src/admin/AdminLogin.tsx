import {
  ArrowRightOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Button, Input } from "antd";
import { useState } from "react";
import type { AdminUser } from "./adminData";
import { authLogin, authLogout } from "./adminData";
import LoginStory from "../LoginStory";

export default function AdminLogin({
  onLoggedIn,
  onUserWorkspace,
}: {
  onLoggedIn: (user: AdminUser) => void;
  onUserWorkspace: () => void;
}) {
  const [username, setUsername] = useState("workbench");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (busy) return;
    setError("");
    if (!username.trim() || !password) {
      setError("请输入管理员用户名和密码");
      return;
    }
    setBusy(true);
    try {
      const result = await authLogin(username.trim(), password);
      if (result.user.role !== "admin") {
        await authLogout().catch(() => {});
        setError("该账号没有管理员权限");
        return;
      }
      onLoggedIn(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rednote-login admin-login">
      <LoginStory admin />
      <section className="login-panel">
        <form className="login-form-card" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label="管理员登录">
          <div className="admin-pill">
            <SafetyCertificateOutlined /> 管理员端
          </div>
          <h2>登录管理控制台</h2>
          <p className="login-form-lead">使用分配给你的管理员账户登录。</p>
          <div className="login-field">
            <label htmlFor="admin-username">用户名</label>
            <Input
              size="large"
              prefix={<UserOutlined />}
              value={username}
              autoComplete="username"
              name="username"
              id="admin-username"
              aria-invalid={!!error}
              aria-describedby={error ? "admin-login-error" : undefined}
              placeholder="请输入用户名"
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="login-field">
            <label htmlFor="admin-password">密码</label>
            <Input.Password
              size="large"
              prefix={<LockOutlined />}
              value={password}
              autoComplete="current-password"
              name="password"
              id="admin-password"
              aria-invalid={!!error}
              aria-describedby={error ? "admin-login-error" : undefined}
              placeholder="请输入密码"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="login-error" id="admin-login-error" role="alert">{error}</div>}
          <Button type="primary" htmlType="submit" size="large" block loading={busy}>
            进入管理控制台 <ArrowRightOutlined />
          </Button>
          <button type="button" className="login-user-link" onClick={onUserWorkspace}>
            创作用户登录 <ArrowRightOutlined />
          </button>
          <div className="login-hint">首次登录后请及时修改管理员密码。</div>
        </form>
        <div className="login-copyright">RedNote · 小红书内容工作台</div>
      </section>
    </div>
  );
}
