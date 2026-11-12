import {
  ArrowRightOutlined,
  LockOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Button, Input } from "antd";
import { useState } from "react";
import type { AdminUser } from "./admin/adminData";
import { authLogin, authLogout } from "./admin/adminData";
import LoginStory from "./LoginStory";

export default function UserLogin({
  onLoggedIn,
  onAdminLogin,
}: {
  onLoggedIn: (user: AdminUser) => void;
  onAdminLogin: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (busy) return;
    setError("");
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }
    setBusy(true);
    try {
      const result = await authLogin(username.trim(), password);
      if (result.user.role === "admin") {
        await authLogout().catch(() => {});
        setError("管理员请使用管理员登录入口");
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
    <div className="rednote-login user-login">
      <LoginStory />
      <section className="login-panel">
        <form className="login-form-card" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label="创作用户登录">
          <div className="admin-pill user-pill">
            <UserOutlined /> 创作用户端
          </div>
          <h2>登录创作工作台</h2>
          <p className="login-form-lead">使用管理员分配给你的账号登录。</p>
          <div className="login-field">
            <label htmlFor="user-username">用户名</label>
            <Input
              size="large"
              prefix={<UserOutlined />}
              value={username}
              autoComplete="username"
              name="username"
              id="user-username"
              aria-invalid={!!error}
              aria-describedby={error ? "user-login-error" : undefined}
              placeholder="请输入用户名"
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="login-field">
            <label htmlFor="user-password">密码</label>
            <Input.Password
              size="large"
              prefix={<LockOutlined />}
              value={password}
              autoComplete="current-password"
              name="password"
              id="user-password"
              aria-invalid={!!error}
              aria-describedby={error ? "user-login-error" : undefined}
              placeholder="请输入密码"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <div className="login-error" id="user-login-error" role="alert">{error}</div>}
          <Button type="primary" htmlType="submit" size="large" block loading={busy}>
            进入工作台 <ArrowRightOutlined />
          </Button>
          <button type="button" className="login-user-link" onClick={onAdminLogin}>
            管理员登录 <ArrowRightOutlined />
          </button>
          <div className="login-hint">首次登录后请联系管理员修改初始密码。</div>
        </form>
        <div className="login-copyright">RedNote · 小红书内容工作台</div>
      </section>
    </div>
  );
}
