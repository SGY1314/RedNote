import {
  App,
  Button,
  Checkbox,
  Image,
  Input,
  Modal,
  Select,
  Space,
} from "antd";
import { useState } from "react";
import type { Asset } from "./api";
import { fileURL } from "./api";
import { inMediaLibrary } from "./assetLibrary";

export default function ReferenceMediaPicker({
  assets,
  selected,
  disabled,
  onChange,
  imagesOnly = false,
  maxCount = 7,
}: {
  assets: Asset[];
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
  imagesOnly?: boolean;
  maxCount?: number;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [ids, setIDs] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const available = assets.filter(
    (a) =>
      inMediaLibrary(a) &&
      a.status === "ready" &&
      !a.deleted_at &&
      (imagesOnly ? a.kind === "image" : ["image", "video"].includes(a.kind)),
  );
  const limitMessage = imagesOnly
    ? `本次最多选择 ${maxCount} 张参考图片`
    : `最多选择 ${maxCount} 份参考素材，其中视频最多 2 份`;
  const exceedsLimit = (next: string[]) =>
    next.length > maxCount ||
    (!imagesOnly &&
      available.filter((a) => next.includes(a.id) && a.kind === "video")
        .length > 2);
  const toggle = (id: string, checked: boolean) => {
    const next = checked
      ? [...new Set([...ids, id])]
      : ids.filter((v) => v !== id);
    if (checked && exceedsLimit(next)) {
      message.warning(limitMessage);
      return;
    }
    setIDs(next);
  };
  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => {
          setIDs(
            [...new Set(selected)].filter((id) =>
              available.some((a) => a.id === id),
            ),
          );
          setOpen(true);
        }}
      >
        从素材库选择
      </Button>
      <Modal
        title={
          imagesOnly ? "从素材库选择参考图片" : "从素材库选择参考图片和视频"
        }
        open={open}
        width={860}
        onCancel={() => setOpen(false)}
        okText="确定参考素材"
        okButtonProps={{ disabled }}
        onOk={() => {
          if (disabled) return;
          const next = [...new Set(ids)].filter((id) =>
            available.some((a) => a.id === id),
          );
          if (exceedsLimit(next)) {
            message.warning(limitMessage);
            return;
          }
          onChange(next);
          setOpen(false);
        }}
      >
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="搜索素材名称或分类"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!imagesOnly && (
            <Select
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: "全部素材" },
                { value: "image", label: "图片" },
                { value: "video", label: "视频" },
              ]}
            />
          )}
          <span>
            已选 {ids.length} / {maxCount}
            {imagesOnly ? " 张图片" : "，视频最多 2 份"}
          </span>
        </Space>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
            gap: 16,
            maxHeight: 480,
            overflowY: "auto",
          }}
        >
          {available
            .filter(
              (a) =>
                (imagesOnly || kind === "all" || a.kind === kind) &&
                `${a.name} ${a.category || ""}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
            )
            .map((a) => (
              <div
                key={a.id}
                style={{
                  border: "1px solid #e2e7f1",
                  padding: 10,
                  borderRadius: 8,
                }}
              >
                {a.kind === "image" ? (
                  <Image
                    src={fileURL(a.id)}
                    alt={a.name}
                    height={130}
                    width="100%"
                    style={{ objectFit: "contain" }}
                  />
                ) : (
                  <video
                    src={fileURL(a.id)}
                    controls
                    preload="metadata"
                    style={{ width: "100%", height: 130 }}
                  />
                )}
                <Checkbox
                  disabled={disabled}
                  checked={ids.includes(a.id)}
                  onChange={(e) => toggle(a.id, e.target.checked)}
                >
                  {a.name}
                </Checkbox>
              </div>
            ))}
        </div>
        {!available.length && (
          <p>
            素材库暂无可用{imagesOnly ? "图片" : "图片或视频"}
            ，请先到「素材库」上传或采集素材。
          </p>
        )}
      </Modal>
    </>
  );
}
