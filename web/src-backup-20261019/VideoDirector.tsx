import GenerateButton from "./components/GenerateButton";
import { VideoCameraOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Image,
  Input,
  InputNumber,
  Select,
  Space,
  Steps,
  Tag,
} from "antd";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import type { Asset, CreativeSettings, Job } from "./api";
import { api, date, fileURL, post, stateLabel } from "./api";
import { inMediaLibrary } from "./assetLibrary";
import { CreativeControls, creativeSignature } from "./creative";
import ReferenceMediaPicker from "./ReferenceMediaPicker";
import type { RewriteModel } from "./RewriteModels";
import SaveToLibrary from "./SaveToLibrary";
import WorkspaceSurface from "./WorkspaceSurface";

type Shot = {
  duration: number;
  visual: string;
  camera: string;
  narration: string;
};
type Brief = {
  creative?: CreativeSettings;
  mode?: "continuous";
  model_id: string;
  copy_text: string;
  requirements: string;
  duration: number;
  reference_asset_ids: string[];
};
type Script = {
  id: string;
  project_id: string;
  parent_id?: string;
  title: string;
  concept: string;
  style: string;
  shots: Shot[];
  brief: Brief;
  confirmed_at?: string;
  cancelled_at?: string;
  created_at: string;
  model: string;
};
type Production = {
  script_id: string;
  audio: boolean;
  shots: { remote_id?: string; state: string; asset_id?: string }[];
};
type DirectorJob = Job & {
  payload?: Job["payload"] & {
    production?: Production;
    generation_id?: string;
    asset_id?: string;
    cover_id?: string;
    script_id?: string;
  };
};
const active = (j: Job) => j.state === "queued" || j.state === "running";

