import { useEffect, useRef, useState } from "react";
import { Alert, Button, Empty, Input, Select } from "antd";
import {
  MinusCircleOutlined,
  LeftOutlined,
  RightOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import type { Asset, Publication } from "../api";
import { fileURL } from "../api";

export default function PublicationDraftEditor({
  publication,
  assets,
  disabled,
  onChange,
}: {
  publication: Publication;
  assets: Asset[];
  disabled: boolean;
  onChange: (patch: Partial<Publication>) => void;
}) {
  const ids = publication.asset_ids;
  const [activeID, setActiveID] = useState(ids[0] || "");
  const [undo, setUndo] = useState<{
    ids: string[];
    cover?: string;
    active: string;
  } | null>(null);
  const index = Math.max(0, ids.indexOf(activeID));
  const id = ids[index];
  const asset = assets.find((a) => a.id === id);
  const video = (asset?.kind || publication.kind) === "video";
  const label = video ? "视频" : "图片";
  const player = useRef<HTMLVideoElement>(null);
  const thumbs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    player.current?.pause();
    const rail = thumbs.current;
    const button = rail?.children[index] as HTMLElement | undefined;
    if (rail && button)
      rail.scrollTo({
        left: Math.max(
          0,
          button.offsetLeft - rail.clientWidth + button.offsetWidth + 8,
        ),
        behavior: "smooth",
      });
  }, [id]);
  const go = (next: number) => {
    if (next >= 0 && next < ids.length) setActiveID(ids[next]);
  };
  const remove = () => {
    setUndo({ ids: [...ids], cover: publication.cover_id, active: id });
    const next = ids.filter((value) => value !== id);
    onChange({
      asset_ids: next,
      cover_id:
        publication.kind === "image" &&
        !next.includes(publication.cover_id || "")
          ? next[0] || ""
          : publication.cover_id,
    });
    setActiveID(next[Math.min(index, next.length - 1)] || "");
  };
  return (
    <article className="publication-content-preview publication-draft-editor">
      <section className="publication-editor-preview" aria-label="素材预览">
        <div className="publication-preview-label">
          <strong>内容预览</strong>
          <span>
            {ids.length ? `${index + 1} / ${ids.length}` : "暂无素材"}
          </span>
        </div>
        {ids.length ? (
          <div
            className={`publication-editor-media${video ? " is-video" : ""}${ids.length > 1 ? " has-thumbnails" : ""}`}
            role="region"
            aria-label="发布稿素材轮播"
            tabIndex={0}
            onKeyDown={(event) => {
              if ((event.target as Element).closest("button,video")) return;
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                go(index + (event.key === "ArrowLeft" ? -1 : 1));
              }
            }}
          >
            {!video && (
              <div
                className="publication-editor-backdrop"
                style={{ backgroundImage: `url("${fileURL(id)}")` }}
                aria-hidden="true"
              />
            )}
            {asset && asset.status !== "ready" ? (
              <Empty description="素材尚未就绪" />
            ) : video ? (
              <video
                key={id}
                ref={player}
                src={fileURL(id)}
                controls
                playsInline
                preload="metadata"
                aria-label={`发布视频 ${index + 1}`}
              />
            ) : (
              <img
                className="publication-editor-main-image"
                src={fileURL(id)}
                alt={`发布图片 ${index + 1}`}
              />
            )}
            {ids.length > 1 && (
              <>
                <Button
                  className="publication-editor-arrow is-left"
                  shape="circle"
                  icon={<LeftOutlined />}
                  aria-label="上一张发布素材"
                  disabled={index === 0}
                  onClick={() => go(index - 1)}
                />
                <Button
                  className="publication-editor-arrow is-right"
                  shape="circle"
                  icon={<RightOutlined />}
                  aria-label="下一张发布素材"
                  disabled={index === ids.length - 1}
                  onClick={() => go(index + 1)}
                />
              </>
            )}
          </div>
        ) : (
          <Empty description="此发布稿没有素材" />
        )}
        {ids.length > 1 && (
          <div
            className="publication-editor-thumbnails"
            ref={thumbs}
            aria-label="发布稿缩略图"
          >
            {ids.map((value, position) => (
              <button
                key={value}
                type="button"
                aria-label={`预览发布${label} ${position + 1}`}
                aria-current={position === index ? "true" : undefined}
                onClick={() => go(position)}
              >
                {publication.kind === "video" ? (
                  <video
                    src={fileURL(value)}
                    muted
                    preload="metadata"
                    aria-hidden="true"
                  />
                ) : (
                  <img src={fileURL(value)} alt="" />
                )}
              </button>
            ))}
          </div>
        )}
        <div className="publication-editor-media-actions">
          <Button
            size="small"
            type="text"
            className="publication-remove-action"
            icon={<MinusCircleOutlined />}
            aria-label={`移除当前${label}`}
            disabled={disabled || !ids.length}
            onClick={remove}
          >
            移除当前{label}
          </Button>
          {undo && (
            <Button
              size="small"
              type="text"
              icon={<UndoOutlined />}
              aria-label="撤销移除"
              disabled={disabled}
              onClick={() => {
                onChange({ asset_ids: undo.ids, cover_id: undo.cover });
                setActiveID(undo.active);
                setUndo(null);
              }}
            >
              撤销移除
            </Button>
          )}
        </div>
        {!ids.length && (
          <Alert
            type="warning"
            message="请保留至少一份素材后确认，可撤销刚才的移除。"
          />
        )}
      </section>
      <div className="publication-editor-fields">
        <strong className="publication-editor-fields-heading">发布内容</strong>
        <label>
          <span>标题</span>
          <Input
            aria-label="发布稿标题"
            value={publication.title}
            disabled={disabled}
            maxLength={publication.target_platform === "douyin" ? 200 : 20}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </label>
        <label>
          <span>正文</span>
          <Input.TextArea
            aria-label="发布稿正文"
            value={publication.body}
            disabled={disabled}
            autoSize={{ minRows: 6, maxRows: 10 }}
            maxLength={12000}
            onChange={(event) => onChange({ body: event.target.value })}
          />
        </label>
        <label>
          <span>话题</span>
          <Select
            aria-label="发布稿话题"
            mode="tags"
            value={publication.topics}
            disabled={disabled}
            onChange={(topics) => onChange({ topics })}
            tokenSeparators={[",", "，"]}
          />
        </label>
      </div>
    </article>
  );
}
