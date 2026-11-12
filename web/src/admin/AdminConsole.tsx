import {
  ArrowRightOutlined,
  BarChartOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  DollarOutlined,
  DownOutlined,
  FileTextOutlined,
  LineChartOutlined,
  LockOutlined,
  LogoutOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  App,
  Avatar,
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Spin,
  Tag,
} from "antd";
import { useEffect, useState } from "react";
import SettingsPanel from "../Settings";
import AdminModels from "./AdminModels";
import AdminPrompts from "./AdminPrompts";
import AdminUsers from "./AdminUsers";
import UsageDashboard from "./UsageDashboard";
import "./admin-workspaces.css";
import type { AdminSummary, AdminUser, UsageRecord } from "./adminData";
import {
  adminOverview,
  formatCost,
  formatNumber,
  resetAdminPassword,
  roleLabel,
  saveAdminBilling,
} from "./adminData";

export type AdminPage = "overview" | "users" | "models" | "prompts" | "usage";

const adminPages: { key: AdminPage; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "管理总览", icon: <DashboardOutlined /> },
  { key: "users", label: "用户管理", icon: <TeamOutlined /> },
  { key: "models", label: "模型配置", icon: <DeploymentUnitOutlined /> },
  { key: "prompts", label: "创作提示词", icon: <FileTextOutlined /> },
  { key: "usage", label: "用量与计费", icon: <BarChartOutlined /> },
];

const pageHeading: Record<AdminPage, { title: string; subtitle: string }> = {
  overview: { title: "管理总览", subtitle: "今天的工作台运行概况" },
  users: { title: "用户管理", subtitle: "管理成员、角色与账号状态" },
  models: { title: "模型配置", subtitle: "" },
  prompts: {
    title: "创作提示词",
    subtitle: "管理标题、文案、图片和视频的系统提示词",
  },
  usage: { title: "用量与计费", subtitle: "按用户、模型与时间查看 Token 用量" },
};

