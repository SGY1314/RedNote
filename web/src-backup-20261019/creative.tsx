import { Input, Select } from "antd";
import { useState } from "react";
import type { CreativeSettings, Version } from "./api";

export const imageHookOptions = [
  { value: "auto", label: "自动选择" },
  { value: "problem", label: "问题场景" },
  { value: "detail", label: "细节特写" },
  { value: "contrast", label: "前后对比" },
  { value: "result", label: "结果展示" },
  { value: "custom", label: "自定义" },
];
export const videoHookOptions = [
  { value: "auto", label: "自动选择" },
  { value: "action", label: "动作开场" },
  { value: "problem", label: "问题场景" },
  { value: "question", label: "提问开场" },
  { value: "result", label: "先展示结果" },
  { value: "custom", label: "自定义" },
];
export function readCreative(id: string): CreativeSettings | undefined {
  try {
    const value = JSON.parse(
      localStorage.getItem("gin.creative." + id) || "null",
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
export function useCreativeSettings(id: string) {
  const [state, setState] = useState<{ id: string; value: CreativeSettings }>(
    () => ({ id, value: readCreative(id) || {} }),
  );
  const value = state.id === id ? state.value : readCreative(id) || {};
  const update = (next: CreativeSettings) => {
    setState({ id, value: next });
    try {
      localStorage.setItem("gin.creative." + id, JSON.stringify(next));
    } catch {
      /* The complete version can still be saved on the backend. */
    }
  };
  return [value, update] as const;
}
export function creativeSignature(
  c: CreativeSettings | undefined,
  medium: "image" | "video",
) {
  return JSON.stringify([
    c?.topic || "",
    c?.[`${medium}_angle`]?.trim() || c?.angle || "",
    c?.[`${medium}_hook`] || "auto",
    c?.[`${medium}_hook`] === "custom" ? c?.[`${medium}_custom`] || "" : "",
  ]);
}
export function CreativeControls({
  medium,
  value,
  onChange,
  disabled = false,
}: {
  medium: "image" | "video";
  value: CreativeSettings;
  onChange: (v: CreativeSettings) => void;
  disabled?: boolean;
}) {
  const label = medium === "image" ? "首图吸引方式" : "开头吸引方式";
  const options = medium === "image" ? imageHookOptions : videoHookOptions;
  return (
    <div className="settings-form" style={{ width: "100%" }}>
      <label>
        {medium === "image" ? "图片" : "视频"}发帖角度（留空沿用文案角度）
        <Input.TextArea
          aria-label={`${medium}发帖角度`}
          maxLength={1000}
          rows={2}
          disabled={disabled}
          value={value[`${medium}_angle`] || ""}
          placeholder={
            value.angle || "沿用文案角度；尚未填写时由模型根据内容确定"
          }
          onChange={(e) =>
            onChange({ ...value, [`${medium}_angle`]: e.target.value })
          }
        />
      </label>
      <label>
        {label}
        <Select
          aria-label={label}
          style={{ width: "100%" }}
          disabled={disabled}
          value={value[`${medium}_hook`] || "auto"}
          options={options}
          onChange={(v) => onChange({ ...value, [`${medium}_hook`]: v })}
        />
      </label>
      {value[`${medium}_hook`] === "custom" && (
        <Input.TextArea
          aria-label={`自定义${label}`}
          rows={2}
          maxLength={1000}
          value={value[`${medium}_custom`] || ""}
          disabled={disabled}
          placeholder="写明开头要呈现的具体场景、动作或看点"
          onChange={(e) =>
            onChange({ ...value, [`${medium}_custom`]: e.target.value })
          }
        />
      )}
    </div>
  );
}
export function VersionCreative({ version }: { version: Version }) {
  const c = version.creative;
  return (
    <div className="settings-form">
      <div>创作主题：{c?.topic || "未填写"}</div>
      <div>发帖角度：{c?.angle || "未填写"}</div>
      {(["image", "video"] as const).map((m) => (
        <div key={m}>
          {m === "image" ? "图片" : "视频"}角度：
          {c?.[`${m}_angle`] || c?.angle || "自动确定"}；
          {m === "image" ? "首图" : "开头"}钩子：
          {c
            ? (m === "image" ? imageHookOptions : videoHookOptions).find(
                (o) => o.value === (c[`${m}_hook`] || "auto"),
              )?.label
            : "未记录"}
          {c?.[`${m}_hook`] === "custom" && ` · ${c[`${m}_custom`]}`}
        </div>
      ))}
      {!!version.generation_records?.length && (
        <details>
          <summary>
            查看所选素材的生成记录（{version.generation_records.length}）
          </summary>
          <small className="muted">
            下方为素材生成时的画面、脚本和设置；可能与后来修改的版本角度不同。
          </small>
          {version.generation_records.map((r) => (
            <div key={r.asset_id}>
              <strong>
                {r.kind === "image_generation" ? "图片" : "视频"} ·{" "}
                {r.model || "模型未记录"}
              </strong>
              <GenerationDetails details={r.details} />
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function GenerationDetails({ details }: { details: Record<string, unknown> }) {
  const c = details.creative as CreativeSettings | undefined;
  const script = details.script as
    | {
        title: string;
        concept: string;
        style: string;
        brief: {
          creative?: CreativeSettings;
          duration: number;
          requirements: string;
        };
        shots: {
          duration: number;
          visual: string;
          camera: string;
          narration: string;
        }[];
      }
    | undefined;
  const medium = script ? "video" : "image";
  const original = script?.brief.creative || c;
  const hook = original?.[`${medium}_hook`] || "auto";
  return (
    <div
      style={{
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        maxHeight: 420,
        overflow: "auto",
        padding: "12px 0",
      }}
    >
      <div>
        生成时角度：
        {original?.[`${medium}_angle`] || original?.angle || "未填写"}
      </div>
      <div>
        生成时钩子：
        {original
          ? (medium === "image" ? imageHookOptions : videoHookOptions).find(
              (o) => o.value === hook,
            )?.label
          : "未记录"}
        {hook === "custom" ? ` · ${original?.[`${medium}_custom`]}` : ""}
      </div>
      {typeof details.size === "string" && details.size && (
        <div>尺寸：{details.size}</div>
      )}
      {typeof details.prompt === "string" && <p>画面要求：{details.prompt}</p>}
      {Array.isArray(details.scenes) &&
        details.scenes.map((s, i) => (
          <p key={i}>
            第 {i + 1} 张：{String(s)}
          </p>
        ))}
      {script && (
        <>
          <strong>
            {script.title} · {script.brief.duration} 秒
          </strong>
          <p>完整故事：{script.concept}</p>
          <p>统一风格：{script.style}</p>
          {script.shots.map((s, i) => (
            <div key={i}>
              <strong>
                画面 {i + 1} · {s.duration} 秒
              </strong>
              <p>{s.visual}</p>
              <p>运镜：{s.camera}</p>
              <p>口播：{s.narration || "无"}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
