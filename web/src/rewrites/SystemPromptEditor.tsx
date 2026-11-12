import { Alert, Button, Input, Select, Space, Switch } from "antd";
export type PromptTemplate = {
  id: string;
  scope: string;
  name: string;
  prompt: string;
  revision: number;
  is_default: boolean;
};
export type PromptChoice = {
  enabled: boolean;
  text: string;
  template_id?: string;
  template_revision?: number;
};
export default function SystemPromptEditor({
  scope,
  choice,
  templates,
  disabled,
  onChange,
}: {
  scope: string;
  choice: PromptChoice;
  templates: PromptTemplate[];
  disabled: boolean;
  onChange: (value: PromptChoice) => void;
}) {
  const available = templates.filter((t) => t.scope === scope),
    selected = available.find((t) => t.id === choice.template_id);
  const reset = (id?: string) => {
    const t =
      available.find((t) => t.id === id) ||
      available.find((t) => t.is_default) ||
      available[0];
    onChange({
      ...choice,
      text: t?.prompt || "",
      template_id: t?.id,
      template_revision: t?.revision,
    });
  };
  return (
    <section className="workflow-field" aria-label={scope + "系统提示词设置"}>
      <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
        <span>系统提示词</span>
        <Switch
          aria-label="使用系统提示词"
          checkedChildren="使用"
          unCheckedChildren="不使用"
          checked={choice.enabled}
          disabled={disabled}
          onChange={(enabled) => onChange({ ...choice, enabled })}
        />
      </Space>
      <Space wrap>
        <Select
          aria-label="选用管理员提示词"
          placeholder="选择管理员模板"
          style={{ minWidth: 190 }}
          value={selected?.id}
          disabled={disabled || !choice.enabled}
          options={available.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(id) => reset(id)}
        />
        <Button
          disabled={disabled || !choice.enabled || !available.length}
          onClick={() => reset(choice.template_id)}
        >
          恢复模板
        </Button>
      </Space>
      {selected && selected.revision !== choice.template_revision && (
        <Alert
          type="info"
          message="管理员模板已更新，当前修改已保留；点击恢复模板可使用新版。"
        />
      )}
      <Input.TextArea
        aria-label="系统提示词"
        value={choice.text}
        disabled={disabled || !choice.enabled}
        maxLength={8000}
        autoSize={{ minRows: 3, maxRows: 8 }}
        placeholder="选用管理员模板，或填写本项目使用的提示词"
        onChange={(e) => onChange({ ...choice, text: e.target.value })}
      />
    </section>
  );
}
