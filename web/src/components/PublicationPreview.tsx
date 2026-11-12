import { useEffect, useRef, useState } from "react";
import { Button, Empty, Image, Tag } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { fileURL } from "../api";
import type { Asset, Publication } from "../api";

export default function PublicationPreview({
  publication,
  assets,
}: {
  publication: Pick<
    Publication,
    "id" | "title" | "body" | "topics" | "asset_ids" | "kind"
  >;
  assets: Asset[];
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const ids = publication.asset_ids;
  useEffect(() => {
    setIndex(0);
    rail.current?.scrollTo({ left: 0 });
  }, [publication.id, ids.join(",")]);
  const move = (i: number) => {
    const el = rail.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  return (
    <article className="publication-content-preview">
      <div className="publication-preview-label">
        <strong>内容预览</strong>
        <span>{ids.length ? `${index + 1} / ${ids.length}` : "暂无素材"}</span>
      </div>
      {ids.length ? (
        <>
          <div
            className="publication-preview-rail"
            ref={rail}
            onScroll={(e) => {
              const el = e.currentTarget;
              setIndex(
                Math.min(
                  ids.length - 1,
                  Math.max(
                    0,
                    Math.round(el.scrollLeft / Math.max(1, el.clientWidth)),
                  ),
                ),
              );
              el.querySelectorAll("video").forEach((v) => {
                if (
                  v.parentElement &&
                  Math.abs(v.parentElement.offsetLeft - el.scrollLeft) >
                    el.clientWidth / 2
                )
                  v.pause();
              });
            }}
          >
            {ids.map((id, i) => {
              const asset = assets.find((a) => a.id === id);
              const video =
                asset?.kind === "video" ||
                (!asset && publication.kind === "video");
              return (
                <div className="publication-preview-slide" key={id}>
                  {asset && asset.status !== "ready" ? (
                    <Empty description="素材尚未就绪" />
                  ) : video ? (
                    <video
                      controls
                      playsInline
                      preload="metadata"
                      src={fileURL(id)}
                      aria-label={`发布视频 ${i + 1}`}
                    />
                  ) : (
                    <Image src={fileURL(id)} alt={`发布图片 ${i + 1}`} />
                  )}
                </div>
              );
            })}
          </div>
          {ids.length > 1 && (
            <div className="publication-preview-navigation">
              <Button
                aria-label="上一张发布素材"
                icon={<LeftOutlined />}
                disabled={!index}
                onClick={() => move(index - 1)}
              />
              <span>
                {index + 1} / {ids.length}
              </span>
              <Button
                aria-label="下一张发布素材"
                icon={<RightOutlined />}
                disabled={index >= ids.length - 1}
                onClick={() => move(index + 1)}
              />
            </div>
          )}
        </>
      ) : (
        <Empty description="此发布稿没有素材" />
      )}
      <div
        className="publication-preview-copy"
        tabIndex={0}
        role="region"
        aria-label="发布文案"
      >
        <h2>{publication.title}</h2>
        <p>{publication.body}</p>
        <div className="publication-preview-topics">
          {(publication.topics || []).map((t) => (
            <Tag key={t}>#{t.replace(/^#+/, "")}</Tag>
          ))}
        </div>
      </div>
    </article>
  );
}
