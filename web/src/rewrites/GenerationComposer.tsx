import { useEffect, useState, type ReactNode } from "react";
import { Button, Input, Popover } from "antd";
import { ArrowUpOutlined } from "@ant-design/icons";

export type GenerationOption = {
  key: string;
  label: string;
  icon: ReactNode;
  value?: string;
  content: ReactNode;
  keepOpen?: boolean;
  compact?: boolean;
  accelerating?: boolean;
};

export function GenerationSetting({
  option,
  disabled = false,
}: {
  option: GenerationOption;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled || !option.keepOpen) setOpen(false);
  }, [option.value, disabled]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  const name = `${option.label}${option.value ? `：${option.value}` : ""}`;
  return (
    <Popover
      trigger="click"
      placement="topRight"
      open={open && !disabled}
      onOpenChange={setOpen}
      overlayClassName={`generation-option-popover${option.compact ? " generation-option-popover-compact" : ""}`}
      content={
        <section
          className={`generation-option-panel${option.compact ? " generation-option-panel-compact" : ""}`}
          role="region"
          aria-label={option.label + "设置"}
        >
          <h4>{option.label}</h4>
          {option.content}
        </section>
      }
    >
      <Button
        type="text"
        className={`generation-option-button${option.accelerating ? " has-sound-particles" : ""}`}
        icon={
          option.accelerating ? (
            <span className="generation-sound-icon">
              {option.icon}
              <span className="generation-sound-particles" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
            </span>
          ) : (
            option.icon
          )
        }
        aria-label={name}
        title={name}
        aria-expanded={open && !disabled}
        disabled={disabled}
      >
        {option.key === "model" || option.key === "script-model" ? (
          option.value || "选择模型"
        ) : (
          <>
            {(
              {
                model: "模型",
                "script-model": "脚本模型",
                "target-duration": "目标时长",
                ratio: "比例",
                quality: "清晰度",
                audio: "声音",
                count: "数量",
              } as Record<string, string>
            )[option.key] || option.label}
            {option.value ? ` ${option.value}` : ""}
          </>
        )}
      </Button>
    </Popover>
  );
}

export default function GenerationComposer({
  label,
  value,
  onChange,
  options,
  working,
  disabled,
  loading,
  onGenerate,
  placeholder = "添加补充要求…",
  hint,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: GenerationOption[];
  working: boolean;
  disabled: boolean;
  loading: boolean;
  onGenerate: () => void;
  placeholder?: string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`generation-composer ${className}`}
      role="group"
      aria-label={label + "生成栏"}
    >
      <div className="generation-composer-pill">
        <Input.TextArea
          className="generation-composer-input"
          aria-label={label + "补充要求"}
          value={value}
          placeholder={placeholder}
          disabled={working}
          maxLength={4000}
          autoSize={{ minRows: 1, maxRows: 5 }}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="generation-composer-actions">
          <div
            className="generation-composer-options"
            role="group"
            aria-label="生成参数"
          >
            {options.map((option) => (
              <GenerationSetting
                key={option.key}
                option={option}
                disabled={working}
              />
            ))}
          </div>
          <Button
            type="primary"
            shape="circle"
            className="generation-composer-submit"
            aria-label="开始生成"
            title="开始生成"
            icon={<ArrowUpOutlined />}
            loading={loading}
            disabled={disabled}
            onClick={onGenerate}
          />
        </div>
      </div>
      {hint && (
        <div className="generation-composer-feedback" role="status">
          {hint}
        </div>
      )}
    </div>
  );
}
