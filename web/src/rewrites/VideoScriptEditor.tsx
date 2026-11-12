import type { PromptChoice } from "./SystemPromptEditor";
import type { ReactNode as PromptReactNode } from "react";
import { useEffect } from "react";
import { Alert, Input, InputNumber, Select } from "antd";
import { ClockCircleOutlined, RobotOutlined } from "@ant-design/icons";
import GenerationComposer from "./GenerationComposer";
import type { ReferenceInput } from "./ReferenceInputPanel";
import type { Job } from "../api";
import { post } from "../api";
import type { RewriteModel } from "../RewriteModels";

export type ScriptForm = {
  system_prompt_choice?: PromptChoice;
  text?: string;
  duration?: number;
  requirements?: string;
  model_id?: string;
  request_id?: string;
  input_key?: string;
  applied_job_id?: string;
};

export default function VideoScriptEditor({
  systemPrompt,
  promptControl,
  referenceInput,
  projectID,
  form,
  models,
  modelID,
  jobs,
  duration,
  inputKey,
  disabled,
  onEdit,
  run,
}: {
  systemPrompt: string;
  promptControl?: PromptReactNode;
  referenceInput: ReferenceInput;
  projectID: string;
  form: ScriptForm;
  models: RewriteModel[];
  modelID: string;
  jobs: Job[];
  duration: number;
  inputKey: string;
  disabled: boolean;
  onEdit: (patch: Partial<ScriptForm>) => void;
  run: (task: () => Promise<void>) => Promise<void>;
}) {
  const own = jobs.filter(
    (job) =>
      job.target === projectID &&
      job.kind === "video_plan" &&
      job.payload?.workflow_script,
  );
  const active = own.find((job) => ["queued", "running"].includes(job.state));
  const requested = own.find(
    (job) => job.payload?.request_id === form.request_id,
  );
  const working = disabled || !!active;
  useEffect(() => {
    if (
      requested?.state === "succeeded" &&
      requested.payload?.generated_script &&
      form.applied_job_id !== requested.id
    ) {
      onEdit({
        text: requested.payload.generated_script,
        applied_job_id: requested.id,
      });
    }
  }, [
    requested?.id,
    requested?.state,
    requested?.payload?.generated_script,
    form.applied_job_id,
    onEdit,
  ]);
  const generate = () => {
    const requestKey = JSON.stringify([
      inputKey,
      referenceInput,
      form.system_prompt_choice,
      form.requirements,
      modelID,
      duration,
    ]);
    const reuse =
      form.request_id &&
      form.input_key === requestKey &&
      (!requested || ["queued", "running"].includes(requested.state));
    const requestID = reuse ? form.request_id! : crypto.randomUUID();
    onEdit({ request_id: requestID, input_key: requestKey, model_id: modelID });
    void run(async () => {
      await post(`/rewrites/${projectID}/workflow/video-script`, {
        reference_input: referenceInput,
        requirements: form.requirements || "",
        model_id: modelID,
        duration,
        request_id: requestID,
      });
    });
  };
  return (
    <section className="video-script-editor" aria-label="视频脚本">
      {promptControl || (
        <label className="workflow-field">
          <span>脚本系统提示词</span>
          <Input.TextArea
            aria-label="脚本系统提示词"
            readOnly
            value={systemPrompt}
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </label>
      )}
      <GenerationComposer
        label="视频脚本"
        value={form.requirements || ""}
        onChange={(requirements) => onEdit({ requirements })}
        working={working}
        disabled={
          working || !models.some((m) => m.id === modelID && m.configured)
        }
        loading={!!active}
        onGenerate={generate}
        options={[
          {
            key: "script-model",
            label: "脚本生成模型",
            icon: <RobotOutlined />,
            value: models.find((m) => m.id === modelID)?.name || "选择模型",
            content: (
              <Select
                aria-label="脚本生成模型"
                value={modelID || undefined}
                disabled={working}
                options={models.map((m) => ({
                  value: m.id,
                  label: m.name + (m.configured ? "" : " · 待配置"),
                }))}
                onChange={(model_id) => onEdit({ model_id })}
              />
            ),
          },
          {
            key: "target-duration",
            label: "目标视频时长",
            icon: <ClockCircleOutlined />,
            value: `${duration} 秒`,
            keepOpen: true,
            content: (
              <InputNumber
                aria-label="目标视频时长"
                min={1}
                max={120}
                precision={0}
                value={duration}
                disabled={working}
                onChange={(value) =>
                  value !== null && onEdit({ duration: value })
                }
              />
            ),
          },
        ]}
      />
      <h3>视频脚本</h3>
      <Input.TextArea
        aria-label="视频脚本"
        value={form.text || ""}
        disabled={working}
        onChange={(event) => onEdit({ text: event.target.value })}
        maxLength={12000}
        autoSize={{ minRows: 5, maxRows: 14 }}
      />
      {requested &&
        ["failed", "blocked", "waiting_config", "needs_review"].includes(
          requested.state,
        ) && (
          <Alert
            type="error"
            message={requested.error || "脚本生成失败，请重试"}
          />
        )}
    </section>
  );
}
