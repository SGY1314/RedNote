import { Button, Checkbox, Modal, Popover, Space } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  PlayCircleOutlined,
  PictureOutlined,
} from "@ant-design/icons";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Asset } from "../api";
import { fileURL } from "../api";

const source = (asset: Asset) =>
  asset.status === "ready"
    ? fileURL(asset.id)
    : `/api/v1/assets/${asset.id}/preview`;
const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function CompactMedia({
  title,
  assets,
  selected = [],
  onToggle,
  moreActions,
  actions,
  coverID,
  emptyText = "暂无素材，可上传或生成后选择",
}: {
  title: string;
  assets: Asset[];
  selected?: string[];
  onToggle?: (id: string) => void;
  moreActions?: (asset: Asset) => ReactNode;
  actions?: (asset: Asset, index: number) => ReactNode;
  coverID?: string;
  emptyText?: string;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [activeID, setActiveID] = useState("");
  const [previewID, setPreviewID] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const index = Math.max(
    0,
    assets.findIndex((asset) => asset.id === activeID),
  );
  const active = assets[index];
  const enlarged = assets.find((asset) => asset.id === previewID);
  const previewIndex = assets.findIndex((asset) => asset.id === previewID);
  useEffect(() => {
    setMoreOpen(false);
  }, [active?.id]);
  const move = (next: number, inPreview = false) => {
    const asset = assets[Math.max(0, Math.min(assets.length - 1, next))];
    if (!asset) return;
    setActiveID(asset.id);
    if (inPreview) setPreviewID(asset.id);
    rail.current
      ?.querySelector<HTMLElement>(`[data-index="${assets.indexOf(asset)}"]`)
      ?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
  };
  return (
    <section className="workflow-compact-media" aria-label={title}>
      <div className="workflow-compact-head">
        <strong>
          {title}
          <small>
            {" "}
            · {assets.length}
            {assets.length > 0 &&
            assets.every((asset) => asset.kind === "image")
              ? "张"
              : "个"}
          </small>
        </strong>
        {assets.length > 1 && (
          <Space size={4}>
            <Button
              size="small"
              type="text"
              aria-label={`${title}上一项`}
              icon={<ArrowLeftOutlined />}
              disabled={index === 0}
              onClick={() => move(index - 1)}
            />
            <Button
              size="small"
              type="text"
              aria-label={`${title}下一项`}
              icon={<ArrowRightOutlined />}
              disabled={index === assets.length - 1}
              onClick={() => move(index + 1)}
            />
          </Space>
        )}
      </div>
      {!assets.length ? (
        <p className="workflow-compact-empty">{emptyText}</p>
      ) : (
        <>
          <div ref={rail} className="workflow-compact-strip">
            {assets.map((asset, i) => (
              <div
                key={asset.id}
                data-index={i}
                className={`workflow-compact-card${i === index ? " active" : ""}${selected.includes(asset.id) ? " selected" : ""}`}
              >
                <button
                  type="button"
                  className="workflow-compact-preview"
                  aria-label={`${title}预览第${i + 1}项`}
                  title={asset.name}
                  onClick={() => {
                    setActiveID(asset.id);
                    setPreviewID(asset.id);
                  }}
                >
                  {asset.kind === "video" ? (
                    <>
                      <video
                        src={source(asset) + "#t=0.1"}
                        preload="metadata"
                        muted
                        playsInline
                        aria-hidden="true"
                        tabIndex={-1}
                      />
                      <PlayCircleOutlined className="workflow-compact-play" />
                      <span className="workflow-compact-duration">
                        {asset.duration > 0 ? duration(asset.duration) : "视频"}
                      </span>
                    </>
                  ) : (
                    <>
                      <PictureOutlined className="workflow-compact-placeholder" />
                      <img
                        loading="lazy"
                        src={source(asset)}
                        alt={asset.name}
                        onError={(event) => {
                          event.currentTarget.style.visibility = "hidden";
                        }}
                      />
                    </>
                  )}
                  <span className="workflow-compact-number">{i + 1}</span>
                  {asset.id === coverID && (
                    <span className="workflow-compact-cover">封面</span>
                  )}
                </button>
                <small title={asset.name}>{asset.name}</small>
                {onToggle && (
                  <Checkbox
                    aria-label={`${title}选择第${i + 1}项`}
                    checked={selected.includes(asset.id)}
                    disabled={asset.status !== "ready"}
                    onChange={() => {
                      setActiveID(asset.id);
                      onToggle(asset.id);
                    }}
                  >
                    {selected.includes(asset.id) ? "已选" : "选择"}
                  </Checkbox>
                )}
              </div>
            ))}
          </div>
          {active && (
            <div className="workflow-compact-toolbar">
              <span className="workflow-compact-current" title={active.name}>
                {index + 1} / {assets.length} · {active.name}
              </span>
              <div className="workflow-compact-buttons">
                <Button size="small" onClick={() => setPreviewID(active.id)}>
                  {active.kind === "video" ? "播放" : "预览"}
                </Button>
                {actions?.(active, index)}
                {moreActions && (
                  <Popover
                    trigger="click"
                    placement="topRight"
                    open={moreOpen}
                    onOpenChange={setMoreOpen}
                    content={moreActions(active)}
                  >
                    <Button size="small">更多</Button>
                  </Popover>
                )}
              </div>
            </div>
          )}
        </>
      )}
      <Modal
        title={
          enlarged ? `${title} · ${previewIndex + 1} / ${assets.length}` : title
        }
        open={!!enlarged}
        onCancel={() => setPreviewID("")}
        footer={null}
        width={960}
        centered
        destroyOnHidden
        className="workflow-media-modal"
      >
        {enlarged && (
          <>
            {enlarged.kind === "video" ? (
              <video
                key={enlarged.id}
                controls
                playsInline
                autoPlay
                preload="metadata"
                src={source(enlarged)}
                aria-label={enlarged.name}
              />
            ) : (
              <img src={source(enlarged)} alt={enlarged.name} />
            )}
            <div className="workflow-media-modal-footer">
              <span title={enlarged.name}>{enlarged.name}</span>
              <Space wrap>
                <Button
                  aria-label="预览上一项"
                  disabled={previewIndex === 0}
                  icon={<ArrowLeftOutlined />}
                  onClick={() => move(previewIndex - 1, true)}
                />
                <Button
                  aria-label="预览下一项"
                  disabled={previewIndex === assets.length - 1}
                  icon={<ArrowRightOutlined />}
                  onClick={() => move(previewIndex + 1, true)}
                />
                {onToggle && (
                  <Checkbox
                    checked={selected.includes(enlarged.id)}
                    disabled={enlarged.status !== "ready"}
                    onChange={() => onToggle(enlarged.id)}
                  >
                    {selected.includes(enlarged.id) ? "已选用" : "选用素材"}
                  </Checkbox>
                )}
                <Button onClick={() => setPreviewID("")}>关闭</Button>
              </Space>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}
