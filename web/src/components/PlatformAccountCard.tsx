import { UserOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import type { Platform } from "../api";

export default function PlatformAccountCard({
  platform,
  title,
  description,
  status,
  actions,
  children,
}: {
  platform: Platform;
  title: string;
  description: ReactNode;
  status: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      className="publisher-account-bar platform-account-card"
      data-platform={platform}
    >
      <div className="account-card-main">
        <div className="account-identity">
          <span className={`account-avatar account-avatar-${platform}`}>
            <UserOutlined />
          </span>
          <div className="account-copy">
            <div className="account-title-row">
              <span
                className={`platform-badge platform-badge-${platform === "xhs" ? "xiaohongshu" : "douyin"}`}
              >
                {platform === "xhs" ? "小红书" : "抖音"}
              </span>
              <strong title={title}>{title}</strong>
              <span className="account-status">{status}</span>
            </div>
            <p className="muted">{description}</p>
          </div>
        </div>
        <div className="account-card-actions">{actions}</div>
      </div>
      {children && <div className="account-card-footer">{children}</div>}
    </section>
  );
}
