import { useRef, useState } from "react";
import { App, Button, Popover } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { Asset } from "../api";
import ReferenceMediaPicker from "../ReferenceMediaPicker";

export default function ResultMediaAdd({
  kind,
  assets,
  disabled,
  onAdd,
  onUpload,
}: {
  kind: "image" | "video";
  assets: Asset[];
  disabled: boolean;
  onAdd: (ids: string[]) => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const label = kind === "video" ? "视频" : "图片";
  return (
    <>
      <Popover
        trigger="click"
        open={open && !disabled}
        onOpenChange={setOpen}
        placement="bottomRight"
        content={
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Button
              type="text"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                setLibraryOpen(true);
              }}
            >
              从素材库选择
            </Button>
            <Button
              type="text"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                input.current?.click();
              }}
            >
              上传{label}
            </Button>
          </div>
        }
      >
        <Button
          aria-label={`添加${label}`}
          title={`添加${label}`}
          icon={<PlusOutlined />}
          disabled={disabled}
        />
      </Popover>
      <input
        ref={input}
        hidden
        type="file"
        disabled={disabled}
        accept={
          kind === "video"
            ? "video/mp4,video/quicktime,video/webm"
            : "image/jpeg,image/png,image/webp,image/gif"
        }
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || disabled) return;
          if (
            !(
              kind === "video"
                ? /\.(mp4|mov|webm)$/i
                : /\.(png|jpe?g|webp|gif)$/i
            ).test(file.name)
          ) {
            message.error(
              kind === "video"
                ? "请选择 MP4、MOV 或 WebM 视频"
                : "请选择 JPG、PNG、WebP 或 GIF 图片",
            );
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
        }}
      />
      <ReferenceMediaPicker
        assets={assets}
        selected={[]}
        disabled={disabled}
        onChange={onAdd}
        mediaKind={kind}
        purpose="result"
        maxCount={100}
        hideTrigger
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
      />
    </>
  );
}
