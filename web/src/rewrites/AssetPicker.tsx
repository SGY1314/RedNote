import { Button, Checkbox, Empty, Image, Input, Modal } from "antd";
import { useState } from "react";
import type { Asset } from "../api";
import { fileURL } from "../api";

export default function AssetPicker({
  title,
  assets,
  selected,
  single = false,
  onClose,
  onConfirm,
}: {
  title: string;
  assets: Asset[];
  selected: string[];
  single?: boolean;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [ids, setIDs] = useState(selected);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Asset>();
  const visible = assets.filter((a) =>
    a.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const toggle = (id: string) =>
    setIDs((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : single
          ? [id]
          : [...current, id],
    );
  return (
    <Modal
      open
      title={title}
      width={760}
      onCancel={onClose}
      onOk={() => onConfirm(ids)}
      okText={`确定选择${ids.length ? `（${ids.length}）` : ""}`}
      cancelText="取消"
      className="workflow-picker-modal"
    >
      <Input.Search
        aria-label="搜索素材"
        placeholder="搜索素材名称"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        allowClear
      />
      <div className="workflow-asset-grid">
        {visible.map((a) => (
          <article
            key={a.id}
            className={ids.includes(a.id) ? "is-selected" : ""}
          >
            <div className="workflow-asset-thumb">
              {a.kind === "image" ? (
                <Image
                  width="100%"
                  height={110}
                  style={{ objectFit: "contain", width: "100%", height: 110 }}
                  src={fileURL(a.id)}
                  alt={a.name}
                  preview={{ mask: "预览" }}
                />
              ) : (
                <button
                  type="button"
                  aria-label={`预览 ${a.name}`}
                  onClick={() => setPreview(a)}
                >
                  <video
                    src={fileURL(a.id) + "#t=0.1"}
                    preload="metadata"
                    muted
                    playsInline
                  />
                  <span>▶ 视频</span>
                </button>
              )}
            </div>
            <Checkbox
              checked={ids.includes(a.id)}
              onChange={() => toggle(a.id)}
            >
              <span title={a.name}>{a.name}</span>
            </Checkbox>
          </article>
        ))}
      </div>
      {!visible.length && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无可选素材，可从本地上传"
        />
      )}
      {preview && (
        <Modal
          open
          title="视频预览"
          footer={<Button onClick={() => setPreview(undefined)}>关闭</Button>}
          onCancel={() => setPreview(undefined)}
          destroyOnHidden
        >
          <video
            src={fileURL(preview.id)}
            controls
            autoPlay
            playsInline
            style={{ width: "100%", maxHeight: "60dvh" }}
          />
        </Modal>
      )}
    </Modal>
  );
}
