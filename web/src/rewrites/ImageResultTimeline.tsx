import { Button, Checkbox, Image } from "antd";
import { useRef, type ReactNode } from "react";
import {
  DownloadOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import type { Asset } from "../api";
import { fileURL } from "../api";
import ImageTimelineUpload from "./ImageTimelineUpload";
import RemoveResultButton from "./RemoveResultButton";
import "./image-result-timeline.css";

export type ImageTimelineEntry = {
  asset: Asset;
  createdAt: string;
  model?: string;
  label?: string;
};
const timestamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
};

export default function ImageResultTimeline({
  entries,
  selected,
  disabled,
  onSelection,
  uploadSlots,
  onUpload,
  addControl,
  onRemove,
}: {
  entries: ImageTimelineEntry[];
  selected: string[];
  disabled: boolean;
  onSelection: (ids: string[]) => void;
  uploadSlots: (Asset | undefined)[];
  onUpload: (index: number, file: File) => Promise<void>;
  addControl: ReactNode;
  onRemove: (id: string) => void;
}) {
  const track = useRef<HTMLOListElement>(null);
  const slide = (direction: number) =>
    track.current?.scrollBy({
      left: direction * track.current.clientWidth * 0.85,
      behavior: "smooth",
    });
  return (
    <div
      className="image-result-timeline"
      role="region"
      aria-label="图片生成时间线"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          slide(e.key === "ArrowRight" ? 1 : -1);
        }
      }}
    >
      <div className="image-results-navigation">
        <span>左右滑动查看图片</span>
        <div>
          <Button
            aria-label="上一组图片"
            icon={<LeftOutlined />}
            onClick={() => slide(-1)}
          />
          <Button
            aria-label="下一组图片"
            icon={<RightOutlined />}
            onClick={() => slide(1)}
          />
        </div>
      </div>
      <div className="image-results-layout">
        <ol ref={track} className="image-timeline-track">
          {uploadSlots
            .map((asset, index) => ({ asset, index }))
            .filter(({ asset }) => !!asset)
            .sort(
              (a, b) =>
                Number(!!a.asset) - Number(!!b.asset) || b.index - a.index,
            )
            .map(({ asset, index }) => (
              <li
                className="image-timeline-entry image-timeline-upload"
                key={`upload-${index}`}
              >
                <div className="image-timeline-date">
                  <span title={asset?.name}>
                    {asset?.name || `上传图片 ${index + 1}`}
                  </span>
                  {asset && (
                    <time dateTime={asset.created_at}>
                      {timestamp(asset.created_at || "")}
                    </time>
                  )}
                </div>
                <ImageTimelineUpload
                  index={index}
                  asset={asset}
                  selected={!!asset && selected.includes(asset.id)}
                  disabled={disabled}
                  onUpload={onUpload}
                  onRemove={() => asset && onRemove(asset.id)}
                  onSelect={(checked) =>
                    asset &&
                    onSelection(
                      checked
                        ? [...selected, asset.id]
                        : selected.filter((id) => id !== asset.id),
                    )
                  }
                />
              </li>
            ))}
          {entries
            .filter(
              ({ asset }) => !uploadSlots.some((slot) => slot?.id === asset.id),
            )
            .map(({ asset, createdAt, model, label }) => (
              <li className="image-timeline-entry" key={asset.id}>
                <div className="image-timeline-date">
                  {label && <span title={label}>{label}</span>}
                  <time dateTime={createdAt || undefined}>
                    {timestamp(createdAt)}
                  </time>
                  {model && <small>{model}</small>}
                </div>
                <article
                  className={`media-output-card${selected.includes(asset.id) ? " is-selected" : ""}`}
                  data-result-id={asset.id}
                >
                  <RemoveResultButton
                    kind="image"
                    disabled={disabled}
                    onRemove={() => onRemove(asset.id)}
                  />
                  <div
                    className="media-output-preview"
                    style={{
                      aspectRatio:
                        asset.width && asset.height
                          ? `${asset.width} / ${asset.height}`
                          : undefined,
                    }}
                  >
                    <Image
                      loading="lazy"
                      src={fileURL(asset.id)}
                      alt={asset.name || "生成的图片"}
                    />
                  </div>
                  <div className="media-output-actions">
                    <Checkbox
                      aria-label={`选用${asset.name || "图片"}`}
                      checked={selected.includes(asset.id)}
                      disabled={disabled}
                      onChange={(event) =>
                        onSelection(
                          event.target.checked
                            ? [...selected, asset.id]
                            : selected.filter((id) => id !== asset.id),
                        )
                      }
                    >
                      选用
                    </Checkbox>
                    <Button
                      type="text"
                      icon={<DownloadOutlined />}
                      href={fileURL(asset.id) + "?download=1"}
                      download={asset.name}
                    >
                      下载
                    </Button>
                  </div>
                </article>
              </li>
            ))}
        </ol>
        <div className="image-results-add">{addControl}</div>
      </div>
    </div>
  );
}
