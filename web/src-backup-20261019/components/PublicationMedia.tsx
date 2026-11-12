import { HolderOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Image } from "antd";
import { useRef, useState } from "react";
import type { Asset } from "../api";
import { fileURL } from "../api";
import { publicationSelection } from "../publicationSelection";

export default function PublicationMedia({
  assets,
  selected,
  kind,
  disabled,
  onChange,
  onOpen,
}: {
  assets: Asset[];
  selected: string[];
  kind: string;
  disabled: boolean;
  onChange: (ids: string[]) => Promise<boolean>;
  onOpen: () => void;
}) {
  const dragged = useRef("");
  const [dragging, setDragging] = useState("");
  const [over, setOver] = useState("");
  const { available: ordered, ids, unavailable } = publicationSelection(
    assets,
    selected,
    kind,
  );
  const reorder = async (id: string, target: string) => {
    if (
      disabled ||
      id === target ||
      !ids.includes(id) ||
      !ids.includes(target) ||
      unavailable.length
    )
      return;
    const next = ids.filter((value) => value !== id);
    next.splice(ids.indexOf(target), 0, id);
    await onChange(next);
  };
  const clearDrag = () => {
    dragged.current = "";
    setDragging("");
    setOver("");
  };
  return (
    <>
      {unavailable.length > 0 && (
        <Alert
          className="publication-media-warning"
          type="warning"
          showIcon
          message={`${unavailable.length} 份已选素材不可用，请移除后重新选择`}
          action={
            <Button
              size="small"
              disabled={disabled}
              onClick={() => void onChange(ids)}
            >
              移除不可用素材
            </Button>
          }
        />
      )}
      <div className="publication-media-grid">
        {ordered.map((asset) => {
          const checked = ids.includes(asset.id);
          return (
            <article
              key={asset.id}
              data-asset-id={asset.id}
              className={`publication-media-tile${dragging === asset.id ? " is-dragging" : ""}${over === asset.id ? " is-drop-target" : ""}`}
              onDragOver={(e) => {
                if (!disabled && dragged.current && checked) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOver(asset.id);
                }
              }}
              onDragLeave={() => setOver("")}
              onDrop={(e) => {
                e.preventDefault();
                void reorder(dragged.current, asset.id);
                clearDrag();
              }}
            >
              {asset.kind === "image" ? (
                <Image
                  src={fileURL(asset.id)}
                  alt={asset.name}
                  width="100%"
                  preview={{ mask: false }}
                />
              ) : (
                <video
                  src={fileURL(asset.id)}
                  controls
                  preload="metadata"
                  aria-label={asset.name}
                  style={{
                    aspectRatio:
                      asset.width && asset.height
                        ? `${asset.width}/${asset.height}`
                        : undefined,
                  }}
                />
              )}
              {checked && (
                <span
                  className="publication-media-position"
                  aria-label={`发布顺序 ${ids.indexOf(asset.id) + 1}`}
                >
                  {ids.indexOf(asset.id) + 1}
                </span>
              )}
              {checked && (
                <button
                  className="media-float-button media-drag-handle"
                  draggable={!disabled && !unavailable.length}
                  disabled={disabled || !!unavailable.length}
                  aria-label={`拖拽排序 ${asset.name}`}
                  title="调整顺序"
                  onDragStart={(e) => {
                    if (disabled) {
                      e.preventDefault();
                      return;
                    }
                    dragged.current = asset.id;
                    setDragging(asset.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", asset.id);
                  }}
                  onDragEnd={clearDrag}
                  onKeyDown={(e) => {
                    if (
                      !e.altKey ||
                      ![
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(e.key)
                    )
                      return;
                    e.preventDefault();
                    const target =
                      ids[
                        ids.indexOf(asset.id) +
                          (["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1)
                      ];
                    if (target) void reorder(asset.id, target);
                  }}
                >
                  <HolderOutlined />
                </button>
              )}
              <Checkbox
                className="media-round-select"
                aria-label={`选择 ${asset.name}`}
                checked={checked}
                disabled={disabled}
                onChange={(e) =>
                  void onChange(
                    e.target.checked
                      ? kind === "video"
                        ? [asset.id]
                        : [...new Set([...selected, asset.id])]
                      : [...new Set(selected)].filter((id) => id !== asset.id),
                  )
                }
              />
            </article>
          );
        })}
        <button className="add-material" disabled={disabled} onClick={onOpen}>
          <PlusOutlined />
          <strong>添加素材</strong>
        </button>
      </div>
    </>
  );
}
