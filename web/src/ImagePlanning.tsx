import GenerateButton from "./components/GenerateButton";
import { Alert, App, Button, Collapse, Select, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import type { CreativeSettings, Job } from "./api";
import { post } from "./api";
import { creativeSignature } from "./creative";
import type { RewriteModel } from "./RewriteModels";

export default function ImagePlanning({
  creative = {},
  projectID,
  models,
  defaultModelID,
  count,
  copyText,
  prompt,
  referenceIDs,
  scenes,
  jobs,
  onApply,
  refresh,
  onBusyChange,
}: {
  creative?: CreativeSettings;
  projectID: string;
  models: RewriteModel[];
  defaultModelID: string;
  count: number;
  copyText: string;
  prompt: string;
  referenceIDs: string[];
  scenes: string[];
  jobs: Job[];
  onApply: (scenes: string[]) => void;
  refresh: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const { message } = App.useApp();
  const [chosen, setChosen] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingID, setPendingID] = useState("");
  const pending = useRef<{ id: string; fingerprint: string } | undefined>(
    undefined,
  );
  const sending = useRef(false);
  const fingerprint = JSON.stringify([
    creativeSignature(creative, "image"),
    count,
    copyText,
    prompt,
    referenceIDs,
    scenes,
  ]);
  const current = useRef(fingerprint);
  current.current = fingerprint;
  const modelID =
    chosen ||
    models.find(
      (m) => m.id === defaultModelID && (!referenceIDs.length || m.vision),
    )?.id ||
    models.find((m) => m.configured && (!referenceIDs.length || m.vision))
      ?.id ||
    defaultModelID;
  const model = models.find((m) => m.id === modelID);
  const own = jobs
    .filter((j) => j.kind === "image_plan" && j.target === projectID)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const active =
    submitting ||
    !!pendingID ||
    own.some((j) => ["queued", "running"].includes(j.state));
  const latest = own[0];
  const result = own.find(
    (j) => j.state === "succeeded" && j.payload?.plan?.scenes?.length,
  );
  useEffect(() => {
    onBusyChange(active);
  }, [active, onBusyChange]);
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    const j = jobs.find((j) => j.id === request.id);
    if (!j || ["queued", "running"].includes(j.state)) return;
    pending.current = undefined;
    setPendingID("");
    if (j.state === "succeeded" && j.payload?.plan?.scenes) {
      if (current.current === request.fingerprint) {
        onApply(j.payload.plan.scenes);
        message.success("每张画面已自动填好，可修改后再生成图片");
      } else {
        message.info(
          "规划已完成。你在等待时修改了内容，已保留修改；可展开规划查看并手动填入。",
          8,
        );
      }
    } else {
      message.error(j.error || "画面规划未完成，已保留原有描述");
    }
  }, [jobs, message, onApply]);
  const plan = async () => {
    if (sending.current || active) return;
    sending.current = true;
    setSubmitting(true);
    const submittedFingerprint = fingerprint;
    try {
      const r = await post(`/rewrites/${projectID}/plan-images`, {
        model_id: modelID,
        creative,
        count,
        copy_text: copyText,
        prompt,
        reference_asset_ids: referenceIDs,
      });
      pending.current = { id: r.job_id, fingerprint: submittedFingerprint };
      setPendingID(r.job_id);
      message.info("正在根据当前文案和参考画面规划，完成后自动填入描述");
      await refresh();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  };
  return (
    <div className="settings-form">
      <strong>1. 自动规划画面</strong>
      {result?.payload?.input &&
        (result.payload.input.copy_text !== copyText ||
          creativeSignature(result.payload.input.creative, "image") !==
            creativeSignature(creative, "image")) && (
          <Alert
            type="warning"
            message="文案或图片角度、钩子已修改，可重新规划"
            description="现有画面描述和图片已保留。重新规划只生成描述，确认后再生成图片。"
          />
        )}
      <Select
        aria-label="画面规划模型"
        value={modelID || undefined}
        placeholder="选择用于规划画面的文案模型"
        onChange={setChosen}
        options={models.map((m) => ({
          value: m.id,
          label: `${m.name} · ${m.model}${m.vision ? " · 图片理解" : " · 仅文字规划"}${m.configured ? "" : " · 待配置"}`,
        }))}
      />
      {(!model?.configured || (!!referenceIDs.length && !model.vision)) && (
        <Alert
          type="info"
          message={
            !model?.configured
              ? "画面规划模型待配置"
              : `${model.model} 无法用于参考图规划`
          }
          description={
            model?.vision_capability === "text"
              ? "qwen-plus 是纯文字模型。请在下拉框选择支持图片理解的模型（如 qwen3-vl-plus）；仅勾选能力不会让文字模型看懂图片。"
              : "请在下拉框选择图片理解模型；如没有可用模型，请联系管理员在管理控制台配置。普通文字模型仅可用于不带参考图的画面规划。"
          }
        />
      )}
      <small className="muted">
        读取当前文案和勾选图片，为每张安排具体画面。此步调用文案模型，只填写描述；修改满意后再点击生成图片。
      </small>
      <GenerateButton
        className="image-generation-action"
        onClick={plan}
        loading={active}
        disabled={
          active ||
          !model?.configured ||
          (!!referenceIDs.length && !model.vision) ||
          referenceIDs.length > 10 ||
          (!copyText.trim() && !prompt.trim() && !referenceIDs.length)
        }
      >
        {scenes.some((s) => s.trim())
          ? "重新规划并替换画面内容"
          : "AI 自动填充每张画面"}
      </GenerateButton>
      {latest &&
        ["failed", "blocked", "needs_review"].includes(latest.state) && (
          <Alert
            type="error"
            message="上次画面规划未完成"
            description={
              <>
                <div>{latest.error || latest.stage}</div>
                <small>
                  任务模型：
                  {latest.payload?.model ||
                    latest.payload?.model_name ||
                    "未记录"}
                  。这是上次任务的结果；修改配置后，请点击上方按钮重新规划。
                </small>
              </>
            }
          />
        )}
      {result?.payload?.plan && (
        <Collapse
          items={[
            {
              key: result.id,
              label: `查看最近的规划（${result.payload.plan.scenes.length} 张 · ${result.payload.model_name || "AI"}）`,
              children: (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <small className="muted">
                    以下基于提交时的文案和参考图。填入会替换现有逐张描述及张数，请核对后使用。
                  </small>
                  {result.payload.plan.scenes.map((s, i) => (
                    <p key={i}>
                      <strong>第 {i + 1} 张：</strong>
                      {s}
                    </p>
                  ))}
                  <Button
                    disabled={active}
                    onClick={() => onApply(result.payload!.plan!.scenes)}
                  >
                    将此规划填入画面内容
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
