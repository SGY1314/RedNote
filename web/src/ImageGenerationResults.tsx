import { Alert, Button, Image, Space, Tag } from "antd";
import type { Asset, Job } from "./api";
import { fileURL, stateColor, stateLabel } from "./api";
import SaveToLibrary from "./SaveToLibrary";

export default function ImageGenerationResults({
  jobs,
  assets,
  selected,
  disabled,
  canAdd,
  onAdd,
  onRemove,
  onAddMany,
  refresh,
}: {
  refresh: () => Promise<void>;
  jobs: Job[];
  assets: Asset[];
  selected: string[];
  disabled: boolean;
  canAdd: boolean;
  onAdd: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onAddMany: (ids: string[]) => Promise<void>;
}) {
  return (
    <>
      {jobs.map((j) => {
        const series = j.payload?.series;
        const ids = series?.asset_ids || [j.result || j.id];
        const ready = ids.filter((id) =>
          assets.some(
            (a) => a.id === id && a.status === "ready" && !a.deleted_at,
          ),
        );
        return (
          <div
            key={j.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 12,
            }}
          >
            <Tag color={stateColor[j.state]}>
              {stateLabel[j.state] || j.state}
            </Tag>
            {series && (
              <Tag>
                连续画面 · {(series.completed || []).length}/{ids.length} 张
              </Tag>
            )}
            <small>{j.stage}</small>
            {j.error && (
              <Alert
                type="error"
                message={j.error}
                description="可在「后台任务」核实并手动重试。已保存图片会复用，结果不明的请求重试可能再次计费。"
                style={{ marginTop: 8 }}
              />
            )}
            {series && (
              <Button
                style={{ marginTop: 12 }}
                disabled={
                  disabled ||
                  !canAdd ||
                  !ready.length ||
                  ready.every((id) => selected.includes(id))
                }
                onClick={() => onAddMany(ready)}
              >
                {ready.length > 0 && ready.every((id) => selected.includes(id))
                  ? "已加入当前版本"
                  : ready.length === ids.length
                    ? "追加整组图片"
                    : "追加已完成图片"}
              </Button>
            )}
            <Image.PreviewGroup>
              {ids.map((id, i) => {
                const asset = assets.find((a) => a.id === id && !a.deleted_at);
                return (
                  <div key={id} style={{ marginTop: 16 }}>
                    {series && (
                      <>
                        <strong>第 {i + 1} 张</strong>
                        <p className="muted">{series.scenes[i]}</p>
                      </>
                    )}
                    {asset ? (
                      <>
                        <div style={{ margin: "12px 0" }}>
                          <Image src={fileURL(id)} width={220} />
                        </div>
                        <Space wrap>
                          <span>{asset.name}</span>
                          <SaveToLibrary
                            asset={asset}
                            refresh={refresh}
                            disabled={disabled}
                          />
                          <span>
                            {asset.width} × {asset.height}
                          </span>
                          <Button
                            disabled={
                              disabled || !canAdd || asset.status !== "ready"
                            }
                            onClick={() =>
                              selected.includes(id) ? onRemove(id) : onAdd(id)
                            }
                          >
                            {selected.includes(id)
                              ? "取消加入发布素材"
                              : "加入发布素材"}
                          </Button>
                        </Space>
                      </>
                    ) : (
                      <p className="muted">
                        {series?.completed?.includes(id) ||
                        j.state === "succeeded"
                          ? "图片已保存；若已移入素材回收站，请先恢复。"
                          : ["failed", "blocked", "needs_review"].includes(
                                j.state,
                              )
                            ? "此张尚未完成"
                            : "等待生成并保存图片"}
                      </p>
                    )}
                  </div>
                );
              })}
            </Image.PreviewGroup>
            {!canAdd && (
              <p className="muted">
                请切换到图文模式后加入；也可在视频模式的封面列表选择图片。
              </p>
            )}
            {series && (
              <p className="muted">
                加入后点击「保存完整版本」，将这组图片与当前文案一起保存。
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
