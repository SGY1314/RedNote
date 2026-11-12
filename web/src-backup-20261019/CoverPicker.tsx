import { App, Button, Image, Input, Modal, Space, Upload } from "antd";
import { useEffect, useRef, useState } from "react";
import type { Asset } from "./api";
import { api, fileURL } from "./api";
import { inMediaLibrary } from "./assetLibrary";

export default function CoverPicker({
  assets,
  value,
  disabled,
  onConfirm,
  refresh,
}: {
  assets: Asset[];
  value: string;
  disabled: boolean;
  onConfirm: (id: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("");
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const uploaded = useRef<{ file: File; id: string } | undefined>(undefined);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const available = assets.filter(
    (a) =>
      inMediaLibrary(a) &&
      !a.deleted_at &&
      a.status === "ready" &&
      a.kind === "image",
  );
  const source = file ? preview : chosen ? fileURL(chosen) : "";
  const close = () => {
    if (!saving.current) {
      setOpen(false);
      setFile(undefined);
    }
  };
  return (
    <>
      <Space wrap>
        <span className="muted">封面</span>
        {value && (
          <Image
            src={fileURL(value)}
            width={64}
            height={64}
            style={{ objectFit: "contain" }}
          />
        )}
        <Button
          disabled={disabled}
          onClick={() => {
            setQuery("");
            setChosen(value);
            setFile(undefined);
            setLoaded(false);
            setOpen(true);
          }}
        >
          选择封面
        </Button>
        {value && (
          <Button
            disabled={disabled}
            onClick={async () => {
              await onConfirm("");
            }}
          >
            取消封面
          </Button>
        )}
      </Space>
      <Modal
        destroyOnHidden
        title="选择并预览封面"
        open={open}
        width={800}
        onCancel={close}
        closable={!busy}
        maskClosable={!busy}
        confirmLoading={busy}
        okText="使用这张封面"
        okButtonProps={{ disabled: disabled || !source || !loaded }}
        onOk={async () => {
          if (saving.current || disabled || !loaded || !source) return;
          saving.current = true;
          setBusy(true);
          try {
            let id = chosen;
            if (file) {
              if (uploaded.current?.file === file) id = uploaded.current.id;
              else {
                const data = new FormData();
                data.append("file", file);
                const asset = await api<Asset>("/assets", {
                  method: "POST",
                  body: data,
                });
                if (asset.kind !== "image") throw Error("请选择图片作为封面");
                id = asset.id;
                uploaded.current = { file, id };
              }
            }
            if (await onConfirm(id)) {
              setOpen(false);
              setFile(undefined);
            }
            await refresh();
          } catch (e) {
            message.error((e as Error).message);
          } finally {
            saving.current = false;
            setBusy(false);
          }
        }}
      >
        <Space wrap style={{ marginBottom: 16 }}>
          <Upload
            disabled={busy || disabled}
            accept="image/jpeg,image/png,image/webp"
            showUploadList={false}
            beforeUpload={(candidate) => {
              if (
                !["image/jpeg", "image/png", "image/webp"].includes(
                  candidate.type,
                ) ||
                candidate.size > 32 * 1024 * 1024
              ) {
                message.error("请选择不超过 32 MB 的 JPG、PNG 或 WebP 图片");
                return false;
              }
              setLoaded(false);
              setChosen("");
              setFile(candidate);
              return false;
            }}
          >
            <Button disabled={busy || disabled}>从本地选择图片</Button>
          </Upload>
          <Input.Search
            placeholder="搜索素材库图片"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Space>
        <p className="muted">
          先预览再确认。本地图片仅在点击「使用这张封面」后上传到素材库。
        </p>
        {source && (
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <Image
              key={source}
              src={source}
              width={240}
              style={{ maxHeight: 280, objectFit: "contain" }}
              onLoad={() => setLoaded(true)}
              onError={() => {
                setLoaded(false);
                message.error("封面预览失败，请重新选择");
              }}
            />
            <p>{file?.name || assets.find((a) => a.id === chosen)?.name}</p>
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))",
            gap: 12,
            maxHeight: 300,
            overflowY: "auto",
          }}
        >
          {available
            .filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
            .map((a) => (
              <div key={a.id}>
                <Image
                  src={fileURL(a.id)}
                  width={120}
                  height={100}
                  style={{ objectFit: "contain" }}
                />
                <p title={a.name}>{a.name}</p>
                <Button
                  disabled={busy || disabled}
                  type={chosen === a.id ? "primary" : "default"}
                  onClick={() => {
                    if (chosen !== a.id || file) setLoaded(false);
                    setFile(undefined);
                    setChosen(a.id);
                  }}
                >
                  {chosen === a.id ? "已选择" : "选择并预览"}
                </Button>
              </div>
            ))}
        </div>
      </Modal>
    </>
  );
}
