import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Image } from "antd";
import {
  FileImageOutlined,
  LeftOutlined,
  RightOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import type { Asset } from "../api";
import { fileURL } from "../api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import "./source-media-carousel.css";

export default function SourceMediaCarousel({
  assets,
  activeID,
  selectedIDs = [],
  disabled = false,
  kind = "image",
  previousLabel,
  nextLabel,
  onPreview,
  onToggle,
}: {
  assets: Asset[];
  activeID?: string;
  selectedIDs?: string[];
  disabled?: boolean;
  kind?: "image" | "video";
  previousLabel?: string;
  nextLabel?: string;
  onPreview?: (id: string) => void;
  onToggle?: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [visibleID, setVisibleID] = useState("");
  const [turn, setTurn] = useState<{
    from: Asset;
    direction: "next" | "previous";
  } | null>(null);
  const turning = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointer = useRef({ x: 0, y: 0, tracking: false, moved: false });
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const index = Math.max(
    0,
    assets.findIndex((asset) => asset.id === (activeID || visibleID)),
  );
  const current = assets[index];
  const video = (current?.kind || kind) === "video";
  const identity = assets.map((asset) => asset.id).join(",");
  const url = (asset: Asset) =>
    asset.status === "ready"
      ? fileURL(asset.id)
      : `/api/v1/assets/${asset.id}/preview`;
  useEffect(() => {
    for (const asset of [assets[index - 1], assets[index + 1]]) {
      if (asset?.kind === "image") {
        const preload = new window.Image();
        preload.decoding = "async";
        preload.src = url(asset);
      }
    }
  }, [identity, index]);
  const finish = () => {
    clearTimeout(timer.current);
    turning.current = false;
    setTurn(null);
  };
  useEffect(() => {
    finish();
    return () => clearTimeout(timer.current);
  }, [identity]);
  useEffect(() => {
    if (reducedMotion) finish();
  }, [reducedMotion]);
  const goTo = (position: number) => {
    if (
      turning.current ||
      position < 0 ||
      position >= assets.length ||
      position === index
    )
      return;
    const next = assets[position];
    root.current
      ?.querySelectorAll("video")
      .forEach((element) => element.pause());
    if (!reducedMotion && current?.kind === "image" && next.kind === "image") {
      turning.current = true;
      setTurn({
        from: current,
        direction: position > index ? "next" : "previous",
      });
      timer.current = setTimeout(finish, 700);
    }
    setVisibleID(next.id);
    onPreview?.(next.id);
  };
  return (
    <div
      className="title-original-media media-source-carousel"
      role="region"
      aria-roledescription="轮播"
      aria-label={`原始${video ? "视频" : "图片"}轮播`}
      tabIndex={0}
      aria-busy={!!turn}
      ref={root}
      onKeyDown={(event) => {
        if ((event.target as Element).closest("video, button, input")) return;
        if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
          event.preventDefault();
          goTo(index + (event.key === "ArrowLeft" ? -1 : 1));
        }
      }}
    >
      <div
        className="media-source-stage"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          pointer.current = {
            x: event.clientX,
            y: event.clientY,
            moved: false,
            tracking:
              !video &&
              !(event.target as Element).closest(
                "button, input, label, .ant-checkbox-wrapper",
              ),
          };
        }}
        onPointerMove={(event) => {
          if (!pointer.current.tracking || !event.buttons) return;
          const dx = event.clientX - pointer.current.x,
            dy = event.clientY - pointer.current.y;
          if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
            pointer.current.moved = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }}
        onPointerUp={(event) => {
          const dx = event.clientX - pointer.current.x;
          if (
            pointer.current.tracking &&
            pointer.current.moved &&
            Math.abs(dx) >= Math.min(48, event.currentTarget.clientWidth * 0.18)
          )
            goTo(index + (dx < 0 ? 1 : -1));
          pointer.current.tracking = false;
        }}
        onPointerCancel={() => {
          pointer.current.tracking = false;
          pointer.current.moved = false;
        }}
        onClickCapture={(event) => {
          if (pointer.current.moved && event.detail > 0) {
            event.preventDefault();
            event.stopPropagation();
            pointer.current.moved = false;
          }
        }}
      >
        {current ? (
          current.kind === "video" ? (
            <video
              key={current.id}
              src={url(current)}
              controls
              playsInline
              preload="metadata"
              aria-label="原始视频"
            />
          ) : (
            <Image
              src={url(current)}
              alt="原始图片"
              draggable={false}
              preview={turn ? false : { mask: null }}
            />
          )
        ) : (
          <div
            className="source-media-empty"
            role="img"
            aria-label={`暂无原始${video ? "视频" : "图片"}`}
          >
            {video ? <VideoCameraOutlined /> : <FileImageOutlined />}
          </div>
        )}
        {turn && (
          <div
            className={`source-book-page turn-${turn.direction}`}
            onAnimationEnd={finish}
            aria-hidden="true"
          >
            <div className="source-book-front">
              <img src={url(turn.from)} alt="" draggable={false} />
            </div>
            <div className="source-book-back" />
          </div>
        )}
      </div>
      {assets.length > 1 && (
        <>
          <Button
            type="text"
            shape="circle"
            className="source-page-button source-page-previous"
            aria-label={previousLabel || (video ? "上一个视频" : "上一张图片")}
            icon={<LeftOutlined />}
            disabled={!!turn || index === 0}
            onClick={() => goTo(index - 1)}
          />
          <Button
            type="text"
            shape="circle"
            className="source-page-button source-page-next"
            aria-label={nextLabel || (video ? "下一个视频" : "下一张图片")}
            icon={<RightOutlined />}
            disabled={!!turn || index === assets.length - 1}
            onClick={() => goTo(index + 1)}
          />
        </>
      )}
      {!!assets.length && (
        <span
          className="source-media-index"
          aria-live="polite"
          aria-label="素材序号"
        >
          {index + 1} / {assets.length}
        </span>
      )}
      {current && onToggle && (
        <div className="source-media-choice">
          <Checkbox
            aria-label={`参考${video ? "视频" : "图片"}${index + 1}`}
            disabled={disabled || !!turn}
            checked={selectedIDs.includes(current.id)}
            onChange={() => {
              setVisibleID(current.id);
              onPreview?.(current.id);
              onToggle(current.id);
            }}
          />
        </div>
      )}
    </div>
  );
}
