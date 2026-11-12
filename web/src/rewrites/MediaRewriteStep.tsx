import type { PromptChoice } from "./SystemPromptEditor";
import type { ReactNode as PromptReactNode } from "react";
import { useState } from "react";
import type { ReactNode } from "react";
import { App, Alert, Button, Input, Select, Switch } from "antd";
import {
  CheckOutlined,
  BorderOutlined,
  CopyOutlined,
  PictureOutlined,
  RobotOutlined,
  SoundOutlined,
  SendOutlined,
} from "@ant-design/icons";
import type { Asset, Job } from "../api";
import { api, post } from "../api";
import type { RewriteModel } from "../RewriteModels";
import { splitNoteText } from "../noteText";
import { WorkflowActionBar, WorkflowResultPanel } from "./WorkflowControls";
import SourceMediaCarousel from "./SourceMediaCarousel";
import OriginalCreationInput from "./OriginalCreationInput";
import VideoResultCarousel from "./VideoResultCarousel";
import ImageResultTimeline from "./ImageResultTimeline";
import ResultMediaAdd from "./ResultMediaAdd";
import { inMediaLibrary } from "../assetLibrary";
import ImageReferencePanel from "./ImageReferencePanel";
import GenerationComposer, {
  type GenerationOption,
} from "./GenerationComposer";
import "./media-rewrite.css";
import "./title-rewrite.css";

