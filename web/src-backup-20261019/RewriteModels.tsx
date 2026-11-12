import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Input,
  Select,
  Space,
  Tag,
} from "antd";
import { useEffect, useState } from "react";
import type { Service } from "./api";
import { api, post } from "./api";
export type RewriteModel = Service & {
  id: string;
  name: string;
  vision?: boolean;
  vision_capability?: "text" | "image" | "video";
  reference_mode?: string;
  reference_limit?: number;
  continuous_min?: number;
  continuous_max?: number;
};
const fresh = (image = false, video = false): RewriteModel => ({
  id: "",
  name: "",
  base_url: video
    ? "https://ark.cn-beijing.volces.com/api/v3"
    : image
      ? ""
      : "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: video ? "doubao-seedance-2-5-260628" : image ? "" : "qwen-plus",
  configured: false,
  secret: "",
});
export default function RewriteModels({
  open,
  onClose,
  models,
  onSaved,
  capability = "text",
}: {
  open: boolean;
  onClose: () => void;
  models: RewriteModel[];
  onSaved: (id: string) => Promise<void>;
  capability?: "text" | "image" | "video";
}) {
  const image = capability === "image";
  const video = capability === "video";
  const endpoint = video
    ? "/video-models"
    : image
      ? "/image-models"
      : "/rewrite-models";
  const { message } = App.useApp();
  const [draft, setDraft] = useState<RewriteModel>(() => fresh(image, video));
  const [busy, setBusy] = useState(false);
  const [clear, setClear] = useState(false);
  useEffect(() => {
    if (open) {
      setDraft(models[0] ? { ...models[0], secret: "" } : fresh(image, video));
      setClear(false);
    }
  }, [open]);
  const save = async (test = false) => {
    setBusy(true);
    try {
      if (!draft.name.trim() || !draft.model.trim() || !draft.base_url.trim())
        throw Error("请填写配置名称、API 地址和模型 ID");
      const saved = await api<RewriteModel>(
        endpoint + (draft.id ? "/" + draft.id : ""),
        {
          method: draft.id ? "PUT" : "POST",
          body: JSON.stringify({ ...draft, clear_secret: clear }),
        },
      );
      setDraft({ ...saved, secret: "" });
      setClear(false);
      await onSaved(saved.id);
      message.success("模型配置已保存");
      if (test) {
        const r = await post(endpoint + "/" + saved.id + "/test");
        message.info(r.message, 8);
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      title={video ? "视频模型配置" : image ? "图片模型配置" : "文案模型配置"}
      open={open}
      onClose={onClose}
      width={540}
      destroyOnClose
    >
      <div className="settings-form">
        <Space wrap>
          <Select
            aria-label="编辑模型配置"
            style={{ width: 300 }}
            value={draft.id || undefined}
            placeholder="新增模型配置"
            options={models.map((m) => ({
              value: m.id,
              label: m.name + " · " + m.model,
            }))}
            disabled={busy}
            onChange={(id) => {
              setDraft({ ...models.find((m) => m.id === id)!, secret: "" });
              setClear(false);
            }}
          />
          <Button
            disabled={busy}
            onClick={() => {
              setDraft(fresh(image, video));
              setClear(false);
            }}
          >
            新增模型
          </Button>
        </Space>
        <Tag color={draft.configured && !clear ? "green" : "gold"}>
          {draft.configured && !clear ? "已配置密钥" : "待配置"}
        </Tag>
        <label>
          配置名称
          <Input
            value={draft.name}
            disabled={busy}
            placeholder={
              image ? "例如：封面插画、写实配图" : "例如：日常文案、专业长文"
            }
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          API 地址
          <Input
            value={draft.base_url}
            placeholder="填写服务商提供的 API 基础地址"
            disabled={busy}
            onChange={(e) =>
              setDraft({
                ...draft,
                base_url: e.target.value,
                vision_capability: undefined,
              })
            }
          />
        </label>
        <label>
          模型 ID
          <Input
            value={draft.model}
            disabled={busy}
            placeholder="填写服务商提供的准确模型 ID"
            onChange={(e) =>
              setDraft({
                ...draft,
                model: e.target.value,
                vision_capability: undefined,
              })
            }
          />
        </label>
        <label>
          API 密钥
          <Input.Password
            autoComplete="new-password"
            value={draft.secret || ""}
            disabled={busy}
            placeholder={
              draft.configured ? "已保存，留空保持不变" : "请输入 API Key"
            }
            onChange={(e) => {
              setDraft({ ...draft, secret: e.target.value });
              setClear(false);
            }}
          />
        </label>
        {!image && !video && (
          <Checkbox
            checked={!!draft.vision}
            disabled={busy || !!draft.vision_capability}
            onChange={(e) => setDraft({ ...draft, vision: e.target.checked })}
          >
            支持图片理解（用于根据参考图规划画面；需模型支持 image_url）
          </Checkbox>
        )}
        {!image && !video && draft.vision_capability && (
          <Alert
            type="info"
            message={
              draft.vision_capability === "text"
                ? "该模型仅支持文字，不能读取参考图。请另加 qwen3-vl-plus 等图片理解模型用于画面规划。"
                : "已识别为图片理解模型，无需手动勾选。能否调用仍取决于账号的模型权限。"
            }
          />
        )}
        {image && (
          <label>
            参考图支持
            <Select
              style={{ width: "100%" }}
              value={draft.reference_mode || "auto"}
              disabled={busy}
              onChange={(reference_mode) =>
                setDraft({ ...draft, reference_mode })
              }
              options={[
                {
                  value: "auto",
                  label: "自动识别（百炼 Qwen Image 3.0 / 2.1）",
                },
                { value: "none", label: "仅文生图" },
                {
                  value: "generations_image",
                  label: "参考图：Images Generations image 扩展",
                },
              ]}
            />
            <small className="muted">
              其他服务需明确支持 image 字段和 Base64 参考图后选择扩展协议。
            </small>
          </label>
        )}
        <Alert
          type="info"
          message={
            video
              ? "支持火山方舟和阿里云万相 3.0。方舟地址以 /api/v3 结尾；万相使用业务空间地址 /api/v1，模型为 wan3.0-video-prime 或 wan3.0-video。粘贴万相 /compatible-mode/v1 地址时会自动转换视频路径，地域与密钥保持不变。"
              : image
                ? "支持兼容 Images Generations 的图片模型，返回 Base64 或图片 URL。API 地址不包含 /images/generations。"
                : "支持兼容 Chat Completions 的文字模型。API 地址不包含 /chat/completions。"
          }
          description="可保存多套地址、模型和密钥；密钥由后端加密保存。每次生成会保留所选配置，修改配置不会改变已提交的任务。连接检测仅查询模型列表，不提交收费生成，也不保证视频调用权限。"
        />
        <Space wrap>
          <Button type="primary" loading={busy} onClick={() => save()}>
            保存配置
          </Button>
          <Button disabled={busy} onClick={() => save(true)}>
            保存并检测连接
          </Button>
          <Button
            danger
            disabled={busy || !draft.configured}
            onClick={() => {
              setClear(true);
              setDraft({ ...draft, secret: "" });
            }}
          >
            清除密钥（保存后生效）
          </Button>
        </Space>
      </div>
    </Drawer>
  );
}
