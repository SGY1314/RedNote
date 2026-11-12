import { useEffect, useState } from "react";
import { api } from "./api";
import AccountProfileStep, {
  accountFields,
} from "./rewrites/AccountProfileStep";
import { BarChartOutlined, LogoutOutlined } from "@ant-design/icons";
import { App, Button, Space } from "antd";
import type { AdminUser } from "./admin/adminData";
import ThemePicker from "./components/ThemePicker";

export default function ClientSettings({
  open,
  onClose,
  user,
  onLogout,
  onOpenUsage,
}: {
  open: boolean;
  onClose: () => void;
  user: AdminUser;
  onLogout: () => void | Promise<void>;
  onOpenUsage: () => void;
}) {
  const { message } = App.useApp();
  const [defaults, setDefaults] = useState(accountFields());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open)
      api("/profile/default")
        .then((v) => setDefaults(accountFields(v)))
        .catch((e) => message.error(e.message));
  }, [open, user.id]);
  if (!open) return null;
  return (
    <section className="utility-page settings-page" aria-label="工作区设置">
      <div className="client-settings">
        <section>
          <span className="settings-avatar">
            {(user.display_name || user.username).slice(0, 1)}
          </span>
          <h3>{user.display_name}</h3>
          <p className="muted">@{user.username}</p>
        </section>
        <ThemePicker />
        <section aria-label="默认基本信息">
          <h3>默认基本信息</h3>
          <p className="muted">
            新项目自动带入，确认后用于生成；修改默认值不会覆盖已有项目。
          </p>
          <AccountProfileStep
            value={defaults}
            busy={saving}
            onChange={(patch) => setDefaults((old) => ({ ...old, ...patch }))}
            onSkip={() => setDefaults(accountFields())}
            onConfirm={() => {
              setSaving(true);
              api("/profile/default", {
                method: "PUT",
                body: JSON.stringify(defaults),
              })
                .then(() => message.success("默认基本信息已保存"))
                .catch((e) => message.error(e.message))
                .finally(() => setSaving(false));
            }}
            confirmLabel="保存默认基本信息"
            skipLabel="清空填写"
            allowEmpty
          />
        </section>
        <section>
          <h3>独立创作空间</h3>
          <p className="muted">
            你的采集、项目、素材和任务保存在服务端独立工作区中，不会与其他用户混用。
          </p>
        </section>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Button
            block
            icon={<BarChartOutlined />}
            onClick={() => {
              onClose();
              onOpenUsage();
            }}
          >
            打开计费面板
          </Button>
          <Button
            block
            icon={<LogoutOutlined />}
            onClick={() => void onLogout()}
          >
            退出登录
          </Button>
        </Space>
      </div>
    </section>
  );
}