export type MediaForm = {
  system_prompt_choice?: PromptChoice;
  model_id?: string;
  reference_asset_ids?: string[];
  reference_input?: import("./ReferenceInputPanel").ReferenceInput;
  excluded_reference_asset_ids?: string[];
  requirements?: string;
  quality?: string;
  ratio?: string;
  count?: number;
  duration?: number;
  audio?: boolean;
  upload_slots?: string[];
  result_asset_ids?: string[];
  excluded_result_asset_ids?: string[];
  selected_asset_ids?: string[];
  cover_id?: string;
};
export type MediaSnapshot = {
  script?: string;
  kind: string;
  model_id: string;
  source_ids: string[];
  revision_id: string;
  copy_key?: string;
  account_key?: string;
  requirements: string;
  quality: string;
  ratio: string;
  count: number;
  duration?: number;
  audio: boolean;
};
export function mediaJobIDs(job: Job): string[] {
  return (
    job.payload?.series?.asset_ids ||
    job.payload?.production?.shots
      .map((shot) => shot.asset_id || "")
      .filter(Boolean) ||
    (job.result ? [job.result] : [])
  );
}
export default function MediaRewriteStep({
  kind,
  projectID,
  revisionID,
  copyKey,
  accountKey,
  title,
  body,
  topics,
  sources,
  assets,
  jobs,
  models,
  modelID,
  form,
  systemPrompt,
  promptControl,
  scriptText = "",
  scriptControl,
  busy,
  selected,
  onEdit,
  onUploaded,
  onSelection,
  run,
  onConfirm,
  onPublish,
  sourceControl,
  imageContextControl,
}: {
  kind: "image" | "video";
  projectID: string;
  revisionID: string;
  copyKey: string;
  accountKey: string;
  title: string;
  body: string;
  topics: string[];
  sources: Asset[];
  assets: Asset[];
  jobs: Job[];
  models: RewriteModel[];
  modelID: string;
  form: MediaForm;
  systemPrompt: string;
  promptControl?: PromptReactNode;
  scriptText?: string;
  scriptControl?: ReactNode;
  busy: boolean;
  selected: string[];
  onEdit: (patch: Partial<MediaForm>) => void;
  onUploaded: (asset: Asset) => void;
  onSelection: (ids: string[]) => void;
  run: (task: () => Promise<void>) => Promise<void>;
  onConfirm: () => void;
  onPublish: () => void;
  sourceControl?: ReactNode;
  imageContextControl?: ReactNode;
}) {
  const { message } = App.useApp();
  const [previewID, setPreviewID] = useState("");
  const [uploading, setUploading] = useState(false);
  const video = kind === "video",
    label = video ? "视频" : "图片";
  const referenceCandidates = [
    ...new Map(
      [
        ...sources,
        ...assets.filter(
          (asset) =>
            form.reference_asset_ids?.includes(asset.id) ||
            form.excluded_reference_asset_ids?.includes(asset.id),
        ),
      ].map((asset) => [asset.id, asset]),
    ).values(),
  ].filter(
    (asset) =>
      asset.kind === kind && asset.status === "ready" && !asset.deleted_at,
  );
  const excludedReferences = form.excluded_reference_asset_ids || [];
  const original = referenceCandidates.filter(
    (asset) => !excludedReferences.includes(asset.id),
  );
  const missingSource = !sources.some(
    (asset) =>
      asset.kind === kind && asset.status === "ready" && !asset.deleted_at,
  );
  const sourceIDs = (
    (form.reference_input
      ? form.reference_input.use_images
        ? form.reference_input.asset_ids
        : []
      : undefined) ??
    form.reference_asset_ids ??
    (video ? original.slice(0, 1) : original.slice(0, 3)).map(
      (asset) => asset.id,
    )
  ).filter((id) => !excludedReferences.includes(id));
  const preview =
    original.find((asset) => asset.id === previewID) ||
    original.find((asset) => sourceIDs.includes(asset.id)) ||
    original[0];
  const count = form.count || (video ? 1 : 3),
    quality = form.quality || (video ? "720p" : "2k"),
    ratio = form.ratio || (video ? "9:16" : "3:4"),
    duration = form.duration || 10,
    audio = form.audio ?? true;
  const model = models.find((item) => item.id === modelID);
  const own = jobs
    .filter(
      (job) =>
        job.target === projectID &&
        job.kind === (video ? "video_generate" : "image_generation"),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const running = own.some((job) => ["queued", "running"].includes(job.state));
  const unresolved =
    video &&
    own.some((job) =>
      job.payload?.production?.shots.some(
        (shot) => !shot.remote_id && shot.state === "submitting",
      ),
    );
  const scriptRunning =
    video &&
    jobs.some(
      (job) =>
        job.target === projectID &&
        job.kind === "video_plan" &&
        job.payload?.workflow_script &&
        ["queued", "running"].includes(job.state),
    );
  const working = busy || running || scriptRunning || uploading;
  const parameters = {
    system_prompt_choice: form.system_prompt_choice,
    model_id: modelID,
    reference_asset_ids: video ? [] : sourceIDs,
    reference_input: form.reference_input,
    requirements: (form.requirements || "").trim(),
    quality,
    ratio,
    count,
    ...(video ? { duration, audio, script: scriptText.trim() } : {}),
  };
  const allIDs = [
    ...new Set([
      ...own.flatMap(mediaJobIDs),
      ...assets
        .filter(
          (asset) =>
            asset.kind === kind &&
            asset.source !== "collection" &&
            (asset.project_id === projectID || selected.includes(asset.id)),
        )
        .map((asset) => asset.id),
    ]),
  ];
  const results = allIDs
    .map((id) => assets.find((asset) => asset.id === id))
    .filter(
      (asset): asset is Asset =>
        !!asset &&
        asset.kind === kind &&
        asset.status === "ready" &&
        !(form.excluded_result_asset_ids || []).includes(asset.id) &&
        !asset.deleted_at,
    );
  const timelineEntries = results
    .filter(
      (asset) =>
        own.some((job) => mediaJobIDs(job).includes(asset.id)) ||
        (asset.source === "generated" && asset.project_id === projectID),
    )
    .map((asset) => {
      const job = own.find((job) => mediaJobIDs(job).includes(asset.id));
      return {
        asset,
        createdAt: job?.created_at || asset.created_at || "",
        model: job?.payload?.model_name,
        label: asset.name,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const libraryEntries = assets
    .filter(
      (asset) =>
        form.result_asset_ids?.includes(asset.id) &&
        asset.kind === kind &&
        asset.status === "ready" &&
        !asset.deleted_at &&
        inMediaLibrary(asset),
    )
    .filter(
      (asset) => !(form.excluded_result_asset_ids || []).includes(asset.id),
    )
    .filter(
      (asset) => !timelineEntries.some((entry) => entry.asset.id === asset.id),
    )
    .map((asset) => ({
      asset,
      createdAt: asset.created_at || "",
      label: asset.name || `素材库${label}`,
    }));
  const imageEntries = [...timelineEntries, ...libraryEntries];
  const uploaded = assets.filter(
    (asset) =>
      asset.project_id === projectID &&
      asset.source === "upload" &&
      (video || !!form.upload_slots?.includes(asset.id)) &&
      asset.kind === kind &&
      asset.status === "ready" &&
      !(form.excluded_result_asset_ids || []).includes(asset.id) &&
      !asset.deleted_at,
  );
  const savedSlots = form.upload_slots?.length ? form.upload_slots : [];
  const filledSlots = [
    ...new Set([
      ...savedSlots.filter((id) => uploaded.some((asset) => asset.id === id)),
      ...uploaded
        .filter((asset) => !savedSlots.includes(asset.id))
        .map((asset) => asset.id),
    ]),
  ];
  const slotIDs = [...filledSlots, ""];
  const uploadSlots = slotIDs.map((id) =>
    uploaded.find((asset) => asset.id === id),
  );
  const upload = async (index: number, file: File) => {
    if (working) return;
    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", file);
      data.append("project_id", projectID);
      const asset = await api<Asset>("/assets", { method: "POST", body: data });
      onUploaded(asset);
      const next = [...slotIDs];
      next[index] = asset.id;
      const previous = slotIDs[index];
      onEdit({
        upload_slots: [...next.filter(Boolean), ""],
        excluded_result_asset_ids: previous
          ? [...new Set([...(form.excluded_result_asset_ids || []), previous])]
          : form.excluded_result_asset_ids,
        selected_asset_ids: selected.map((id) =>
          id === previous ? asset.id : id,
        ),
        cover_id:
          !video && form.cover_id === previous ? asset.id : form.cover_id,
      });
    } finally {
      setUploading(false);
    }
  };
  const addControl = (
    <ResultMediaAdd
      kind={kind}
      assets={assets}
      disabled={working}
      onAdd={(ids) =>
        onEdit({
          result_asset_ids: [
            ...new Set([...(form.result_asset_ids || []), ...ids]),
          ],
          excluded_result_asset_ids: (
            form.excluded_result_asset_ids || []
          ).filter((id) => !ids.includes(id)),
        })
      }
      onUpload={(file) => upload(slotIDs.length - 1, file)}
    />
  );
  const picked = selected.filter((id) =>
    video
      ? imageEntries.some(({ asset }) => asset.id === id) ||
        uploaded.some((asset) => asset.id === id)
      : imageEntries.some(({ asset }) => asset.id === id) ||
        uploaded.some((asset) => asset.id === id),
  );
  const removeResult = (id: string) => {
    if (working) return;
    const remaining = picked.filter((value) => value !== id);
    onEdit({
      excluded_result_asset_ids: [
        ...new Set([...(form.excluded_result_asset_ids || []), id]),
      ],
      result_asset_ids: (form.result_asset_ids || []).filter(
        (value) => value !== id,
      ),
      upload_slots: [
        ...(form.upload_slots || []).filter((value) => value && value !== id),
        "",
      ],
      selected_asset_ids: remaining,
      cover_id:
        !video &&
        (form.cover_id === id || !remaining.includes(form.cover_id || ""))
          ? remaining[0] || ""
          : form.cover_id,
    });
  };
  const min = model?.continuous_min || 4,
    max = model?.continuous_max || 30;
  let reason = "";
  if (video && !scriptText.trim()) reason = "请填写视频脚本";
  else if (
    !video &&
    sourceIDs.length > 0 &&
    model?.configured &&
    !model.reference_limit
  )
    reason = `当前模型不支持原${label}参考`;
  else if (
    !video &&
    model?.reference_limit &&
    sourceIDs.length > model.reference_limit
  )
    reason = `当前模型最多参考${model.reference_limit}张图片`;
  else if (video && (duration < min || duration > max))
    reason = `当前模型支持${min}至${max}秒，请在脚本生成栏调整目标时长`;
  else if (unresolved) reason = "已有任务状态待核实";
  // Ambiguous natural-language instructions are advisory and never block generation.
  const positiveTime = (value: string) =>
    value.replace(
      /(?:不要|避免|禁止|不是|不在|无需)(?:使用|设置为|改为)?(?:白天|日间|夜晚|夜间)/g,
      "",
    );
  const day = (s: string) => /白天|日间/.test(positiveTime(s));
  const night = (s: string) => /夜晚|夜间/.test(positiveTime(s));
  const extra = form.requirements || "";
  const timeNotice =
    video &&
    ((day(scriptText) && !night(scriptText) && night(extra) && !day(extra)) ||
      (night(scriptText) && !day(scriptText) && day(extra) && !night(extra)))
      ? "脚本和补充要求的场景时间可能不同，请核对；确认无误仍可生成。"
      : "";
  const generate = () => {
    if (video && !scriptText.trim()) {
      message.warning("请填写视频脚本");
      document
        .querySelector<HTMLTextAreaElement>('textarea[aria-label="视频脚本"]')
        ?.focus();
      return;
    }
    void run(async () => {
      const key = JSON.stringify([
        parameters,
        revisionID,
        video ? "" : copyKey,
        accountKey,
        video ? scriptText.trim() : "",
      ]);
      const cacheKey = `rednote.media.request.${projectID}.${kind}`;
      let cached: { key?: string; id?: string; jobID?: string } = {};
      try {
        cached = JSON.parse(localStorage.getItem(cacheKey) || "{}");
      } catch {}
      const old = own.find((job) => job.id === cached.jobID);
      const reuse =
        cached.key === key &&
        cached.id &&
        (!old || ["queued", "running"].includes(old.state));
      const requestID = reuse ? cached.id! : crypto.randomUUID();
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ key, id: requestID }));
      } catch {}
      const result = await post<{ job_id: string }>(
        `/rewrites/${projectID}/${video ? "workflow/video" : "generate-image"}`,
        { ...parameters, direct: true, request_id: requestID },
      );
      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({ key, id: requestID, jobID: result.job_id }),
        );
      } catch {}
    });
  };
  const toggleSource = (id: string) =>
    onEdit({
      reference_asset_ids: video
        ? [id]
        : sourceIDs.includes(id)
          ? sourceIDs.filter((value) => value !== id)
          : [...sourceIDs, id],
    });
  const uploadReference = async (file: File, replaceID?: string) => {
    if (working) return;
    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", file);
      data.append("project_id", projectID);
      const asset = await api<Asset>("/assets", { method: "POST", body: data });
      onUploaded(asset);
      onEdit({
        reference_asset_ids: [
          ...sourceIDs.filter((id) => id !== replaceID),
          asset.id,
        ],
      });
      setPreviewID(asset.id);
    } finally {
      setUploading(false);
    }
  };
  const note = splitNoteText(body, topics);
  const options: GenerationOption[] = [
    {
      key: "model",
      label: `${label}生成模型`,
      icon: <RobotOutlined />,
      value: model?.name || "选择模型",
      content: (
        <Select
          aria-label={`${label}生成模型`}
          value={modelID || undefined}
          placeholder="选择模型"
          disabled={working}
          options={models.map((item) => ({
            value: item.id,
            label: item.name + (item.configured ? "" : " · 待配置"),
          }))}
          onChange={(id) => onEdit({ model_id: id })}
        />
      ),
    },
    {
      key: "ratio",
      label: `${label}长宽比`,
      icon: <BorderOutlined />,
      value: ratio,
      content: (
        <Select
          aria-label={`${label}长宽比`}
          value={ratio}
          disabled={working}
          options={["3:4", "1:1", "4:3", "9:16", "16:9"].map((value) => ({
            value,
            label: value,
          }))}
          onChange={(value) => onEdit({ ratio: value })}
        />
      ),
    },
    {
      key: "count",
      label: `${label}生成数量`,
      icon: <CopyOutlined />,
      value: `${count} ${video ? "条" : "张"}`,
      content: (
        <Select
          aria-label={`${label}生成数量`}
          value={count}
          disabled={working}
          options={Array.from({ length: video ? 3 : 6 }, (_, index) => ({
            value: index + 1,
            label: `${index + 1} ${video ? "条" : "张"}`,
          }))}
          onChange={(value) => onEdit({ count: value })}
        />
      ),
    },
    {
      key: "quality",
      label: `${label}画质`,
      icon: <PictureOutlined />,
      value: quality.toUpperCase(),
      content: (
        <Select
          aria-label={`${label}画质`}
          value={quality}
          disabled={working}
          options={(video ? ["480p", "720p", "1080p"] : ["1k", "2k", "4k"]).map(
            (value) => ({ value, label: value.toUpperCase() }),
          )}
          onChange={(value) => onEdit({ quality: value })}
        />
      ),
    },
  ];
  if (video)
    options.push({
      key: "audio",
      label: "视频声音",
      icon: <SoundOutlined />,
      value: audio ? "开启" : "关闭",
      compact: true,
      keepOpen: true,
      accelerating: audio && !working,
      content: (
        <Switch
          aria-label="视频声音"
          checked={audio}
          disabled={working}
          onChange={(value) => onEdit({ audio: value })}
        />
      ),
    });
  if (video)
    options.sort(
      (a, b) =>
        ["model", "ratio", "quality", "audio", "count"].indexOf(a.key) -
        ["model", "ratio", "quality", "audio", "count"].indexOf(b.key),
    );
  const composer = (
    <GenerationComposer
      label={video ? "视频生成" : "图片仿写"}
      value={form.requirements || ""}
      onChange={(requirements) => onEdit({ requirements })}
      options={options}
      working={working}
      disabled={
        working ||
        !model?.configured ||
        (!!reason && reason !== "请填写视频脚本")
      }
      loading={running || uploading}
      onGenerate={generate}
      className={
        video ? "video-generation-composer" : "image-generation-composer"
      }
      hint={
        <>
          {timeNotice && <Alert type="warning" message={timeNotice} />}
          {reason &&
          reason !== "请填写视频脚本" &&
          (video || sourceIDs.length > 0)
            ? reason
            : null}
        </>
      }
    />
  );
  const prompt = promptControl || (
    <label className="workflow-field image-system-prompt-field">
      <span>系统提示词</span>
      <Input.TextArea
        aria-label={`${label}系统提示词`}
        value={systemPrompt}
        readOnly
        autoSize={{ minRows: video ? 3 : 6, maxRows: 12 }}
        className="title-system-prompt"
      />
    </label>
  );
  return (
    <section
      className={`workflow-panel media-rewrite-panel media-rewrite-${kind}`}
      aria-label={video ? "视频生成" : "图片仿写"}
    >
      {!video && sourceControl}
      {!video ? (
        <div className="image-composer">
          <div
            className="image-composer-columns"
            style={
              sourceControl
                ? { gridTemplateColumns: "minmax(0,1fr)" }
                : undefined
            }
          >
            {!sourceControl && (
              <ImageReferencePanel
                references={original}
                activeID={preview?.id}
                selected={sourceIDs}
                disabled={working}
                onPreview={setPreviewID}
                onToggle={toggleSource}
                onUpload={uploadReference}
              />
            )}
            <section
              className={
                sourceControl
                  ? "media-system-prompt"
                  : "image-configuration-panel image-composer-card"
              }
            >
              {!sourceControl && (
                <div
                  className="image-copy-context media-copy-context"
                  hidden={!!sourceControl}
                >
                  {imageContextControl ?? (
                    <>
                      <h3>{title}</h3>
                      <p>{note.body}</p>
                      {!!note.topics.length && (
                        <div className="title-original-topics">
                          {note.topics.map((topic) => (
                            <span key={topic}>#{topic}</span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {prompt}
            </section>
          </div>
          {composer}
        </div>
      ) : (
        <>
          {sourceControl ?? (
            <div className="title-original-note media-original-note">
              <div className="media-source-panel">
                {missingSource ? (
                  <OriginalCreationInput
                    mediaOnly
                    hideMaterialActions
                    mediaKind={kind}
                    value={{
                      title: "",
                      body: "",
                      topics: [],
                      asset_ids: sourceIDs,
                    }}
                    assets={assets}
                    disabled={working}
                    onUploaded={onUploaded}
                    onChange={(patch) =>
                      onEdit({ reference_asset_ids: patch.asset_ids })
                    }
                  />
                ) : (
                  <SourceMediaCarousel
                    assets={original}
                    activeID={preview?.id}
                    kind={kind}
                    selectedIDs={sourceIDs}
                    disabled={working}
                    onPreview={setPreviewID}
                    onToggle={toggleSource}
                  />
                )}
              </div>
              <div className="title-original-content media-copy-context">
                <h3>{title}</h3>
                <div
                  className="title-original-copy"
                  aria-label="当前文案与标签"
                >
                  <p>{note.body}</p>
                  {!!note.topics.length && (
                    <div className="title-original-topics">
                      {note.topics.map((topic) => (
                        <span key={topic}>#{topic}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {scriptControl}
          <h3>根据脚本生成视频</h3>
          {prompt}
          {composer}
        </>
      )}
      {own
        .slice(0, 1)
        .filter((job) =>
          [
            "queued",
            "running",
            "failed",
            "waiting_config",
            "needs_review",
          ].includes(job.state),
        )
        .map((job) => (
          <Alert
            key={job.id}
            type={
              job.state === "failed" || job.state === "needs_review"
                ? "error"
                : "info"
            }
            message={job.error || job.stage}
            action={
              video &&
              !running &&
              job.payload?.production?.shots.some((shot) => !!shot.remote_id) &&
              !unresolved ? (
                <Button
                  onClick={() =>
                    void run(async () => {
                      await post(`/jobs/${job.id}/retry`, {});
                    })
                  }
                >
                  继续处理
                </Button>
              ) : undefined
            }
          />
        ))}
      <WorkflowResultPanel
        title="生成结果"
        className="media-generated-section"
        action={video ? addControl : undefined}
      >
        {!video ? (
          <ImageResultTimeline
            entries={imageEntries}
            addControl={addControl}
            selected={picked}
            disabled={working}
            onSelection={onSelection}
            uploadSlots={uploadSlots}
            onUpload={upload}
            onRemove={removeResult}
          />
        ) : (
          <VideoResultCarousel
            entries={imageEntries}
            uploadSlots={uploadSlots}
            selected={picked}
            disabled={working}
            onUpload={upload}
            onSelection={onSelection}
            onRemove={removeResult}
          />
        )}
      </WorkflowResultPanel>
      <WorkflowActionBar>
        <Button
          type="primary"
          icon={<CheckOutlined />}
          disabled={working || !picked.length}
          onClick={onConfirm}
        >
          确认
        </Button>
        <Button
          icon={<SendOutlined />}
          disabled={working || !picked.length}
          onClick={onPublish}
        >
          准备发布
        </Button>
      </WorkflowActionBar>
    </section>
  );
}
