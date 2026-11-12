import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Empty, Upload } from "antd";
import {
  DownloadOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import type { UploadProps } from "antd";
import type { Asset } from "../api";
import { fileURL } from "../api";
import type { ImageTimelineEntry } from "./ImageResultTimeline";
import RemoveResultButton from "./RemoveResultButton";
import "./video-result-carousel.css";

type Card = {
  id: string;
  asset?: Asset;
  label: string;
  model?: string;
  slot?: number;
};
export default function VideoResultCarousel({
  entries,
  uploadSlots,
  selected,
  disabled,
  onUpload,
  onSelection,
  onRemove,
}: {
  entries: ImageTimelineEntry[];
  uploadSlots: (Asset | undefined)[];
  selected: string[];
  disabled: boolean;
  onUpload: (index: number, file: File) => Promise<void>;
  onSelection: (ids: string[]) => void;
  onRemove: (id: string) => void;
}) {
  const { message } = App.useApp();
  const root = useRef<HTMLDivElement>(null);
  const [activeID, setActiveID] = useState("");
  const cards: Card[] = [
    ...uploadSlots
      .map((asset, slot) => ({
        id: asset?.id || "",
        asset,
        label: asset?.name || "上传的视频",
        slot,
      }))
      .filter((card) => card.asset)
      .reverse(),
    ...entries
      .filter(
        (entry) => !uploadSlots.some((asset) => asset?.id === entry.asset.id),
      )
      .map((entry) => ({
        id: entry.asset.id,
        asset: entry.asset,
        label: entry.asset.name || entry.label || "生成的视频",
        model: entry.model,
      })),
  ];
  const signature = cards.map((card) => card.id).join(",");
  const known = useRef(new Set(cards.map((card) => card.id)));
  useEffect(() => {
    const added = cards.find((card) => !known.current.has(card.id));
    if (added) setActiveID(added.id);
    known.current = new Set(cards.map((card) => card.id));
  }, [signature]);
  const index = Math.max(
    0,
    cards.findIndex((card) => card.id === activeID),
  );
  useEffect(() => {
    root.current?.querySelectorAll("video").forEach((video) => video.pause());
  }, [index, signature]);
  const go = (next: number) => {
    if (next >= 0 && next < cards.length) setActiveID(cards[next].id);
  };
  const uploadProps = (slot: number): UploadProps => ({
    accept: "video/mp4,video/quicktime,video/webm",
    disabled,
    showUploadList: false,
    beforeUpload: (file) => {
      if (!/\.(mp4|mov|webm)$/i.test(file.name)) {
        message.error("请选择 MP4、MOV 或 WebM 视频");
        return Upload.LIST_IGNORE;
      }
      if (file.size > 512 * 1024 * 1024) {
        message.error("单个文件最多512 MB");
        return Upload.LIST_IGNORE;
      }
      return true;
    },
    customRequest: async ({ file, onSuccess, onError }) => {
      try {
        await onUpload(slot, file as File);
        onSuccess?.({});
      } catch (error) {
        onError?.(error as Error);
        message.error((error as Error).message);
      }
    },
  });
  const pointer = useRef({ x: 0, y: 0, tracking: false });
  if (!cards.length)
    return (
      <div
        className="video-result-carousel"
        role="region"
        aria-label="视频结果轮播"
      >
        <Empty description="暂无视频，可通过加号添加或生成视频" />
      </div>
    );
  return (
    <div
      className="video-result-carousel"
      role="region"
      aria-label="视频结果轮播"
      aria-roledescription="轮播"
      tabIndex={0}
      ref={root}
      onKeyDown={(event) => {
        if ((event.target as Element).closest("video, input, button")) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          go(index + (event.key === "ArrowLeft" ? -1 : 1));
        }
      }}
    >
      <div
        className="video-result-stage"
        onPointerDown={(event) => {
          pointer.current = {
            x: event.clientX,
            y: event.clientY,
            tracking:
              event.button === 0 &&
              !(event.target as Element).closest(
                "video, button, input, label, .ant-upload",
              ),
          };
        }}
        onPointerUp={(event) => {
          const dx = event.clientX - pointer.current.x,
            dy = event.clientY - pointer.current.y;
          if (
            pointer.current.tracking &&
            Math.abs(dx) > 45 &&
            Math.abs(dx) > Math.abs(dy)
          )
            go(index + (dx < 0 ? 1 : -1));
          pointer.current.tracking = false;
        }}
        onPointerCancel={() => {
          pointer.current.tracking = false;
        }}
      >
        {cards.map((card, position) => {
          const offset = position - index,
            active = offset === 0;
          return (
            <article
              key={card.id}
              className={`video-result-card ${active ? "is-active" : offset === -1 ? "is-previous" : offset === 1 ? "is-next" : "is-hidden"}${card.asset && selected.includes(card.id) ? " is-selected" : ""}${!card.asset ? " is-upload" : ""}`}
              data-video-id={card.id}
              aria-label={card.label}
              aria-hidden={!active}
              inert={!active}
            >
              <RemoveResultButton
                kind="video"
                disabled={disabled}
                onRemove={() => onRemove(card.id)}
              />
              <div className="video-result-preview">
                {card.asset ? (
                  <video
                    src={fileURL(card.id)}
                    controls={active}
                    muted={!active}
                    playsInline
                    preload="metadata"
                    aria-label={card.asset.name || card.label}
                  />
                ) : null}
              </div>
              {card.asset && (
                <div className="video-result-caption">
                  <span title={card.label}>{card.label}</span>
                  {card.model && <small>{card.model}</small>}
                </div>
              )}
              {card.asset && (
                <div className="media-output-actions">
                  <Checkbox
                    aria-label={`选用${card.asset.name || card.label}`}
                    disabled={disabled}
                    checked={selected.includes(card.id)}
                    onChange={(event) =>
                      onSelection(event.target.checked ? [card.id] : [])
                    }
                  >
                    选用
                  </Checkbox>
                  <div className="video-result-actions">
                    {card.slot !== undefined && (
                      <Upload {...uploadProps(card.slot)}>
                        <Button type="text" size="small" disabled={disabled}>
                          替换
                        </Button>
                      </Upload>
                    )}
                    <Button
                      type="text"
                      size="small"
                      icon={<DownloadOutlined />}
                      href={fileURL(card.id) + "?download=1"}
                      download={card.asset.name}
                    >
                      下载
                    </Button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
        <Button
          className="video-result-arrow is-left"
          type="text"
          shape="circle"
          icon={<LeftOutlined />}
          aria-label="上一个视频卡片"
          disabled={index === 0}
          onClick={() => go(index - 1)}
        />
        <Button
          className="video-result-arrow is-right"
          type="text"
          shape="circle"
          icon={<RightOutlined />}
          aria-label="下一个视频卡片"
          disabled={index === cards.length - 1}
          onClick={() => go(index + 1)}
        />
      </div>
      <div className="video-result-pagination" aria-label="视频卡片分页">
        {cards.map((card, position) => (
          <button
            type="button"
            key={card.id}
            aria-label={`切换到第${position + 1}个视频卡片`}
            aria-current={position === index ? "true" : undefined}
            onClick={() => go(position)}
          />
        ))}
      </div>
      <span className="video-result-position" aria-live="polite">
        {index + 1} / {cards.length}
      </span>
    </div>
  );
}
