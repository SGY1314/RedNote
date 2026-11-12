import {
  ApiOutlined,
  AudioOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  PictureOutlined,
  PlusOutlined,
  SettingOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Empty, Segmented, Tag } from "antd";
import { useState } from "react";
import { api } from "../api";
import RewriteModels from "../RewriteModels";
import type { RewriteModel } from "../RewriteModels";
import { useModelCatalog } from "../hooks/useModelCatalog";
import type { ModelCapability } from "../hooks/useModelCatalog";
import AdminServiceModels from "./AdminServiceModels";
import type { ServiceModelKind } from "./AdminServiceModels";

// 分组清单与工作区一一对应：rewrite 对应 /rewrite-models，其余对应
// <capability>-models。标签只影响文案，分组标识不允许在两侧漂移。
const groups: {
  cap: ModelCapability;
  name: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    cap: "rewrite",
    name: "通用文案模型",
    description: "用于通用文案创作与文本理解",
    icon: <FileTextOutlined />,
  },
  {
    cap: "title",
    name: "标题仿写模型",
    description: "生成候选标题",
    icon: <FileTextOutlined />,
  },
  {
    cap: "copy",
    name: "文案仿写模型",
    description: "结合标题、原文与补充要求生成文案",
    icon: <FileTextOutlined />,
  },
  {
    cap: "image",
    name: "图片模型",
    description: "仅用于生成图片，与画面规划模型独立",
    icon: <PictureOutlined />,
  },
  {
    cap: "video-script",
    name: "视频脚本模型",
    description: "生成分镜脚本",
    icon: <FileTextOutlined />,
  },
  {
    cap: "video",
    name: "视频模型",
    description: "根据脚本、系统提示词与补充要求生成视频",
    icon: <VideoCameraOutlined />,
  },
];

const capabilityLabels = [
  ...groups.map(({ cap, name, icon }) => ({
    value: cap,
    label: (
      <span className="admin-capability-label">
        <span aria-hidden="true">{icon}</span>
        {name.replace("模型", "")}
      </span>
    ),
  })),
  {
    value: "ocr",
    label: (
      <span className="admin-capability-label">
        <PictureOutlined />
        图片 OCR
      </span>
    ),
  },
  {
    value: "asr",
    label: (
      <span className="admin-capability-label">
        <AudioOutlined />
        语音转写
      </span>
    ),
  },
];

// 编辑器表单只有文案 / 图片 / 视频三种形态，与工作区 RewriteModels 的取值一致。
function editorCapability(
  capability: ModelCapability,
): "text" | "image" | "video" {
  return capability === "image"
    ? "image"
    : capability === "video"
      ? "video"
      : "text";
}

function CapabilityModels({ capability }: { capability: ModelCapability }) {
  const { message, modal } = App.useApp();
  // 与管理端同一套 hook：请求序号、选中态回填、卸载保护都与工作区一致。
  const { models, error, reload } = useModelCatalog(
    capability,
    `/admin/models/${capability}`,
  );
  const [drawer, setDrawer] = useState<{ initialID?: string } | null>(null);
  const group = groups.find((item) => item.cap === capability)!;
  const remove = (model: RewriteModel) => {
    modal.confirm({
      title: `删除“${model.name}”？`,
      content:
        "仅删除当前环节的这条模型配置。历史生成结果及已提交任务保留；其他环节的同名配置不受影响。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api(
            `/admin/models/${capability}/${encodeURIComponent(model.id)}`,
            { method: "DELETE" },
          );
          await reload();
          if (drawer?.initialID === model.id) setDrawer(null);
          message.success("模型配置已删除");
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });
  };
  return (
    <div className="admin-model-grid">
      <article className="admin-model-group">
        <div className="admin-model-group-head">
          <div className="admin-model-icon">{group.icon}</div>
          <div>
            <strong>{group.name}</strong>
            <small>{group.description}</small>
          </div>
          <span className="admin-model-count">{models.length} 个模型</span>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setDrawer({ initialID: "" })}
          >
            新增模型
          </Button>
        </div>
        {error && <Alert type="error" showIcon message={error} />}
        {models.length ? (
          <div className="admin-model-list">
            {models.map((model) => (
              <article key={model.id} className="admin-model-entry">
                <button
                  className="admin-model-row"
                  aria-label={"配置模型 " + model.name}
                  onClick={() => setDrawer({ initialID: model.id })}
                >
                  <span className="admin-model-row-icon">
                    <ApiOutlined />
                  </span>
                  <span className="admin-model-row-copy">
                    <strong title={model.name}>{model.name}</strong>
                    <small title={model.model}>{model.model}</small>
                    <em title={model.base_url}>{model.base_url}</em>
                  </span>
                </button>
                <div className="admin-model-entry-actions">
                  <Tag
                    className={
                      "admin-config-status " +
                      (model.configured ? "is-configured" : "")
                    }
                  >
                    <i aria-hidden="true" />
                    {model.configured ? "已配置密钥" : "待配置"}
                  </Tag>
                  <Button
                    icon={<EditOutlined />}
                    aria-label={"编辑模型 " + model.name}
                    onClick={() => setDrawer({ initialID: model.id })}
                  >
                    配置
                  </Button>
                  <Button
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    aria-label={"删除模型 " + model.name}
                    onClick={() => remove(model)}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有模型配置"
          >
            <Button
              icon={<PlusOutlined />}
              onClick={() => setDrawer({ initialID: "" })}
            >
              添加第一个模型
            </Button>
          </Empty>
        )}
      </article>
      {drawer && (
        <RewriteModels
          key={`${capability}:${drawer.initialID ?? "new"}`}
          open
          embedded
          endpointBase={`/admin/models/${capability}`}
          capability={editorCapability(capability)}
          initialID={drawer.initialID}
          onClose={() => setDrawer(null)}
          models={models}
          onSaved={reload}
        />
      )}
    </div>
  );
}

export default function AdminModels({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const [capability, setCapability] = useState<
    ModelCapability | ServiceModelKind
  >("rewrite");
  const service =
    capability === "ocr" || capability === "asr" ? capability : undefined;
  return (
    <section className="admin-model-page">
      <div className="admin-model-top">
        <div>
          <h2>为每个创作环节选择模型</h2>
        </div>
        <Button icon={<SettingOutlined />} onClick={onOpenSettings}>
          服务与环境设置
        </Button>
      </div>
      <Segmented
        className="admin-capability-tabs"
        aria-label="选择模型环节"
        value={capability}
        options={capabilityLabels}
        onChange={(value) =>
          setCapability(value as ModelCapability | ServiceModelKind)
        }
      />
      {!service && (
        <CapabilityModels
          key={capability}
          capability={capability as ModelCapability}
        />
      )}
      <AdminServiceModels service={service} />
    </section>
  );
}
