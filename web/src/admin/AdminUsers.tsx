import Table from "../components/ResponsiveTable";
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  KeyOutlined,
  PlusOutlined,
  SearchOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { App, Button, Dropdown, Input, Modal, Select, Space, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { useMemo, useState } from "react";
import type { AdminRole, AdminUser } from "./adminData";
import ConfirmActionIcon from "../components/ConfirmActionIcon";
import {
  createAdminUser,
  deleteAdminUser,
  formatDate,
  resetAdminPassword,
  roleLabel,
  updateAdminUser,
} from "./adminData";

export default function AdminUsers({
  users,
  currentUserId,
  onChanged,
}: {
  users: AdminUser[];
  currentUserId: string;
  onChanged: () => void | Promise<void>;
}) {
  const { message, modal: dialog } = App.useApp();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<AdminRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AdminRole>("creator");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter(
      (u) =>
        (roleFilter === "all" || u.role === roleFilter) &&
        (statusFilter === "all" || u.status === statusFilter) &&
        (!q ||
          u.username.toLowerCase().includes(q) ||
          u.display_name.toLowerCase().includes(q) ||
          roleLabel[u.role].includes(q)),
    );
  }, [users, query, roleFilter, statusFilter]);

  const openAdd = () => {
    setEditing(null);
    setUsername("");
    setPassword("");
    setDisplayName("");
    setRole("creator");
    setNote("");
    setModal("add");
  };
  const openEdit = (user: AdminUser) => {
    setEditing(user);
    setUsername(user.username);
    setPassword("");
    setDisplayName(user.display_name);
    setRole(user.role);
    setNote(user.note || "");
    setModal("edit");
  };
  const save = async () => {
    setBusy(true);
    try {
      if (modal === "add") {
        await createAdminUser({
          username,
          password,
          display_name: displayName,
          role,
          note,
        });
        message.success("用户已创建");
      } else if (editing) {
        await updateAdminUser(editing.id, {
          display_name: displayName,
          role,
          note,
        });
        message.success("用户信息已更新");
      }
      setModal(null);
      await onChanged();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (user: AdminUser) => {
    try {
      await updateAdminUser(user.id, {
        status: user.status === "active" ? "disabled" : "active",
      });
      message.success(user.status === "active" ? "账号已停用" : "账号已启用");
      await onChanged();
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  const remove = async (user: AdminUser) => {
    try {
      await deleteAdminUser(user.id);
      message.success("用户已删除");
      await onChanged();
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  const resetPassword = async () => {
    if (!passwordUser) return;
    if (newPassword.length < 8) {
      message.error("密码至少需要 8 个字符");
      return;
    }
    setPasswordBusy(true);
    try {
      await resetAdminPassword(passwordUser.id, newPassword);
      message.success("用户密码已重置");
      setPasswordUser(null);
      setNewPassword("");
      await onChanged();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setPasswordBusy(false);
    }
  };

  const columns: TableColumnsType<AdminUser> = [
    {
      title: "用户",
      dataIndex: "display_name",
      render: (_: string, user) => (
        <div className="admin-user-cell">
          <span className="admin-avatar">{user.display_name.slice(0, 1)}</span>
          <div>
            <div className="admin-user-name">
              <strong title={user.display_name}>{user.display_name}</strong>
              {user.id === currentUserId && (
                <span className="admin-current-user">当前账号</span>
              )}
            </div>
            <small title={user.username}>@{user.username}</small>
            {user.note && (
              <p className="admin-user-note" title={user.note}>
                {user.note}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 104,
      render: (value: AdminRole) => (
        <Tag className="admin-role-tag">{roleLabel[value]}</Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 86,
      render: (value: string) => (
        <Tag
          className={
            "admin-status-tag " + (value === "active" ? "is-active" : "")
          }
        >
          <i aria-hidden="true" />
          {value === "active" ? "启用" : "已停用"}
        </Tag>
      ),
    },
    {
      title: "时间",
      key: "times",
      width: 174,
      render: (_: unknown, user) => (
        <div className="admin-user-times">
          <span>
            <small>创建</small>
            <time title={formatDate(user.created_at)}>
              {new Date(user.created_at).toLocaleDateString("zh-CN")}
            </time>
          </span>
          <span>
            <small>登录</small>
            <time>
              {user.last_login_at ? formatDate(user.last_login_at) : "尚未登录"}
            </time>
          </span>
        </div>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 116,
      fixed: "right",
      render: (_: unknown, user) => (
        <Space size={4} className="admin-user-actions">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            aria-label={`编辑用户 ${user.display_name}`}
            onClick={() => openEdit(user)}
          >
            编辑
          </Button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "password",
                  label: "重置密码",
                  icon: <KeyOutlined />,
                  onClick: () => {
                    setPasswordUser(user);
                    setNewPassword("");
                  },
                },
                {
                  key: "status",
                  label: user.status === "active" ? "停用账号" : "启用账号",
                  icon:
                    user.status === "active" ? (
                      <StopOutlined />
                    ) : (
                      <CheckCircleOutlined />
                    ),
                  disabled: user.id === currentUserId,
                  onClick: () => void toggle(user),
                },
                { type: "divider" },
                {
                  key: "delete",
                  label: "删除用户",
                  icon: <DeleteOutlined />,
                  danger: true,
                  disabled: user.id === currentUserId,
                  onClick: () =>
                    dialog.confirm({
                      icon: <ConfirmActionIcon />,
                      title: "删除这个用户？",
                      content:
                        "账号会从服务端移除，历史创作数据目录不会自动删除。",
                      okText: "删除",
                      cancelText: "取消",
                      okButtonProps: { danger: true },
                      onOk: () => remove(user),
                    }),
                },
              ],
            }}
          >
            <Button
              type="text"
              size="small"
              icon={<EllipsisOutlined />}
              aria-label={`更多用户操作 ${user.display_name}`}
            />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <section className="admin-page-card admin-users-page">
      <div className="admin-users-heading">
        <div>
          <strong>用户列表</strong>
          <span>
            {filtered.length === users.length
              ? `共 ${users.length} 个账号`
              : `筛选到 ${filtered.length} 个账号`}
          </span>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          新增用户
        </Button>
      </div>
      <div className="admin-list-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          aria-label="搜索用户"
          placeholder="搜索用户名、显示名或角色"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          aria-label="筛选用户角色"
          value={roleFilter}
          onChange={setRoleFilter}
          options={[
            { value: "all", label: "全部角色" },
            ...Object.entries(roleLabel).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <Select
          aria-label="筛选账号状态"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "全部状态" },
            { value: "active", label: "启用" },
            { value: "disabled", label: "已停用" },
          ]}
        />
      </div>
      <Table
        rowKey="id"
        columns={columns}
        tableLayout="fixed"
        dataSource={filtered}
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        scroll={{ x: 720 }}
        locale={{ emptyText: "没有符合条件的用户" }}
      />
      <Modal
        open={!!modal}
        title={modal === "add" ? "新增用户" : "编辑用户"}
        okText="保存"
        cancelText="取消"
        confirmLoading={busy}
        onOk={() => void save()}
        onCancel={() => setModal(null)}
      >
        <div className="admin-form">
          <label>
            用户名
            <Input
              value={username}
              disabled={modal === "edit"}
              placeholder="登录用户名"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          {modal === "add" && (
            <label>
              初始密码
              <Input.Password
                value={password}
                autoComplete="new-password"
                placeholder="至少 8 个字符"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          <label>
            显示名称
            <Input
              value={displayName}
              placeholder="例如：创作用户"
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label>
            角色
            <Select
              value={role}
              style={{ width: "100%" }}
              onChange={(value) => setRole(value)}
              options={[
                { value: "admin", label: "管理员" },
                { value: "creator", label: "创作用户" },
                { value: "operator", label: "运营账号" },
              ]}
            />
          </label>
          <label>
            备注
            <Input.TextArea
              value={note}
              rows={3}
              placeholder="可填写职责或使用范围"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
      </Modal>
      <Modal
        open={!!passwordUser}
        title={`重置密码：${passwordUser?.display_name || ""}`}
        okText="重置密码"
        cancelText="取消"
        confirmLoading={passwordBusy}
        onOk={() => void resetPassword()}
        onCancel={() => setPasswordUser(null)}
      >
        <div className="admin-form">
          <label>
            新密码
            <Input.Password
              value={newPassword}
              autoComplete="new-password"
              placeholder="至少 8 个字符"
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <p className="muted">重置后该用户的其他登录会话会失效。</p>
        </div>
      </Modal>
    </section>
  );
}
