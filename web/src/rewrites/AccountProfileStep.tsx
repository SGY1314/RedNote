import { Button, Input, Tag } from "antd";
import "./account-profile.css";

export type AccountFields = {
  account_name: string;
  account_subject: string;
  positioning: string;
  audience: string;
  style: string;
};

export type AccountProfile = AccountFields & {
  revision: number;
  status: "confirmed" | "skipped" | "";
  key: string;
};

export function accountFields(
  value: Partial<AccountFields> = {},
): AccountFields {
  return {
    account_name: value.account_name || "",
    account_subject: value.account_subject || "",
    positioning: value.positioning || "",
    audience: value.audience || "",
    style: value.style || "",
  };
}

const fields: {
  key: keyof AccountFields;
  label: string;
  placeholder: string;
  limit: number;
  short?: boolean;
}[] = [
  {
    key: "account_name",
    label: "账号名称",
    placeholder: "例如：小林的生活手记",
    limit: 100,
    short: true,
  },
  {
    key: "account_subject",
    label: "账号主体",
    placeholder: "例如：个人创作者、品牌或机构",
    limit: 200,
    short: true,
  },
  {
    key: "positioning",
    label: "账号定位",
    placeholder: "分享什么内容，为用户提供什么价值？",
    limit: 600,
  },
  {
    key: "audience",
    label: "用户画像",
    placeholder: "面向哪些用户？他们关心什么、有哪些需求？",
    limit: 600,
  },
  {
    key: "style",
    label: "账号风格",
    placeholder: "例如：真诚自然的表达、克制的措辞、温暖清爽的画面",
    limit: 600,
  },
];

export default function AccountProfileStep({
  value,
  profile,
  busy,
  onChange,
  onConfirm,
  onSkip,
  confirmLabel = "确认基本信息",
  skipLabel = "跳过，继续仿写",
  allowEmpty = false,
}: {
  confirmLabel?: string;
  skipLabel?: string;
  allowEmpty?: boolean;
  value: Partial<AccountFields>;
  profile?: AccountProfile;
  busy: boolean;
  onChange: (value: Partial<AccountFields>) => void;
  onConfirm: () => void;
  onSkip: () => void;
}) {
  const current = accountFields(value);
  const changed =
    profile?.status === "confirmed" &&
    fields.some((field) => current[field.key].trim() !== profile[field.key]);
  return (
    <section
      className="workflow-panel workflow-account-panel"
      aria-label="账号基本信息"
    >
      <div className="workflow-account-heading">
        <h3>基本信息</h3>
        {profile?.status && (
          <Tag>
            {changed
              ? "修改待确认"
              : profile.status === "confirmed"
                ? "已确认"
                : "已跳过"}
          </Tag>
        )}
      </div>
      <div className="workflow-account-fields">
        {fields.map((field) => (
          <label
            className={
              "workflow-field" + (field.short ? "" : " workflow-account-wide")
            }
            key={field.key}
          >
            <span>{field.label}</span>
            {field.short ? (
              <Input
                aria-label={field.label}
                value={current[field.key]}
                maxLength={field.limit}
                disabled={busy}
                placeholder={field.placeholder}
                onChange={(event) =>
                  onChange({ [field.key]: event.target.value })
                }
              />
            ) : (
              <Input.TextArea
                aria-label={field.label}
                value={current[field.key]}
                maxLength={field.limit}
                disabled={busy}
                placeholder={field.placeholder}
                autoSize={{ minRows: 3, maxRows: 7 }}
                onChange={(event) =>
                  onChange({ [field.key]: event.target.value })
                }
              />
            )}
          </label>
        ))}
      </div>
      <div className="workflow-account-actions">
        <Button disabled={busy} onClick={onSkip}>
          {skipLabel}
        </Button>
        <Button
          type="primary"
          loading={busy}
          disabled={
            !allowEmpty && !Object.values(current).some((text) => text.trim())
          }
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </section>
  );
}
