import { useRef } from "react";
import { App } from "antd";
import { FileImageOutlined, UploadOutlined } from "@ant-design/icons";
import type { Asset } from "../api";
import { fileURL } from "../api";
import SourceMediaCarousel from "./SourceMediaCarousel";

export default function ImageReferencePanel({
  references,
  activeID,
  selected,
  disabled,
  onPreview,
  onToggle,
  onUpload,
}: {
  references: Asset[];
  activeID?: string;
  selected: string[];
  disabled: boolean;
  onPreview: (id: string) => void;
  onToggle: (id: string) => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const { message } = App.useApp();
  const input = useRef<HTMLInputElement>(null);
  const current =
    references.find((asset) => asset.id === activeID) || references[0];
  const selectFile = () => {
    input.current?.click();
  };
  const accept = async (file?: File) => {
    if (!file || disabled) return;
    if (!/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
      message.error("请选择 JPG、PNG、WebP 或 GIF 图片");
      return;
    }
    if (file.size > 512 * 1024 * 1024) {
      message.error("单个文件最多512 MB");
      return;
    }
    try {
      await onUpload(file);
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  return (
    <section
      className="image-reference-panel image-composer-card"
      aria-label="参考素材"
    >
      <header className="image-composer-heading">
        <h3>
          <FileImageOutlined /> 参考素材
        </h3>
      </header>
      <input
        ref={input}
        type="file"
        hidden
        aria-label="上传参考图片"
        accept="image/jpeg,image/png,image/webp,image/gif"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void accept(file);
        }}
      />
      <div className="image-reference-gallery">
        {current ? (
          <SourceMediaCarousel
            assets={references}
            activeID={current.id}
            selectedIDs={selected}
            disabled={disabled}
            onPreview={onPreview}
            onToggle={onToggle}
          />
        ) : (
          <button
            type="button"
            className="image-reference-empty"
            disabled={disabled}
            onClick={() => selectFile()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void accept(event.dataTransfer.files[0]);
            }}
          >
            <UploadOutlined />
            <span>上传图片</span>
          </button>
        )}
        {!!references.length && (
          <div
            className="image-reference-thumbnails"
            role="group"
            aria-label="参考图缩略图"
          >
            {references.map((asset, index) => (
              <button
                type="button"
                key={asset.id}
                className={asset.id === current?.id ? "is-active" : ""}
                aria-label={`查看参考图片${index + 1}`}
                aria-pressed={asset.id === current?.id}
                onClick={() => onPreview(asset.id)}
              >
                <img src={fileURL(asset.id)} alt="" />
                {selected.includes(asset.id) && (
                  <span
                    className="image-thumbnail-selected"
                    aria-label="已选为参考"
                  >
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
