import { Alert, Button, Input, Modal, Space, Spin } from "antd";
function describe(value: Record<string, unknown>) {
  const labels: Record<string, string> = {
    custom_title: "自定义标题",
    text: "内容",
    body: "正文",
    title: "标题",
    requirements: "补充要求",
    account_name: "账号名称",
    style: "风格",
    duration: "目标时长",
    quality: "清晰度",
    ratio: "比例",
    audio: "声音",
  };
  const parts = Object.entries(labels).flatMap(([key, label]) =>
    value[key] !== undefined && value[key] !== ""
      ? [`${label}：${String(value[key])}`]
      : [],
  );
  const prompt = value.system_prompt_choice as
    | { enabled?: boolean; text?: string }
    | undefined;
  if (prompt)
    parts.push(
      `系统提示词（${prompt.enabled ? "使用" : "不使用"}）：${prompt.text || ""}`,
    );
  const reference = value.reference_input as
    | { title?: string; body?: string }
    | undefined;
  if (reference)
    parts.push(
      `参考标题：${reference.title || ""}`,
      `参考文案：${reference.body || ""}`,
    );
  for (const field of ["asset_ids", "reference_asset_ids", "upload_slots"]) {
    if (Array.isArray(value[field]))
      parts.push(`素材数量：${(value[field] as unknown[]).length}`);
  }
  return parts.join("\n\n") || "此步骤的选项或素材设置";
}
export default function DraftConflictDialog({
  local,
  server,
  error,
  working,
  onReload,
  onLocal,
  onServer,
  onClose,
}: {
  local: Record<string, unknown>;
  server?: Record<string, unknown>;
  error: string;
  working: boolean;
  onReload: () => void;
  onLocal: () => void;
  onServer: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      title="核对未保存的草稿"
      width={850}
      onCancel={onClose}
      footer={
        <Space wrap>
          <Button onClick={onClose} disabled={working}>
            稍后处理
          </Button>
          <Button onClick={onReload} disabled={working}>
            重新读取服务器版本
          </Button>
          <Button onClick={onServer} disabled={!server || working}>
            使用服务器版本
          </Button>
          <Button
            type="primary"
            onClick={onLocal}
            disabled={!server || working}
          >
            保留本页修改并保存
          </Button>
        </Space>
      }
    >
      <Alert
        type="warning"
        message="本页修改已保留。保留本页修改并保存会替换此步骤的服务器草稿；也可以采用服务器版本。"
      />
      {error && <Alert type="error" message={error} />}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginTop: 16,
        }}
      >
        <label>
          本页修改
          <Input.TextArea
            aria-label="冲突的本页草稿"
            readOnly
            value={describe(local)}
            rows={12}
          />
        </label>
        <label>
          服务器版本
          {server ? (
            <Input.TextArea
              aria-label="冲突的服务器草稿"
              readOnly
              value={describe(server)}
              rows={12}
            />
          ) : (
            <Spin />
          )}
        </label>
      </div>
    </Modal>
  );
}
