import { App, Button, Checkbox, Image, Upload } from "antd";
import { PlusOutlined, UploadOutlined } from "@ant-design/icons";
import type { Asset } from "../api";
import { fileURL } from "../api";
import RemoveResultButton from "./RemoveResultButton";

export default function ImageTimelineUpload({
  index,
  asset,
  selected,
  disabled,
  onUpload,
  onSelect,
  compact = false,
  onRemove,
}: {
  index: number;
  asset?: Asset;
  selected: boolean;
  disabled: boolean;
  onUpload: (index: number, file: File) => Promise<void>;
  onSelect: (checked: boolean) => void;
  compact?: boolean;
  onRemove?: () => void;
}) {
  const { message } = App.useApp();
  const uploadProps = {
    accept: "image/jpeg,image/png,image/webp,image/gif",
    disabled,
    showUploadList: false,
    beforeUpload: (file: File) => {
      if (!/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
        message.error("请选择 JPG、PNG、WebP 或 GIF 图片");
        return Upload.LIST_IGNORE;
      }
      if (file.size > 512 * 1024 * 1024) {
        message.error("单个文件最多512 MB");
        return Upload.LIST_IGNORE;
      }
      return true;
    },
    customRequest: async ({
      file,
      onSuccess,
      onError,
    }: Parameters<
      NonNullable<import("antd").UploadProps["customRequest"]>
    >[0]) => {
      try {
        await onUpload(index, file as File);
        onSuccess?.({});
      } catch (error) {
        onError?.(error as Error);
        message.error((error as Error).message);
      }
    },
  };
  if (compact)
    return (
      <Upload {...uploadProps}>
        <Button
          aria-label="上传图片"
          title="上传图片"
          icon={<PlusOutlined />}
          disabled={disabled}
        />
      </Upload>
    );
  return (
    <article
      className={`image-upload-card${selected ? " is-selected" : ""}`}
      data-upload-slot={index}
      data-upload-id={asset?.id}
    >
      {asset && onRemove && (
        <RemoveResultButton
          kind="image"
          disabled={disabled}
          onRemove={onRemove}
        />
      )}
      {asset ? (
        <div
          className="media-output-preview"
          style={{
            aspectRatio:
              asset.width && asset.height
                ? `${asset.width} / ${asset.height}`
                : undefined,
          }}
        >
          <Image src={fileURL(asset.id)} alt={asset.name || "上传的图片"} />
        </div>
      ) : (
        <Upload.Dragger {...uploadProps} className="image-timeline-dropzone">
          <div className="image-upload-prompt">
            <UploadOutlined />
            <strong>上传图片</strong>
          </div>
        </Upload.Dragger>
      )}
      {asset && (
        <div className="media-output-actions image-upload-actions">
          <>
            <Checkbox
              aria-label={`选用${asset.name || "上传图片"}`}
              checked={selected}
              disabled={disabled}
              onChange={(event) => onSelect(event.target.checked)}
            >
              选用
            </Checkbox>
            <Upload {...uploadProps}>
              <Button type="text" size="small" disabled={disabled}>
                替换
              </Button>
            </Upload>
          </>
        </div>
      )}
    </article>
  );
}