function MetricCard({
  icon,
  label,
  value,
  note,
  primary = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  note: string;
  primary?: boolean;
}) {
  return (
    <article className={"admin-metric " + (primary ? "primary" : "")}>
      <div className="admin-metric-label">
        {icon}
        {label}
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function AdminOverview({
  users,
  usage,
  summary,
  price,
  onNavigate,
}: {
  users: AdminUser[];
  usage: UsageRecord[];
  summary: AdminSummary;
  price: number;
  onNavigate: (page: AdminPage) => void;
}) {
  const creators = users.filter((user) => user.role === "creator");
  const usageRows = creators.map((user) => {
    const records = usage.filter((record) => record.user_id === user.id);
    return {
      user,
      tokens: records.reduce((sum, record) => sum + record.total, 0),
      calls: records.length,
      cost: records.reduce((sum, record) => sum + record.cost, 0),
    };
  });
  const maxUsage = Math.max(1, ...usageRows.map((row) => row.tokens));
  return (
    <div className="admin-overview">
      <div className="admin-overview-filter">
        <Tag className="admin-today-tag">今日 · 北京时间</Tag>
        <span>用量和费用以服务端记录的调用响应为准</span>
      </div>
      <div className="admin-metrics">
        <MetricCard
          primary
          icon={<TeamOutlined />}
          label="启用账号"
          value={summary.active_users}
          note={`共 ${users.length} 个账号`}
        />
        <MetricCard
          icon={<LineChartOutlined />}
          label="模型调用"
          value={summary.calls}
          note="服务端记录的调用次数"
        />
        <MetricCard
          icon={<BarChartOutlined />}
          label="Token 用量"
          value={formatNumber(summary.tokens)}
          note="按调用内容估算"
        />
        <MetricCard
          icon={<DollarOutlined />}
          label="估算费用"
          value={formatCost(summary.cost, summary.cost <= 0)}
          note={price > 0 ? "按服务端 Token 单价" : "配置单价后显示估算"}
        />
      </div>
      <section className="admin-panel admin-quick-panel">
        <div className="admin-panel-head">
          <strong>快速管理</strong>
        </div>
        <div className="admin-quick-navigation">
          {(["users", "models", "prompts", "usage"] as AdminPage[]).map(
            (key) => (
              <Button key={key} onClick={() => onNavigate(key)}>
                {pageHeading[key].title}
              </Button>
            ),
          )}
        </div>
      </section>
      <div className="admin-overview-grid">
        <section className="admin-panel admin-user-usage">
          <div className="admin-panel-head">
            <strong>用户用量</strong>
            <Button type="link" onClick={() => onNavigate("usage")}>
              查看明细 <ArrowRightOutlined />
            </Button>
          </div>
          {usageRows.length ? (
            usageRows.map((row) => (
              <div className="admin-usage-line" key={row.user.id}>
                <div className="admin-usage-line-head">
                  <span>{row.user.display_name}</span>
                  <strong>{formatNumber(row.tokens)} Token</strong>
                </div>
                <small>
                  {row.calls} 次调用 · {formatCost(row.cost, row.cost <= 0)}
                </small>
                <div className="admin-usage-track">
                  <i
                    style={{
                      width: `${row.tokens ? Math.max(4, (row.tokens / maxUsage) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无创作用户"
            />
          )}
          <div className="admin-panel-note">
            每个用户拥有独立工作区数据库，创作、素材和任务互不混用。
          </div>
        </section>
      </div>
    </div>
  );
}

export default function AdminConsole({
  page,
  user,
  onNavigate,
  onLogout,
}: {
  page: AdminPage;
  user: AdminUser;
  onNavigate: (page: AdminPage) => void;
  onLogout: () => void | Promise<void>;
}) {
  const { message } = App.useApp();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [summary, setSummary] = useState<AdminSummary>({
    active_users: 0,
    calls: 0,
    tokens: 0,
    cost: 0,
    active_tasks: 0,
    failed_tasks: 0,
  });
  const [price, setPrice] = useState(0);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const overview = await adminOverview();
      setConnected(true);
      setUsers(overview.users);
      setUsage(overview.usage);
      setSummary(overview.summary);
      setPrice(overview.price_per_1k);
    } catch (e) {
      setConnected(false);
      if ((e as Error).message) message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [page]);

  const changePassword = async () => {
    if (newPassword !== confirmPassword) {
      message.error("两次输入的新密码不一致");
      return;
    }
    setPasswordBusy(true);
    try {
      await resetAdminPassword(user.id, newPassword);
      setPasswordOpen(false);
      setNewPassword("");
      setConfirmPassword("");
      message.success("管理员密码已更新");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setPasswordBusy(false);
    }
  };
  const userMenu = {
    items: [
      {
        key: "account",
        label: `当前账号：${user.display_name}`,
        disabled: true,
      },
      { type: "divider" as const },
      { key: "password", label: "修改管理员密码", icon: <LockOutlined /> },
      { type: "divider" as const },
      {
        key: "logout",
        label: "退出登录",
        icon: <LogoutOutlined />,
        danger: true,
      },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "password") setPasswordOpen(true);
      if (key === "logout") void onLogout();
    },
  };
  const heading = pageHeading[page];
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-mark">
            <img src="/rednote-mark.svg" alt="" />
          </span>
          <span>
            <strong>
              RedNote<span className="brand-period">.</span>
            </strong>
            <small>服务端管理控制台</small>
          </span>
        </div>
        <nav className="admin-nav" aria-label="管理端导航">
          {adminPages.map((item) => (
            <button
              key={item.key}
              className={
                "admin-nav-item " + (page === item.key ? "selected" : "")
              }
              aria-label={item.label}
              title={item.label}
              aria-current={page === item.key ? "page" : undefined}
              onClick={() => onNavigate(item.key)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <small>用户端与管理员端独立</small>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-header">
          <div className="admin-heading">
            <span className="admin-eyebrow">SERVER ADMINISTRATION</span>
            <h1>{heading.title}</h1>
            {heading.subtitle && <p>{heading.subtitle}</p>}
          </div>
          <div className="admin-header-actions">
            <span
              className={
                "admin-connection " + (connected ? "is-online" : "is-offline")
              }
              role="status"
            >
              <i />{" "}
              {loading
                ? "正在同步…"
                : connected
                  ? "服务端已连接"
                  : "连接异常，请重试"}
            </span>
            <Dropdown menu={userMenu} trigger={["click"]}>
              <button className="admin-user-chip">
                <Avatar size={38} className="admin-user-avatar">
                  {user.display_name.slice(0, 1)}
                </Avatar>
                <span>
                  <strong>{user.display_name}</strong>
                  <small>{roleLabel[user.role]}</small>
                </span>
                <DownOutlined />
              </button>
            </Dropdown>
          </div>
        </header>
        <div className="admin-content">
          {!loading && !connected && (
            <div className="connection-warning" role="alert">
              <span>暂时无法读取服务端数据。</span>
              <Button size="small" onClick={() => void load()}>
                重新连接
              </Button>
            </div>
          )}
          {loading && !users.length ? (
            <div className="admin-loading">
              <Spin size="large" />
              <span>正在读取服务端数据…</span>
            </div>
          ) : (
            <>
              {page === "overview" && (
                <AdminOverview
                  users={users}
                  usage={usage}
                  summary={summary}
                  price={price}
                  onNavigate={onNavigate}
                />
              )}
              {page === "users" && (
                <AdminUsers
                  users={users}
                  currentUserId={user.id}
                  onChanged={load}
                />
              )}
              {page === "models" && (
                <AdminModels onOpenSettings={() => setSettingsOpen(true)} />
              )}
              {page === "prompts" && <AdminPrompts />}
              {page === "usage" && (
                <UsageDashboard
                  records={usage}
                  users={users}
                  price={price}
                  onPriceChange={async (next) => {
                    await saveAdminBilling(next);
                    setPrice(next);
                    message.success("Token 单价已保存到服务端");
                  }}
                  embedded
                  showUser
                />
              )}
            </>
          )}
        </div>
      </main>
      <SettingsPanel
        endpoint="/admin/settings"
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <Modal
        open={passwordOpen}
        title="修改管理员密码"
        okText="保存新密码"
        cancelText="取消"
        confirmLoading={passwordBusy}
        onOk={() => void changePassword()}
        onCancel={() => setPasswordOpen(false)}
      >
        <div className="admin-form">
          <label>
            新密码
            <Input.Password
              value={newPassword}
              autoComplete="new-password"
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <label>
            确认新密码
            <Input.Password
              value={confirmPassword}
              autoComplete="new-password"
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          <p className="muted">
            密码至少 8 个字符，修改后其他设备的管理员会话会失效。
          </p>
        </div>
      </Modal>
    </div>
  );
}
