import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  FileImageOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Asset, Note } from "../api";

export default function CollectionCardCarousel({
  note,
  media,
  previewURL,
  renderAsset,
  showDots = true,
}: {
  note: Note;
  media: Asset[];
  previewURL: (asset: Asset) => string;
  renderAsset?: (asset: Asset) => ReactNode;
  showDots?: boolean;
}) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const gesture = useRef({ x: 0, y: 0, moved: false, tracking: false });
  const [active, setActive] = useState(0);
  const pageCount = Math.max(1, media.length);
  const activeMedia = media[active];
  const ratio =
    activeMedia?.width > 0 && activeMedia?.height > 0
      ? Math.min(
          16 / 9,
          Math.max(3 / 4, activeMedia.width / activeMedia.height),
        )
      : 4 / 3;

  useEffect(() => {
    setActive(0);
    pagesRef.current?.scrollTo({ left: 0 });
  }, [note.id, media.length]);

  useEffect(() => {
    const element = pagesRef.current;
    if (!element) return;
    element.querySelectorAll("video").forEach((video) => {
      const page = video.closest(".collection-card-page");
      if (page !== element.children[active]) video.pause();
    });
  }, [active]);

  useEffect(() => {
    const element = pagesRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const index = Number(element.dataset.active || 0);
      element.scrollTo({
        left: index * element.clientWidth,
        behavior: "instant",
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const goTo = (index: number) => {
    const element = pagesRef.current;
    if (!element) return;
    const next = Math.max(0, Math.min(pageCount - 1, index));
    element.scrollTo({ left: next * element.clientWidth, behavior: "smooth" });
    setActive(next);
  };

  const onScroll = () => {
    const element = pagesRef.current;
    if (!element) return;
    const next = Math.max(
      0,
      Math.min(
        pageCount - 1,
        Math.round(element.scrollLeft / Math.max(1, element.clientWidth)),
      ),
    );
    setActive(next);
  };

  return (
    <div
      className={
        "collection-card-preview" +
        (renderAsset ? " collection-detail-carousel" : "") +
        (media[active]?.kind === "video" ? " is-video-page" : "")
      }
      style={renderAsset ? undefined : { aspectRatio: ratio }}
      onPointerDownCapture={(event) => {
        gesture.current = {
          x: event.clientX,
          y: event.clientY,
          moved: false,
          tracking: !(event.target as Element).closest(
            "video, button, input, a, .ant-checkbox-wrapper",
          ),
        };
      }}
      onPointerMoveCapture={(event) => {
        if (!event.buttons || !gesture.current.tracking) return;
        if (
          Math.abs(event.clientX - gesture.current.x) > 8 ||
          Math.abs(event.clientY - gesture.current.y) > 8
        )
          gesture.current.moved = true;
      }}
      onClickCapture={(event) => {
        if (event.detail > 0 && gesture.current.moved) {
          event.preventDefault();
          event.stopPropagation();
          gesture.current.moved = false;
        }
      }}
    >
      <div
        className="collection-card-pages"
        ref={pagesRef}
        data-active={active}
        onScroll={onScroll}
        aria-label="笔记媒体轮播"
      >
        {media.length ? (
          media.map((asset) => (
            <div className="collection-card-page" key={asset.id}>
              {renderAsset ? (
                renderAsset(asset)
              ) : asset.kind === "video" ? (
                <video
                  controls
                  playsInline
                  preload="metadata"
                  src={previewURL(asset)}
                  aria-label={asset.name || "笔记视频"}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              ) : (
                <img
                  src={previewURL(asset)}
                  alt={note.title || "笔记预览"}
                  loading="lazy"
                />
              )}
            </div>
          ))
        ) : (
          <div className="collection-card-page">
            <div className="collection-card-paper">
              <strong>{note.title || "等待采集元数据"}</strong>
              <p>
                {note.tags?.length
                  ? note.tags
                      .slice(0, 4)
                      .map((tag) => `#${tag}`)
                      .join(" ")
                  : "等待采集元数据"}
              </p>
              <span className="collection-card-paper-icon">
                {note.kind === "video" ? (
                  <VideoCameraOutlined />
                ) : (
                  <FileImageOutlined />
                )}
              </span>
            </div>
          </div>
        )}
      </div>
      <span className="collection-card-index">
        {active + 1}/{pageCount}
      </span>
      {pageCount > 1 && (
        <div className="collection-card-page-controls">
          <button
            type="button"
            className="collection-card-page-control"
            aria-label="上一页"
            disabled={active === 0}
            onClick={(event) => {
              event.stopPropagation();
              goTo(active - 1);
            }}
          >
            <ArrowLeftOutlined />
          </button>
          <button
            type="button"
            className="collection-card-page-control"
            aria-label="下一页"
            disabled={active === pageCount - 1}
            onClick={(event) => {
              event.stopPropagation();
              goTo(active + 1);
            }}
          >
            <ArrowRightOutlined />
          </button>
        </div>
      )}
      {showDots && pageCount > 1 && (
        <div className="collection-card-dots" aria-label="笔记分页">
          {Array.from({ length: Math.min(10, pageCount) }).map((_, index) => (
            <button
              type="button"
              key={index}
              className={index === active ? "active" : ""}
              aria-label={`第 ${index + 1} 页`}
              onClick={(event) => {
                event.stopPropagation();
                goTo(index);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
