import GenerateButton from "./components/GenerateButton";
import { RobotOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Empty,
  Image,
  Input,
  Select,
  Space,
} from "antd";
import { useRef, useState } from "react";
import type { Asset, CreativeSettings, Job } from "./api";
import { fileURL, post } from "./api";
import { CreativeControls } from "./creative";
import ImageGenerationResults from "./ImageGenerationResults";
import ImagePlanning from "./ImagePlanning";
import ReferenceMediaPicker from "./ReferenceMediaPicker";
import type { RewriteModel } from "./RewriteModels";
import WorkspaceSurface from "./WorkspaceSurface";

export default function ImageGeneration({
  creative = {},
  onCreativeChange = () => {},
  embedded = false,
  projectID,
  planningModels,
  defaultPlanningModelID,
  models,
  modelID,
  onModelChange,
  error,
  onReload,
  jobs,
  assets,
  selected,
  disabled,
  canAdd,
  onAdd,
  onRemove,
  onAddMany,
  refresh,
  text,
  references,
  onReferenceChange,
  onRemoveReference,
}: {
  creative?: CreativeSettings;
  onCreativeChange?: (value: CreativeSettings) => void;
  embedded?: boolean;
  projectID: string;
  planningModels: RewriteModel[];
  defaultPlanningModelID: string;
  models: RewriteModel[];
  modelID: string;
  onModelChange: (id: string) => void;
  error: string;
  onReload: () => Promise<void>;
  jobs: Job[];
  assets: Asset[];
  selected: string[];
  disabled: boolean;
  canAdd: boolean;
  onAdd: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onAddMany: (ids: string[]) => Promise<void>;
  refresh: () => Promise<void>;
  text: string;
  references: Asset[];
  onReferenceChange: (ids: string[]) => void;
  onRemoveReference: (id: string) => void;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(embedded);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [useCopy, setUseCopy] = useState(true);
  const [count, setCount] = useState(1);
  const [scenes, setScenes] = useState<string[]>([]);
  const [planning, setPlanning] = useState(false);
  const sending = useRef(false);
  const own = jobs
    .filter((j) => j.kind === "image_generation" && j.target === projectID)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const active = own.some((j) => ["queued", "running"].includes(j.state));
  const model = models.find((m) => m.id === modelID);
  const referenceLimit = model?.reference_limit || 0;
  const inputLimit =
    count > 1 && referenceLimit > 0 ? referenceLimit - 1 : referenceLimit;
  const invalidReferences = references.length > inputLimit;
  const generate = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await post(`/rewrites/${projectID}/generate-image`, {
        model_id: modelID,
        creative,
        prompt,
        size: size.trim(),
        reference_asset_ids: references.map((a) => a.id),
        copy_text: useCopy ? text : "",
        count,
        scenes: Array.from({ length: count }, (_, i) => scenes[i] || ""),
      });
      message.success("已提交生图任务，完成后可预览并加入图文素材");
      await refresh();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        hidden={embedded}
        icon={<RobotOutlined />}
        onClick={() => setOpen(true)}
      >
        {active ? "图片生成中" : "AI 生成图片"}
      </Button>
      <WorkspaceSurface
        embedded={embedded}
        title="AI 生成图片"
        open={open}
        onClose={() => setOpen(false)}
        width={620}
      >
        <div className="settings-form">
          <Space wrap>
            <Select
              aria-label="图片生成模型"
              style={{ width: 360 }}
              placeholder="选择图片模型"
              value={modelID || undefined}
              options={models.map((m) => ({
                value: m.id,
                label: `${m.name} · ${m.model}${m.configured ? "" : " · 待配置"}`,
              }))}
              onChange={onModelChange}
            />
          </Space>
          {error && (
            <Alert
              type="error"
              message={error}
              action={<Button onClick={onReload}>重试</Button>}
            />
          )}
          {!model?.configured && (
            <Alert
              type="info"
              message="图片模型待配置"
              description="请在仿写库列表的「图片模型配置」中添加图片模型、API 地址和密钥，再在创作编辑处选择。"
            />
          )}
          <label>
            生成张数
            <Select
              aria-label="生成张数"
              value={count}
              style={{ width: "100%" }}
              options={Array.from({ length: 6 }, (_, i) => ({
                value: i + 1,
                label: i === 0 ? "1 张 · 单张图片" : `${i + 1} 张 · 连续画面`,
              }))}
              onChange={setCount}
            />
          </label>
          {count > 1 && (
            <Alert
              type="info"
              message={`按顺序生成 ${count} 张连续画面`}
              description={
                referenceLimit > 0
                  ? "整组共享文案与画面要求。后续画面参考首张成图，参考位充足时也参考上一张，以辅助保持人物、服装和风格一致。"
                  : "当前模型不支持图片参考，连续性仅由共同描述和逐张情节提示引导；可切换支持参考图的模型增强一致性。"
              }
            />
          )}
          <strong>本次参考图片（{references.length} 张）</strong>
          <ReferenceMediaPicker
            imagesOnly
            assets={[
              ...references.filter((r) => !assets.some((a) => a.id === r.id)),
              ...assets,
            ]}
            selected={references.map((a) => a.id)}
            maxCount={Math.min(10, referenceLimit > 0 ? inputLimit : 10)}
            disabled={disabled || busy || active || planning}
            onChange={onReferenceChange}
          />
          <small className="muted">
            {referenceLimit
              ? `本次最多选择 ${inputLimit} 张参考图${count > 1 ? "，另预留首张成图的参考位" : ""}。可从素材库或「参考内容」选择，按选择顺序编号。`
              : "所选参考图可供画面规划使用；生成图片时需选择支持参考图的图片模型。"}
          </small>
          <small className="muted">
            支持使用已上传、已采集和 AI
            生成的图片。选择参考不会复制文件，也不会自动加入发布素材。
          </small>
          <Space wrap align="start">
            {references.map((a, i) => (
              <div key={a.id} style={{ width: 110 }}>
                <Image
                  src={fileURL(a.id)}
                  alt={a.name}
                  width={100}
                  height={85}
                  style={{ objectFit: "cover" }}
                />
                <div>
                  参考图 {i + 1} · {a.name}{" "}
                  <Button
                    type="link"
                    size="small"
                    onClick={() => onRemoveReference(a.id)}
                  >
                    移除
                  </Button>
                </div>
              </div>
            ))}
          </Space>
          {invalidReferences && (
            <Alert
              type="warning"
              message={
                referenceLimit
                  ? `本次最多选择 ${inputLimit} 张参考图，请移除多余图片。`
                  : "所选模型未启用参考图，请切换模型或移除参考图片。"
              }
            />
          )}
          <Checkbox
            checked={useCopy}
            onChange={(e) => setUseCopy(e.target.checked)}
          >
            参考当前文案（包括尚未保存的编辑）
          </Checkbox>
          {useCopy && (
            <Input.TextArea
              aria-label="本次参考文案"
              readOnly
              rows={4}
              value={text}
              placeholder="创作编辑中填写标题、正文和话题后，会显示在这里。"
            />
          )}
          <label>
            补充画面要求（可选）
            <Input.TextArea
              aria-label="画面描述"
              rows={5}
              maxLength={4000}
              showCount
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述主体、场景、风格、颜色和构图，例如：明亮书桌上的笔记本和一杯咖啡，暖色自然光，留出标题空间。"
            />
          </label>
          <CreativeControls
            medium="image"
            value={creative}
            onChange={onCreativeChange}
            disabled={busy || planning}
          />
          <ImagePlanning
            creative={creative}
            projectID={projectID}
            models={planningModels}
            defaultModelID={defaultPlanningModelID}
            count={count}
            copyText={useCopy ? text : ""}
            prompt={prompt}
            referenceIDs={references.map((a) => a.id)}
            scenes={scenes}
            jobs={jobs}
            refresh={refresh}
            onBusyChange={setPlanning}
            onApply={(planned) => {
              setCount(planned.length);
              setScenes([...planned]);
            }}
          />
          <div className="settings-form">
            <strong>2. 修改逐张画面内容</strong>
            <small className="muted">
              AI
              规划后会填入下方，也可手动填写。每张均可修改；所有画面填写完成后再生成图片。
            </small>
            {Array.from({ length: count }, (_, i) => (
              <label key={i}>
                第 {i + 1} 张
                <Input.TextArea
                  aria-label={`第 ${i + 1} 张画面内容`}
                  rows={2}
                  maxLength={1000}
                  showCount
                  value={scenes[i] || ""}
                  placeholder={
                    i === 0
                      ? "开篇：主体、环境和初始状态"
                      : i === count - 1
                        ? "收尾：动作或事件的结果"
                        : "发展：承接上一张，推进动作或事件"
                  }
                  onChange={(e) =>
                    setScenes((old) => {
                      const next = [...old];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label>
            图片尺寸（可选）
            <Input
              aria-label="图片尺寸"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="留空使用模型默认；如 1024x1024，需模型支持"
            />
          </label>
          <small className="muted">
            {count === 1
              ? "生成一张图片"
              : `逐张调用模型，生成 ${count} 张独立图片`}
            ，结果保存到本地；按服务商规则计费。连续画面失败时保留已完成图片，核实后手动重试未完成部分。
          </small>
          <GenerateButton
            className="image-generation-action"
            type="primary"
            loading={busy || active}
            disabled={
              !model?.configured ||
              Array.from({ length: count }, (_, i) => scenes[i] || "").some(
                (s) => !s.trim(),
              ) ||
              planning ||
              invalidReferences ||
              active
            }
            onClick={generate}
          >
            {count === 1 ? "3. 生成一张图片" : `3. 生成 ${count} 张连续画面`}
          </GenerateButton>
          <strong>本次生成结果</strong>
          <small className="muted">
            生成结果不会自动加入素材库或发布素材，可分别选择保存和加入，加入后也可取消；旧结果保留在历史生成中。
          </small>
          {!own.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="生成后可在这里预览、选择图片"
            />
          )}
          <ImageGenerationResults
            jobs={own.slice(0, 1)}
            assets={assets}
            selected={selected}
            disabled={disabled}
            canAdd={canAdd}
            onAdd={onAdd}
            onRemove={onRemove}
            refresh={refresh}
            onAddMany={onAddMany}
          />
          {own.length > 1 && (
            <details>
              <summary>历史生成（{own.length - 1} 次）</summary>
              <ImageGenerationResults
                jobs={own.slice(1)}
                assets={assets}
                selected={selected}
                disabled={disabled}
                canAdd={canAdd}
                onAdd={onAdd}
                onRemove={onRemove}
                refresh={refresh}
                onAddMany={onAddMany}
              />
            </details>
          )}
        </div>
      </WorkspaceSurface>
    </>
  );
}
