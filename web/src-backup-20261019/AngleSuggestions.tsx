import { Alert, App, Button, Input, Space } from "antd";
import { useRef, useState } from "react";
import type { CreativeSettings, Job } from "./api";
import { post } from "./api";

export default function AngleSuggestions({
  projectID,
  modelID,
  configured,
  sourceIDs,
  hasReferenceContent = false,
  text = "",
  audience,
  requirements,
  creative,
  jobs,
  refresh,
  onChoose,
}: {
  projectID: string;
  modelID: string;
  configured: boolean;
  sourceIDs: string[];
  hasReferenceContent?: boolean;
  text?: string;
  audience: string;
  requirements: string;
  creative: CreativeSettings;
  jobs: Job[];
  refresh: () => Promise<void>;
  onChoose: (angle: string) => void;
}) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [requested, setRequested] = useState<{ id: string; input: string }>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const input = JSON.stringify([
    modelID,
    sourceIDs,
    text,
    audience,
    requirements,
    creative,
  ]);
  const hasContent = !!(
    hasReferenceContent ||
    text.trim() ||
    creative.topic?.trim() ||
    requirements.trim() ||
    creative.angle?.trim()
  );
  const own = jobs
    .filter((j) => j.kind === "angle_suggest" && j.target === projectID)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const active =
    busy || own.some((j) => ["queued", "running"].includes(j.state));
  const latest = own[0];
  const current =
    requested?.input === input
      ? own.find((j) => j.id === requested.id)
      : undefined;
  const shown = current || (historyOpen ? latest : undefined);
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Button
        loading={active}
        disabled={active || !configured || !hasContent}
        onClick={async () => {
          if (sending.current || !hasContent || !configured) return;
          sending.current = true;
          setBusy(true);
          try {
            const result = await post<{ job_id: string }>(
              `/rewrites/${projectID}/suggest-angles`,
              {
                model_id: modelID,
                source_ids: sourceIDs,
                copy_text: text,
                audience,
                requirements,
                creative,
              },
            );
            setRequested({ id: result.job_id, input });
            setHistoryOpen(false);
            message.info("正在生成角度建议，完成后请手动选用");
            await refresh();
          } catch (e) {
            message.error((e as Error).message);
          } finally {
            sending.current = false;
            setBusy(false);
          }
        }}
      >
        AI 建议角度
      </Button>
      <small className="muted">
        {hasContent
          ? "角度可以留空。主题或文案任选其一，两者都有时结合分析，也会参考勾选的帖子，提出 3 个话题供你选择。"
          : "先填写主题或文案，也可以填写创作要求或勾选有文字的参考内容；不必同时填写主题和文案。"}
      </small>
      {latest && !current && (
        <Button
          type="link"
          size="small"
          onClick={() => setHistoryOpen((v) => !v)}
        >
          {historyOpen ? "收起上次任务记录" : "查看上次任务记录"}
        </Button>
      )}
      {shown?.payload?.angles && (
        <div>
          <small className="muted">
            {current ? "本次建议" : "上次建议"} ·{" "}
            {shown.payload.model_name || shown.payload.model}
            （依据提交时内容）
          </small>
          {shown.payload.angles.map((a, i) => (
            <div key={i} style={{ padding: "8px 0" }}>
              {i + 1}. {a}{" "}
              <Button size="small" onClick={() => onChoose(a)}>
                选用此角度
              </Button>
            </div>
          ))}
        </div>
      )}
      {shown?.payload?.angle_text && (
        <div>
          <small className="muted">
            AI 的话题建议 · {shown.payload.model_name || shown.payload.model}
            。可复制其中喜欢的话题，填入创作角度后再修改。
          </small>
          <Input.TextArea
            aria-label="AI 话题建议原文"
            readOnly
            value={shown.payload.angle_text}
            autoSize={{ minRows: 4, maxRows: 16 }}
          />
        </div>
      )}
      {shown && ["failed", "blocked", "needs_review"].includes(shown.state) && (
        <Alert
          type="warning"
          message={
            current
              ? "本次角度建议生成失败"
              : "上次任务未完成（并非当前输入错误）"
          }
          description={
            (shown.error || shown.stage) ===
            "角度建议格式不正确，请重试或手动填写"
              ? "模型返回的建议格式不符合要求，不是你填错了；可以重新生成或手动填写角度。"
              : shown.error || shown.stage
          }
        />
      )}
    </Space>
  );
}