export default function VideoDirector({
  creative = {},
  onCreativeChange = () => {},
  embedded = false,
  projectID,
  text,
  assets,
  models,
  videoModels,
  defaultPlanningModelID,
  videoModelID,
  onVideoModelChange: setVideoModelID,
  referenceIDs: refIDs,
  onReferenceChange: setRefIDs,
  jobs,
  refresh,
  onAdd,
  onRemove,
  selected = [],
  onSettings,
  disabled,
}: {
  creative?: CreativeSettings;
  onCreativeChange?: (value: CreativeSettings) => void;
  embedded?: boolean;
  projectID: string;
  text: string;
  assets: Asset[];
  models: RewriteModel[];
  videoModels: RewriteModel[];
  defaultPlanningModelID: string;
  videoModelID: string;
  onVideoModelChange: (id: string) => void;
  referenceIDs: string[];
  onReferenceChange: Dispatch<SetStateAction<string[]>>;
  jobs: Job[];
  refresh: () => Promise<void>;
  onAdd: (id: string, cover: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  selected?: string[];
  onSettings: () => void;
  disabled: boolean;
}) {
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(embedded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scripts, setScripts] = useState<Script[]>([]);
  const [draft, setDraft] = useState<Script>();
  const [chosenPlanningModelID, setModelID] = useState("");
  const modelID =
    chosenPlanningModelID ||
    models.find(
      (m) => m.id === defaultPlanningModelID && (!refIDs.length || m.vision),
    )?.id ||
    models.find((m) => m.configured && (!refIDs.length || m.vision))?.id ||
    defaultPlanningModelID;
  const [requirements, setRequirements] = useState("");
  const [duration, setDuration] = useState<number | null>(30);
  const [audio, setAudio] = useState(true);
  const [remoteIDs, setRemoteIDs] = useState<Record<string, string>>({});
  const waiting = useRef(
    localStorage.getItem("gin.video-waiting." + projectID) || "",
  );
  const actionRunning = useRef(false);
  const suppressDefault = useRef(
    localStorage.getItem("gin.video-cancelled." + projectID) === "true",
  );
  const draftKey = "gin.video-director." + projectID;
  const ours = (jobs as DirectorJob[]).filter(
    (j) => j.target === projectID && j.kind.startsWith("video_"),
  );
  const planning = ours.some((j) => j.kind === "video_plan" && active(j));
  const locked = busy || planning;
  const saved = scripts.find((s) => s.id === draft?.id);
  const dirty =
    !!draft && (!saved || JSON.stringify(draft) !== JSON.stringify(saved));
  const confirmed = !!saved?.confirmed_at && !saved.cancelled_at && !dirty;
  const stale =
    !!draft &&
    (draft.brief.copy_text !== text ||
      creativeSignature(draft.brief.creative, "video") !==
        creativeSignature(creative, "video"));
  const productions = ours.filter(
    (j) =>
      j.kind === "video_generate" &&
      j.payload?.production?.script_id === draft?.id,
  );
  const choices = [
    ...new Map(
      assets
        .filter(
          (a) =>
            (inMediaLibrary(a) || refIDs.includes(a.id)) &&
            a.status === "ready" &&
            !a.deleted_at &&
            ["image", "video"].includes(a.kind),
        )
        .map((a) => [a.id, a]),
    ).values(),
  ];
  const tick = ours.map((j) => j.id + j.updated_at + j.state).join();
  useEffect(() => {
    try {
      const cached = localStorage.getItem(draftKey);
      if (cached && !suppressDefault.current) {
        const value = JSON.parse(cached);
        if (
          value?.project_id === projectID &&
          Array.isArray(value.shots) &&
          value.brief
        )
          setDraft(value);
      }
    } catch {
      /* Ignore an invalid local draft. */
    }
  }, [draftKey]);
  useEffect(() => {
    if (draft) {
      try {
        localStorage.setItem(draftKey, JSON.stringify(draft));
      } catch {
        setError("浏览器草稿暂存失败，请及时点击确认完整脚本保存");
      }
    }
  }, [draft, draftKey]);
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    void api<Script[]>(`/rewrites/${projectID}/video/scripts`)
      .then((list) => {
        if (stopped) return;
        setScripts(list);
        const generated = list.find(
          (s) => s.id === waiting.current && !s.cancelled_at,
        );
        if (generated) {
          suppressDefault.current = false;
          localStorage.removeItem("gin.video-cancelled." + projectID);
          setDraft(generated);
          waiting.current = "";
          localStorage.removeItem("gin.video-waiting." + projectID);
          message.success("完整脚本已生成，请检查并确认后制作视频");
        } else
          setDraft((current) =>
            current && !list.find((s) => s.id === current.id)?.cancelled_at
              ? current
              : suppressDefault.current
                ? undefined
                : list.find((s) => !s.cancelled_at),
          );
      })
      .catch((e) => {
        if (!stopped) setError((e as Error).message);
      });
    return () => {
      stopped = true;
    };
  }, [open, tick, projectID]);
  const action = async (fn: () => Promise<void>) => {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      actionRunning.current = false;
    }
  };
  const edit = (part: Partial<Script>) =>
    setDraft(draft ? { ...draft, ...part } : draft);
  const shotEdit = (index: number, part: Partial<Shot>) => {
    if (draft)
      edit({
        shots: draft.shots.map((s, i) => (i === index ? { ...s, ...part } : s)),
      });
  };
  const planningModel = models.find((m) => m.id === modelID);
  const videoModel = videoModels.find((m) => m.id === videoModelID);
  const continuous = draft?.brief.mode === "continuous";
  const minDuration = videoModel?.continuous_min || 2;
  const maxDuration = videoModel?.continuous_max || 30;
  const durationValid =
    duration !== null &&
    Number.isInteger(duration) &&
    duration >= minDuration &&
    duration <= maxDuration;
  const generationDurationError =
    continuous && videoModel?.configured
      ? !videoModel.continuous_max
        ? "此模型的连续视频时长范围尚未确认，请选择万相 3.0 或已支持的 Seedance 模型。若刚更新工作台，请先重启。"
        : draft.brief.duration < minDuration ||
            draft.brief.duration > maxDuration
          ? `当前脚本 ${draft.brief.duration} 秒，所选模型支持 ${minDuration}～${maxDuration} 秒。请更换模型或调整时长后重新规划。`
          : ""
      : "";
  const canRemake = (j: DirectorJob) =>
    !active(j) &&
    !!j.payload?.production?.shots.every((s) =>
      s.state === "succeeded"
        ? !!s.asset_id
        : ["pending", "rejected", "failed", "cancelled", "expired"].includes(
            s.state,
          ),
    );
  const generate = async (previous?: DirectorJob, shot?: number) => {
    const input = {
      script_id: draft!.id,
      model_id: videoModelID,
      audio: shot === undefined ? audio : previous!.payload!.production!.audio,
      ...(previous ? { previous_job_id: previous.id } : {}),
      ...(shot === undefined ? {} : { redo_shot: shot }),
    };
    const key = `gin.video-attempt.${projectID}`;
    const signature = JSON.stringify(input);
    // Keep the same token after a lost response, including after page reload.
    let cached: { signature: string; token: string } | undefined;
    try {
      cached = JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      /* invalid cache */
    }
    const token =
      cached?.signature === signature && cached.token
        ? cached.token
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
    localStorage.setItem(key, JSON.stringify({ signature, token }));
    await post(`/rewrites/${projectID}/video/generate`, {
      ...input,
      request_id: token,
    });
    localStorage.removeItem(key);
    await refresh();
  };
  const leaveDraft = (next: () => void) => {
    if (!dirty) return next();
    modal.confirm({
      title: "当前脚本有未保存修改",
      content: "继续会放弃当前修改。要保留内容，请返回并点击确认完整脚本。",
      okText: "放弃修改并继续",
      cancelText: "返回保存",
      onOk: next,
    });
  };
  return (
    <>
      <Button
        hidden={embedded}
        icon={<VideoCameraOutlined />}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        AI 视频导演
      </Button>
      <WorkspaceSurface
        embedded={embedded}
        title="AI 视频导演 · 从脚本生成视频"
        width={960}
        open={open}
        onClose={() => setOpen(false)}
      >
        <Space direction="vertical" size={20} style={{ width: "100%" }}>
          <Steps
            size="small"
            current={
              productions.some((j) => j.state === "succeeded")
                ? 3
                : confirmed
                  ? 2
                  : draft
                    ? 1
                    : 0
            }
            items={[
              { title: "文案与参考" },
              { title: "完整脚本" },
              { title: "生成视频" },
              { title: "生成结果" },
            ]}
          />
          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              closable
              onClose={() => setError("")}
            />
          )}
          <Card title="1. 文案与参考素材" size="small">
            <Space direction="vertical" style={{ width: "100%" }}>
              <p className="muted">
                使用编辑器当前文案（包括未保存修改）。参考视频读取 4
                张采样画面和已有转写；未转写的声音不会参与规划。生成视频时使用确认后的完整文字脚本，不直接上传参考视频。
              </p>
              <Input.TextArea
                aria-label="视频导演当前文案"
                value={text}
                readOnly
                rows={3}
              />
              <CreativeControls
                medium="video"
                value={creative}
                onChange={onCreativeChange}
                disabled={locked}
              />
              <ReferenceMediaPicker
                assets={assets}
                selected={refIDs}
                disabled={locked}
                onChange={setRefIDs}
              />
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {refIDs.map((id) => {
                  const a = choices.find((a) => a.id === id);
                  return (
                    <div key={id} style={{ width: 140 }}>
                      {a?.kind === "video" ? (
                        <video
                          src={fileURL(id)}
                          controls
                          style={{ width: 140, height: 100 }}
                        />
                      ) : (
                        <Image
                          src={fileURL(id)}
                          width={140}
                          height={100}
                          style={{ objectFit: "contain" }}
                        />
                      )}
                      <Button
                        type="link"
                        size="small"
                        disabled={locked}
                        onClick={() =>
                          setRefIDs((ids) => ids.filter((v) => v !== id))
                        }
                      >
                        移除参考
                      </Button>
                    </div>
                  );
                })}
              </div>
              <Input.TextArea
                aria-label="视频导演补充要求"
                placeholder="补充主题、受众、画面风格、角色设定、想模仿的叙事方式……"
                value={requirements}
                maxLength={4000}
                rows={3}
                disabled={locked}
                onChange={(e) => setRequirements(e.target.value)}
              />
              <Space wrap>
                <Select
                  aria-label="视频脚本模型"
                  style={{ width: 300 }}
                  value={modelID || undefined}
                  disabled={locked}
                  onChange={setModelID}
                  options={models.map((m) => ({
                    value: m.id,
                    label: `${m.name} · ${m.model}${!m.configured ? " · 待配置" : ""}`,
                  }))}
                />
                <InputNumber
                  aria-label="视频总时长"
                  value={duration}
                  disabled={locked}
                  onChange={setDuration}
                  min={minDuration}
                  max={maxDuration}
                  step={1}
                  addonAfter="秒"
                  placeholder="输入总时长"
                  status={durationValid ? undefined : "error"}
                />
                <GenerateButton
                  type="primary"
                  loading={planning}
                  disabled={
                    locked ||
                    !durationValid ||
                    !planningModel?.configured ||
                    (!!refIDs.length && !planningModel.vision)
                  }
                  onClick={() =>
                    leaveDraft(
                      () =>
                        void action(async () => {
                          const r = await post(
                            `/rewrites/${projectID}/video/plan`,
                            {
                              model_id: modelID,
                              creative,
                              mode: "continuous",
                              copy_text: text,
                              requirements,
                              duration,
                              reference_asset_ids: refIDs,
                            },
                          );
                          waiting.current = r.job_id;
                          localStorage.setItem(
                            "gin.video-waiting." + projectID,
                            r.job_id,
                          );
                          await refresh();
                          message.info(
                            "脚本生成已开始，完成后不会自动调用视频模型",
                          );
                        }),
                    )
                  }
                >
                  生成完整脚本
                </GenerateButton>
              </Space>
              <small className="muted">
                脚本格式不符合要求时，会额外调用一次文案模型尝试修正；仍不完整则显示具体原因。
              </small>
              <Space wrap>
                <span>目标视频模型</span>
                <Select
                  aria-label="目标视频模型"
                  style={{ width: 340 }}
                  value={videoModelID || undefined}
                  disabled={locked}
                  placeholder="选择视频模型以查看时长范围"
                  onChange={setVideoModelID}
                  options={videoModels.map((m) => ({
                    value: m.id,
                    label: `${m.name} · ${m.model}`,
                  }))}
                />
              </Space>
              <Alert
                type={durationValid ? "info" : "warning"}
                message="一条完整连续视频"
                description={`${videoModel?.continuous_max ? `所选模型支持 ${minDuration}～${maxDuration} 秒，可直接输入整数秒数。` : "可先输入 2～30 秒规划脚本，生成前需配置支持该时长的视频模型。"}脚本按时间顺序推进故事，确认后一次生成整条视频，不自动拆段。修改时长后需重新生成完整脚本。`}
              />
              {!planningModel?.configured ? (
                <Alert
                  type="info"
                  message="脚本模型待配置：请在仿写库的文案模型配置中添加。"
                />
              ) : (
                !!refIDs.length &&
                !planningModel.vision && (
                  <Alert
                    type="warning"
                    message="当前模型不能理解图片，请选择支持图片理解的文案模型。"
                  />
                )
              )}
              {ours
                .filter((j) => j.kind === "video_plan")
                .slice(0, 1)
                .map((j) => (
                  <Alert
                    key={j.id}
                    type={j.error ? "error" : "info"}
                    message={`最近脚本任务：${stateLabel[j.state] || j.state}`}
                    description={j.error || j.stage}
                  />
                ))}
            </Space>
          </Card>
          <Card title="2. 完整脚本 · 编辑后确认" size="small">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Select
                aria-label="视频脚本版本"
                style={{ width: "100%" }}
                value={draft?.id}
                placeholder="生成脚本后在此选择，也可查看历史版本"
                disabled={locked}
                onChange={(id) =>
                  leaveDraft(() => {
                    suppressDefault.current = false;
                    localStorage.removeItem("gin.video-cancelled." + projectID);
                    setDraft(scripts.find((s) => s.id === id));
                  })
                }
                options={scripts.map((s, i) => ({
                  value: s.id,
                  disabled: !!s.cancelled_at,
                  label: `${s.cancelled_at ? "已取消 · " : ""}脚本 ${scripts.length - i} · ${s.title} · ${date(s.created_at)}${s.confirmed_at ? " · 已确认" : " · 待确认"}`,
                }))}
              />
              {draft && (
                <>
                  {!continuous && (
                    <Alert
                      type="info"
                      message="这是历史分镜脚本。要制作完整连续视频，请在上方输入总时长并重新生成完整脚本；旧结果仍会保留。"
                    />
                  )}
                  {dirty && (
                    <Alert
                      type="warning"
                      message="脚本有未保存修改；点击「确认完整脚本」会保存修改并确认，旧镜头与成片保留。"
                    />
                  )}
                  {stale && (
                    <Alert
                      type="warning"
                      message="文案或视频角度、钩子已修改，可重新规划；继续制作将使用下方已保存的脚本。"
                    />
                  )}
                  <details>
                    <summary>查看本脚本的原始文案与要求</summary>
                    <pre style={{ whiteSpace: "pre-wrap" }}>
                      {draft.brief.copy_text + "\n" + draft.brief.requirements}
                    </pre>
                  </details>
                  <label>
                    作品标题
                    <Input
                      value={draft.title}
                      disabled={locked}
                      maxLength={200}
                      onChange={(e) => edit({ title: e.target.value })}
                    />
                  </label>
                  <label>
                    完整故事 / 叙事结构
                    <Input.TextArea
                      value={draft.concept}
                      disabled={locked}
                      rows={3}
                      onChange={(e) => edit({ concept: e.target.value })}
                    />
                  </label>
                  <label>
                    统一风格 / 主体外观 / 连续性
                    <Input.TextArea
                      value={draft.style}
                      disabled={locked}
                      rows={2}
                      onChange={(e) => edit({ style: e.target.value })}
                    />
                  </label>
                  {draft.shots.map((shot, index) => (
                    <Card
                      key={index}
                      size="small"
                      title={`${continuous ? "完整视频时间线" : `镜头 ${index + 1}`} · ${shot.duration} 秒`}
                      extra={
                        !continuous && (
                          <Space>
                            <Button
                              size="small"
                              disabled={locked || index === 0}
                              onClick={() => {
                                const shots = [...draft.shots];
                                [shots[index - 1], shots[index]] = [
                                  shots[index],
                                  shots[index - 1],
                                ];
                                edit({ shots });
                              }}
                            >
                              前移
                            </Button>
                            <Button
                              size="small"
                              disabled={
                                locked || index === draft.shots.length - 1
                              }
                              onClick={() => {
                                const shots = [...draft.shots];
                                [shots[index + 1], shots[index]] = [
                                  shots[index],
                                  shots[index + 1],
                                ];
                                edit({ shots });
                              }}
                            >
                              后移
                            </Button>
                          </Space>
                        )
                      }
                    >
                      <Space direction="vertical" style={{ width: "100%" }}>
                        <label>
                          {continuous
                            ? "按时间顺序的画面内容与动作（含起止秒数）"
                            : "画面内容与动作"}
                          <Input.TextArea
                            value={shot.visual}
                            disabled={locked}
                            rows={continuous ? 7 : 3}
                            onChange={(e) =>
                              shotEdit(index, { visual: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          景别、运镜与镜头衔接
                          <Input.TextArea
                            value={shot.camera}
                            disabled={locked}
                            rows={2}
                            onChange={(e) =>
                              shotEdit(index, { camera: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          台词 / 口播（可留空，最多 {shot.duration * 4} 字）
                          <Input.TextArea
                            value={shot.narration}
                            disabled={locked}
                            showCount
                            maxLength={shot.duration * 4}
                            onChange={(e) =>
                              shotEdit(index, { narration: e.target.value })
                            }
                          />
                        </label>
                      </Space>
                    </Card>
                  ))}
                  <Space wrap>
                    <Button
                      danger
                      disabled={locked}
                      onClick={() =>
                        modal.confirm({
                          title: "取消该脚本？",
                          content:
                            "当前脚本将退出制作流程，已有视频生成结果保留。已提交的视频任务仍可能继续执行并计费。",
                          okText: "取消该脚本",
                          cancelText: "保留脚本",
                          onOk: async () => {
                            await action(async () => {
                              const result = await post<Script>(
                                `/rewrites/${projectID}/video/scripts/${draft.id}/cancel`,
                              );
                              suppressDefault.current = true;
                              localStorage.setItem(
                                "gin.video-cancelled." + projectID,
                                "true",
                              );
                              localStorage.removeItem(draftKey);
                              waiting.current = "";
                              localStorage.removeItem(
                                "gin.video-waiting." + projectID,
                              );
                              setScripts((old) =>
                                old.map((s) =>
                                  s.id === result.id ? result : s,
                                ),
                              );
                              setDraft(undefined);
                              message.success(
                                "脚本已取消，可重新规划；已有视频生成结果保留",
                              );
                            });
                          },
                        })
                      }
                    >
                      取消该脚本
                    </Button>
                    <Button
                      type="primary"
                      disabled={locked || confirmed || !!saved?.cancelled_at}
                      onClick={() =>
                        void action(async () => {
                          let candidate = draft;
                          if (dirty) {
                            candidate = await post<Script>(
                              `/rewrites/${projectID}/video/scripts`,
                              { ...draft, parent_id: draft.id },
                            );
                            setScripts((old) => [
                              candidate,
                              ...old.filter((s) => s.id !== candidate.id),
                            ]);
                            setDraft(candidate);
                          }
                          const result = await post<Script>(
                            `/rewrites/${projectID}/video/scripts/${candidate.id}/confirm`,
                          );
                          setDraft(result);
                          setScripts((old) => [
                            result,
                            ...old.filter((s) => s.id !== result.id),
                          ]);
                          message.success("完整脚本已保存并确认");
                        })
                      }
                    >
                      确认完整脚本
                    </Button>
                    {confirmed && <Tag color="green">脚本已确认</Tag>}
                  </Space>
                </>
              )}
            </Space>
          </Card>
          <Card title="3. 根据确认脚本生成视频" size="small">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Space wrap>
                <Select
                  aria-label="视频生成模型"
                  style={{ width: 380 }}
                  placeholder="选择视频模型"
                  value={videoModelID || undefined}
                  onChange={setVideoModelID}
                  disabled={busy}
                  options={videoModels.map((m) => ({
                    value: m.id,
                    label: `${m.name} · ${m.model}${!m.configured ? " · 待配置" : ""}`,
                  }))}
                />
                <Button onClick={onSettings}>视频模型配置</Button>
              </Space>
              <Checkbox
                checked={audio}
                onChange={(e) => setAudio(e.target.checked)}
                disabled={busy}
              >
                请求模型按脚本生成声音和台词
              </Checkbox>
              <p className="muted">
                竖屏
                9:16、720p。声音由视频模型生成，台词与音色可能有偏差，请预览检查；当前不添加独立配音或字幕。点击下方按钮会调用所选视频服务，按服务商规则计费。
              </p>
              {!videoModel?.configured && (
                <Alert
                  type="info"
                  message="视频模型待配置。仍可生成、编辑和保存脚本；文案模型密钥不会自动用于视频服务。"
                />
              )}
              <GenerateButton
                type="primary"
                loading={
                  busy ||
                  ours.some((j) => j.kind === "video_generate" && active(j))
                }
                disabled={
                  busy ||
                  !!generationDurationError ||
                  !confirmed ||
                  !videoModel?.configured ||
                  (productions.length > 0 && !productions.every(canRemake)) ||
                  ours.some((j) => j.kind === "video_generate" && active(j))
                }
                onClick={() =>
                  productions.length
                    ? modal.confirm({
                        title: continuous
                          ? "重新生成完整视频？"
                          : "新建整组制作版本？",
                        content: continuous
                          ? "使用当前模型重新生成整条视频，会产生新的费用；旧结果保留。"
                          : "使用当前所选模型和声音选项重新生成全部镜头，会产生新的费用；旧结果保留。",
                        okText: "确认重新制作",
                        cancelText: "取消",
                        onOk: () => action(() => generate(productions[0])),
                      })
                    : void action(() => generate())
                }
              >
                {productions.length
                  ? continuous
                    ? "使用当前模型重新生成完整视频"
                    : "使用当前模型新建整组制作"
                  : !draft || continuous
                    ? "根据确认脚本生成完整视频"
                    : "根据确认脚本生成全部镜头"}
              </GenerateButton>
              {generationDurationError && (
                <Alert type="warning" message={generationDurationError} />
              )}
              {productions.map((j) => (
                <Card
                  key={j.id}
                  size="small"
                  title={
                    <Space>
                      <Tag>{stateLabel[j.state] || j.state}</Tag>
                      <span>
                        {j.payload?.model_name} · {date(j.created_at)}
                      </span>
                    </Space>
                  }
                >
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <span>{j.stage}</span>
                    {j.error && <Alert type="error" message={j.error} />}
                    {j.payload?.production?.shots.map((shot, i) => (
                      <div key={i}>
                        <Space>
                          <strong>
                            {continuous
                              ? `完整视频 · ${draft.brief.duration} 秒`
                              : `镜头 ${i + 1}`}
                          </strong>
                          <Tag>
                            {(shot.state === "succeeded" && !shot.asset_id
                              ? "已生成 · 待缓存预览"
                              : stateLabel[shot.state]) ||
                              (
                                {
                                  pending: "待生成",
                                  submitting: "提交中 / 待核实",
                                  rejected: "提交被拒绝",
                                  expired: "远程任务过期",
                                } as Record<string, string>
                              )[shot.state] ||
                              shot.state}
                          </Tag>
                        </Space>
                        {shot.asset_id && (
                          <video
                            controls
                            src={fileURL(shot.asset_id)}
                            style={{
                              display: "block",
                              maxWidth: "100%",
                              width: 280,
                              maxHeight: 360,
                              marginTop: 8,
                            }}
                          />
                        )}
                        {shot.remote_id && (
                          <p className="muted">远程任务：{shot.remote_id}</p>
                        )}
                        {shot.asset_id && (
                          <p className="muted">
                            生成结果 ·{" "}
                            {assets.find((a) => a.id === shot.asset_id)?.name ||
                              "AI 视频"}
                          </p>
                        )}
                        {shot.asset_id && (
                          <SaveToLibrary
                            asset={assets.find((a) => a.id === shot.asset_id)}
                            refresh={refresh}
                            disabled={busy || disabled}
                          />
                        )}
                        {shot.asset_id && (
                          <Button
                            disabled={busy || disabled}
                            onClick={() =>
                              void action(async () => {
                                if (selected.includes(shot.asset_id!))
                                  await onRemove(shot.asset_id!);
                                else await onAdd(shot.asset_id!, "");
                                message.success(
                                  selected.includes(shot.asset_id!)
                                    ? "已取消加入发布素材"
                                    : "已加入发布素材，文件不会重复保存",
                                );
                              })
                            }
                          >
                            {selected.includes(shot.asset_id)
                              ? "取消加入发布素材"
                              : "加入发布素材"}
                          </Button>
                        )}
                        {!continuous && canRemake(j) && (
                          <Button
                            disabled={
                              busy || !confirmed || !videoModel?.configured
                            }
                            onClick={() =>
                              modal.confirm({
                                title: `重做镜头 ${i + 1} 并继续？`,
                                content:
                                  "使用当前所选模型新建制作版本，复用其他已完成镜头，并继续生成尚未开始的镜头。新生成部分会计费，声音选项沿用原制作版本。",
                                okText: "确认重做",
                                cancelText: "取消",
                                onOk: () => action(() => generate(j, i)),
                              })
                            }
                          >
                            重做此镜并继续
                          </Button>
                        )}
                        {shot.state === "submitting" &&
                          !shot.remote_id &&
                          !active(j) && (
                            <Space.Compact style={{ width: "100%" }}>
                              <Input
                                placeholder="在视频服务商核实后填写该镜头的远程任务 ID"
                                value={remoteIDs[j.id + i] || ""}
                                onChange={(e) =>
                                  setRemoteIDs({
                                    ...remoteIDs,
                                    [j.id + i]: e.target.value,
                                  })
                                }
                              />
                              <Button
                                disabled={busy}
                                onClick={() =>
                                  void action(async () => {
                                    await post(
                                      `/rewrites/${projectID}/video/productions/${j.id}/link`,
                                      {
                                        shot: i,
                                        remote_id: remoteIDs[j.id + i],
                                      },
                                    );
                                    await refresh();
                                  })
                                }
                              >
                                关联并查询
                              </Button>
                            </Space.Compact>
                          )}
                      </div>
                    ))}
                    {!active(j) &&
                      j.state !== "succeeded" &&
                      !j.payload?.production?.shots.some(
                        (s) => s.state === "submitting" && !s.remote_id,
                      ) && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await post(`/jobs/${j.id}/retry`);
                              await refresh();
                            })
                          }
                        >
                          重试下载入库 / 继续查询已提交任务
                        </Button>
                      )}
                    {ours
                      .filter(
                        (r) =>
                          r.kind === "video_compose" &&
                          r.payload?.generation_id === j.id,
                      )
                      .map((r) => (
                        <div key={r.id}>
                          <Tag>{stateLabel[r.state]}</Tag>
                          {r.error && <Alert type="error" message={r.error} />}
                          {r.state === "succeeded" && r.result && (
                            <>
                              <video
                                src={fileURL(r.result)}
                                controls
                                style={{
                                  display: "block",
                                  width: 320,
                                  maxWidth: "100%",
                                  maxHeight: 500,
                                  margin: "12px 0",
                                }}
                              />
                              <p className="muted">
                                保存到素材库和加入发布素材可分别选择，取消选入不会删除已有成片。
                              </p>
                              <Space wrap>
                                <Button
                                  type="primary"
                                  disabled={busy || disabled || dirty}
                                  onClick={() =>
                                    void action(async () => {
                                      if (selected.includes(r.result!))
                                        await onRemove(r.result!);
                                      else await onAdd(r.result!, "");
                                      message.success(
                                        selected.includes(r.result!)
                                          ? "已取消加入发布素材"
                                          : "成片已加入发布素材，请选择封面并保存完整版本",
                                      );
                                    })
                                  }
                                >
                                  {selected.includes(r.result!)
                                    ? "取消加入发布素材"
                                    : "加入发布素材"}
                                </Button>
                                <SaveToLibrary
                                  asset={assets.find((a) => a.id === r.result)}
                                  refresh={refresh}
                                  disabled={busy || disabled}
                                />
                                <Button href={fileURL(r.result)} download>
                                  下载成片
                                </Button>
                                {r.payload?.cover_id && (
                                  <Button
                                    href={fileURL(r.payload.cover_id)}
                                    download
                                  >
                                    下载封面
                                  </Button>
                                )}
                              </Space>
                              {r.payload?.cover_id && (
                                <Space>
                                  <span>生成封面</span>
                                  <SaveToLibrary
                                    asset={assets.find(
                                      (a) => a.id === r.payload?.cover_id,
                                    )}
                                    refresh={refresh}
                                    disabled={busy || disabled}
                                  />
                                </Space>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                  </Space>
                </Card>
              ))}
            </Space>
          </Card>
        </Space>
      </WorkspaceSurface>
    </>
  );
}
