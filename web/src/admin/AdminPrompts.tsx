import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Modal,
  Segmented,
  Switch,
  Tag,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { api, APIError } from "../api";
import "./admin-prompts.css";

type Scope = "title" | "copy" | "image" | "video-script" | "video";
type PromptPreset = {
  id: string;
  scope: Scope;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  is_default: boolean;
  revision: number;
  updated_at: string;
};
const labels: Record<Scope, string> = {
  title: "标题仿写",
  copy: "文案仿写",
  image: "图片仿写",
  "video-script": "视频脚本",
  video: "视频生成",
};
const empty = (scope: Scope): PromptPreset => ({
  id: "",
  scope,
  name: "",
  description: "",
  prompt: "",
  enabled: true,
  is_default: true,
  revision: 0,
  updated_at: "",
});

export default function AdminPrompts() {
  const { message, modal } = App.useApp();
  const [scope, setScope] = useState<Scope>("title");
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [draft, setDraft] = useState<PromptPreset>();
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<PromptPreset>();
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setPresets(await api<PromptPreset[]>("/admin/prompt-presets"));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.prompt.trim()) {
      message.warning("请填写方案名称和提示词");
      return;
    }
    setSaving(true);
    try {
      await api(
        draft.id
          ? `/admin/prompt-presets/${draft.id}`
          : "/admin/prompt-presets",
        {
          method: draft.id ? "PUT" : "POST",
          body: JSON.stringify(draft),
        },
      );
      setConflict(undefined);
      message.success("系统提示词已保存");
      setDraft(undefined);
      await reload();
    } catch (error) {
      message.error((error as Error).message);
      if (error instanceof APIError && error.status === 409 && draft.id) {
        try {
          const latest = await api<PromptPreset[]>("/admin/prompt-presets");
          setPresets(latest);
          setConflict(latest.find((p) => p.id === draft.id));
        } catch (e) {
          message.error((e as Error).message);
        }
      }
    } finally {
      setSaving(false);
    }
  };
  const remove = (preset: PromptPreset) =>
    modal.confirm({
      title: `删除“${preset.name}”？`,
      content: "已提交的任务保留原提示词，后续生成使用当前默认提示词。",
      okText: "删除方案",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api(`/admin/prompt-presets/${preset.id}`, { method: "DELETE" });
          await reload();
        } catch (error) {
          message.error((error as Error).message);
          throw error;
        }
      },
    });
  const shown = presets.filter((item) => item.scope === scope);
  return (
    <section className="admin-page-card admin-prompts">
      <div className="admin-prompts-head">
        <div>
          <h2>系统提示词</h2>
          <p>默认提示词应用到工作台对应的仿写板块。</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setConflict(undefined);
            setDraft(empty(scope));
          }}
        >
          新增方案
        </Button>
      </div>
      <Segmented
        block
        className="admin-prompts-tabs"
        value={scope}
        options={Object.entries(labels).map(([value, label]) => ({
          value,
          label,
        }))}
        onChange={(value) => setScope(value as Scope)}
      />
      <div className="admin-prompts-list">
        {shown.length ? (
          shown.map((item) => (
            <article key={item.id} className="admin-prompts-item">
              <div className="admin-prompts-item-main">
                <div className="admin-prompts-title">
                  <strong>{item.name}</strong>
                  {item.is_default && <Tag color="blue">默认</Tag>}
                  {!item.enabled && <Tag>已停用</Tag>}
                </div>
                {item.description && <p>{item.description}</p>}
                <small>
                  版本 {item.revision} · {Array.from(item.prompt).length}{" "}
                  字提示词
                </small>
              </div>
              <div className="admin-prompts-actions">
                <Button
                  icon={<EditOutlined />}
                  onClick={() => {
                    setConflict(undefined);
                    setDraft({ ...item });
                  }}
                >
                  编辑
                </Button>
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => remove(item)}
                >
                  删除
                </Button>
              </div>
            </article>
          ))
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              loading ? "正在读取…" : "此环节暂未添加方案，将使用系统基础规则"
            }
          />
        )}
      </div>
      <Modal
        className="admin-prompt-modal"
        open={!!draft}
        title={
          draft?.id
            ? `编辑${labels[draft.scope]}方案`
            : `新增${labels[scope]}方案`
        }
        width={680}
        okText="保存方案"
        okButtonProps={{ loading: saving, disabled: !!conflict }}
        onOk={() => void save()}
        onCancel={() => !saving && setDraft(undefined)}
        destroyOnHidden
      >
        {draft && (
          <div className="admin-prompts-form">
            {conflict && (
              <Alert
                type="warning"
                message="模板已被其他窗口更新，你的输入仍保留。请核对后选择。"
                description={
                  <>
                    <p>服务器最新提示词：</p>
                    <Input.TextArea readOnly value={conflict.prompt} rows={4} />
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <Button
                        onClick={() => {
                          setDraft({ ...conflict });
                          setConflict(undefined);
                        }}
                      >
                        使用服务器版本
                      </Button>
                      <Button
                        onClick={() => {
                          setDraft({ ...draft, revision: conflict.revision });
                          setConflict(undefined);
                        }}
                      >
                        保留当前修改，重新核对
                      </Button>
                    </div>
                  </>
                }
              />
            )}

            <label>
              <span>方案名称</span>
              <Input
                value={draft.name}
                maxLength={60}
                placeholder="例如：自然分享"
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </label>
            <label>
              <span>说明</span>
              <Input
                value={draft.description}
                maxLength={160}
                placeholder="可留空"
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
            </label>
            <label>
              <span>系统提示词</span>
              <Input.TextArea
                value={draft.prompt}
                rows={9}
                maxLength={4000}
                showCount
                placeholder="填写这个板块的创作要求"
                onChange={(event) =>
                  setDraft({ ...draft, prompt: event.target.value })
                }
              />
            </label>
            <div className="admin-prompts-switches">
              <label>
                <Switch
                  checked={draft.enabled}
                  onChange={(enabled) => setDraft({ ...draft, enabled })}
                />{" "}
                启用
              </label>
              <label>
                <Switch
                  checked={draft.is_default}
                  disabled={!draft.enabled}
                  onChange={(is_default) => setDraft({ ...draft, is_default })}
                />{" "}
                设为此板块默认
              </label>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
