import { useRef, useState } from "react";
import {
  App,
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Select,
  Tabs,
  Upload,
} from "antd";
import { FolderOpenOutlined, UploadOutlined } from "@ant-design/icons";
import type { Asset } from "../api";
import { api, fileURL } from "../api";
import { inMediaLibrary } from "../assetLibrary";
import SourceMediaCarousel from "./SourceMediaCarousel";
import "./original-creation.css";

export type OriginalInput = {
  title: string;
  body: string;
  topics: string[];
  asset_ids: string[];
};

export default function OriginalCreationInput({
  value,
  assets,
  disabled,
  onChange,
  onUploaded,
  mediaOnly = false,
  contentOnly = false,
  hideMaterialActions = false,
  mediaKind,
}: {
  value: OriginalInput;
  assets: Asset[];
  disabled: boolean;
  onChange: (patch: Partial<OriginalInput>) => void;
  onUploaded: (asset: Asset) => void;
  mediaOnly?: boolean;
  contentOnly?: boolean;
  hideMaterialActions?: boolean;
  mediaKind?: "image" | "video";
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState("library"),
    [query, setQuery] = useState("");
  const [selection, setSelection] = useState<string[]>([]),
    [uploading, setUploading] = useState(0);
  const queue = useRef(Promise.resolve());
  const [previewID, setPreviewID] = useState("");
  const usable = assets.filter(
    (asset) =>
      !asset.deleted_at &&
      asset.status === "ready" &&
      inMediaLibrary(asset) &&
      ["image", "video"].includes(asset.kind) &&
      (!mediaKind || asset.kind === mediaKind),
  );
  const selected = value.asset_ids
    .map((id) => usable.find((asset) => asset.id === id))
    .filter((asset): asset is Asset => !!asset);
  const visible = usable.filter(
    (asset) =>
      !query ||
      (asset.name + (asset.original_name || ""))
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const show = (next: string) => {
    setSelection(value.asset_ids);
    setTab(next);
    setOpen(true);
  };
  return (
    <div className="original-creation-input">
      <div
        className={
          contentOnly
            ? "original-content-only"
            : mediaOnly
              ? "material-only-input"
              : "title-original-note"
        }
      >
        {!contentOnly && (
          <div className="original-material-source">
            {selected.length ? (
              <SourceMediaCarousel
                assets={selected}
                activeID={previewID || selected[0]?.id}
                onPreview={setPreviewID}
              />
            ) : (
              <div className="original-material-empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="创作素材"
                />
              </div>
            )}
            {!hideMaterialActions && (
              <div className="original-material-actions">
                <Button
                  icon={<FolderOpenOutlined />}
                  disabled={disabled}
                  onClick={() => show("library")}
                >
                  选择素材
                </Button>
                <Button
                  icon={<UploadOutlined />}
                  disabled={disabled}
                  onClick={() => show("upload")}
                >
                  上传素材
                </Button>
              </div>
            )}
          </div>
        )}
        {!mediaOnly && (
          <div className="original-content-fields">
            <label className="workflow-field">
              <span>创作标题</span>
              <Input
                aria-label="创作标题"
                value={value.title}
                disabled={disabled}
                maxLength={200}
                onChange={(event) => onChange({ title: event.target.value })}
              />
            </label>
            <label className="workflow-field">
              <span>创作文案</span>
              <Input.TextArea
                aria-label="创作文案"
                value={value.body}
                disabled={disabled}
                autoSize={{ minRows: 3, maxRows: 6 }}
                onChange={(event) => onChange({ body: event.target.value })}
                status={
                  Array.from(value.body).length > 12000 ? "error" : undefined
                }
              />
            </label>
            <label className="workflow-field">
              <span>话题</span>
              <Select
                aria-label="创作话题"
                mode="tags"
                value={value.topics}
                disabled={disabled}
                onChange={(topics) => onChange({ topics })}
              />
            </label>
          </div>
        )}
      </div>
      <Modal
        title="添加创作素材"
        className="creation-material-modal"
        width={760}
        centered
        open={open}
        onCancel={() => setOpen(false)}
        footer={
          <Button
            type="primary"
            loading={uploading > 0}
            disabled={disabled}
            onClick={() => {
              onChange({ asset_ids: selection });
              setOpen(false);
            }}
          >
            确认选择
          </Button>
        }
      >
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "library",
              label: "素材库",
              children: (
                <>
                  <Input.Search
                    aria-label="搜索创作素材"
                    placeholder="搜索素材"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    allowClear
                  />
                  {visible.length ? (
                    <div className="creation-material-grid">
                      {visible.map((asset) => (
                        <article
                          className={`creation-material-choice${selection.includes(asset.id) ? " selected" : ""}`}
                          key={asset.id}
                        >
                          {asset.kind === "image" ? (
                            <img src={fileURL(asset.id)} alt={asset.name} />
                          ) : (
                            <video
                              src={fileURL(asset.id)}
                              muted
                              preload="metadata"
                              aria-label={asset.name}
                            />
                          )}
                          <Checkbox
                            aria-label={`选用素材${asset.name}`}
                            checked={selection.includes(asset.id)}
                            onChange={(event) =>
                              setSelection((old) =>
                                event.target.checked
                                  ? mediaKind === "video"
                                    ? [asset.id]
                                    : [...old, asset.id]
                                  : old.filter((id) => id !== asset.id),
                              )
                            }
                          >
                            {asset.name}
                          </Checkbox>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty description="素材库暂无可用素材" />
                  )}
                </>
              ),
            },
            {
              key: "upload",
              label: "上传素材",
              children: (
                <Upload.Dragger
                  multiple={mediaKind !== "video"}
                  accept={
                    mediaKind === "image"
                      ? "image/jpeg,image/png,image/webp,image/gif"
                      : mediaKind === "video"
                        ? "video/mp4,video/quicktime,video/webm"
                        : "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
                  }
                  showUploadList={{ showRemoveIcon: false }}
                  beforeUpload={(file) => {
                    if (
                      mediaKind &&
                      !(
                        mediaKind === "image"
                          ? /\.(png|jpe?g|webp|gif)$/i
                          : /\.(mp4|mov|webm)$/i
                      ).test(file.name)
                    ) {
                      message.error(
                        `请选择${mediaKind === "image" ? "图片" : "视频"}文件`,
                      );
                      return Upload.LIST_IGNORE;
                    }
                    if (file.size > 512 * 1024 * 1024) {
                      message.error("单个文件最多512 MB");
                      return Upload.LIST_IGNORE;
                    }
                    return true;
                  }}
                  customRequest={({ file, onSuccess, onError }) => {
                    setUploading((old) => old + 1);
                    queue.current = queue.current.then(async () => {
                      try {
                        const form = new FormData();
                        form.append("file", file as File);
                        const asset = await api<Asset>("/assets", {
                          method: "POST",
                          body: form,
                        });
                        onUploaded(asset);
                        setSelection((old) =>
                          mediaKind === "video"
                            ? [asset.id]
                            : [...old, asset.id],
                        );
                        onSuccess?.(asset);
                      } catch (error) {
                        onError?.(error as Error);
                        message.error((error as Error).message);
                      } finally {
                        setUploading((old) => old - 1);
                      }
                    });
                  }}
                >
                  <p className="ant-upload-drag-icon">
                    <UploadOutlined />
                  </p>
                  <strong>
                    {mediaKind
                      ? `选择或拖入${mediaKind === "image" ? "图片" : "视频"}`
                      : "选择或拖入图片、视频"}
                  </strong>
                </Upload.Dragger>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}
