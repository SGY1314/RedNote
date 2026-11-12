import { Image, Space, Tag } from "antd";
import type { Asset, Version } from "./api";
import { fileURL } from "./api";

export default function VersionMedia({
  version,
  assets,
}: {
  version: Version;
  assets: Asset[];
}) {
  const media = version.media;
  if (!media)
    return (
      <p className="muted">
        此历史版本未记录配图，请选好图片后保存为新版本再对比。
      </p>
    );
  const ids =
    media.kind === "image"
      ? media.asset_ids
      : media.cover_id
        ? [media.cover_id]
        : [];
  return (
    <section
      aria-label={`V${version.number} 的配图`}
      style={{ margin: "16px 0" }}
    >
      <strong>
        {media.kind === "video" ? "视频封面" : `版本配图（${ids.length} 张）`}
      </strong>
      {!ids.length && (
        <p className="muted">
          此版本保存时未选择{media.kind === "video" ? "封面" : "图片"}。
        </p>
      )}
      <Image.PreviewGroup>
        {media.kind === "image" && media.cover_id && (
          <div style={{ marginTop: 10 }}>
            <p>指定封面</p>
            <Image
              src={fileURL(media.cover_id)}
              alt="版本封面"
              width={120}
              height={140}
              style={{ objectFit: "contain" }}
            />
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 12,
            marginTop: 10,
          }}
        >
          {ids.map((id, i) => {
            const asset = assets.find((a) => a.id === id);
            return (
              <div key={id} style={{ minWidth: 0 }}>
                <Image
                  src={fileURL(id)}
                  alt={`第 ${i + 1} 张：${asset?.name || "版本图片"}`}
                  width="100%"
                  height={160}
                  style={{ objectFit: "contain", background: "#f5f7fa" }}
                />
                <Space wrap size={4}>
                  <Tag>{i + 1}</Tag>
                  <small>{asset?.name || "版本图片"}</small>
                  {asset?.deleted_at && <Tag>素材回收站</Tag>}
                </Space>
              </div>
            );
          })}
        </div>
      </Image.PreviewGroup>
      {media.kind === "video" &&
        media.asset_ids.map((id) => (
          <video
            key={id}
            src={fileURL(id)}
            controls
            preload="metadata"
            style={{ width: "100%", maxHeight: 260, marginTop: 10 }}
          />
        ))}
    </section>
  );
}
