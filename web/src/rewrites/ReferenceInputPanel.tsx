import { useState } from "react";
import { Button, Checkbox, Input, Select, App } from "antd";
import { api, type Asset } from "../api";
import SourceMediaCarousel from "./SourceMediaCarousel";
import ReferenceMediaPicker from "../ReferenceMediaPicker";
import "./reference-input.css";
export type ReferenceInput = {
  policy_version?: number;
  title_source?: "original" | "rewritten";
  body_source?: "original" | "rewritten";
  title: string;
  body: string;
  topics: string[];
  use_title: boolean;
  use_body: boolean;
  use_images: boolean;
  asset_ids: string[];
};
export default function ReferenceInputPanel({
  value,
  assets,
  sourceAssets,
  projectID,
  disabled,
  onChange,
  onUploaded,
  titleRewritten = false,
  bodyRewritten = false,
}: {
  value: ReferenceInput;
  assets: Asset[];
  sourceAssets: Asset[];
  projectID: string;
  disabled: boolean;
  onChange: (v: ReferenceInput) => void;
  onUploaded: (a: Asset) => void;
  titleRewritten?: boolean;
  bodyRewritten?: boolean;
}) {
  const [active, setActive] = useState("");
  const [uploading, setUploading] = useState(false);
  const { message } = App.useApp();
  const images = [
    ...new Map(
      [...sourceAssets, ...assets.filter((a) => value.asset_ids.includes(a.id))]
        .filter(
          (a) => a.kind === "image" && a.status === "ready" && !a.deleted_at,
        )
        .map((a) => [a.id, a]),
    ).values(),
  ];
  const patch = (v: Partial<ReferenceInput>) => onChange({ ...value, ...v });
  return (
    <section className="reference-input-panel" aria-label="参考内容">
      <div className="reference-input-columns">
        <div className={value.use_images ? "" : "reference-input-inactive"}>
          <Checkbox
            disabled={disabled}
            checked={value.use_images}
            onChange={(e) => patch({ use_images: e.target.checked })}
          >
            参考图片
          </Checkbox>
          <SourceMediaCarousel
            assets={images}
            activeID={active}
            selectedIDs={value.use_images ? value.asset_ids : []}
            disabled={disabled || !value.use_images}
            onPreview={setActive}
            onToggle={(id) =>
              patch({
                asset_ids: value.asset_ids.includes(id)
                  ? value.asset_ids.filter((x) => x !== id)
                  : [...value.asset_ids, id],
              })
            }
          />
          <div className="reference-input-actions">
            <ReferenceMediaPicker
              assets={assets}
              selected={value.asset_ids}
              disabled={disabled || !value.use_images}
              imagesOnly
              maxCount={10}
              onChange={(ids) => patch({ asset_ids: ids })}
            />
            <label>
              <Button
                disabled={disabled || uploading || !value.use_images}
                loading={uploading}
                onClick={(e) =>
                  e.currentTarget.parentElement?.querySelector("input")?.click()
                }
              >
                上传图片
              </Button>
              <input
                hidden
                type="file"
                accept="image/*"
                disabled={disabled || uploading || !value.use_images}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploading(true);
                  try {
                    const data = new FormData();
                    data.append("file", file);
                    data.append("project_id", projectID);
                    const a = await api<Asset>("/assets", {
                      method: "POST",
                      body: data,
                    });
                    onUploaded(a);
                    patch({ asset_ids: [...value.asset_ids, a.id] });
                  } catch (e) {
                    message.error((e as Error).message);
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>
          </div>
        </div>
        <div className="reference-input-text">
          <div className={value.use_title ? "" : "reference-input-inactive"}>
            <Checkbox
              checked={value.use_title}
              disabled={disabled}
              onChange={(e) => patch({ use_title: e.target.checked })}
            >
              {(
                value.title_source
                  ? value.title_source === "rewritten"
                  : titleRewritten
              )
                ? "仿写后的标题"
                : "原标题"}
            </Checkbox>
            <Input
              aria-label="参考标题"
              placeholder="勾选后可手动输入参考标题"
              maxLength={200}
              disabled={disabled || !value.use_title}
              value={value.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </div>
          <div className={value.use_body ? "" : "reference-input-inactive"}>
            <Checkbox
              checked={value.use_body}
              disabled={disabled}
              onChange={(e) => patch({ use_body: e.target.checked })}
            >
              {(
                value.body_source
                  ? value.body_source === "rewritten"
                  : bodyRewritten
              )
                ? "仿写后的文案"
                : "原文案"}
            </Checkbox>
            <Input.TextArea
              aria-label="参考文案"
              placeholder="勾选后可手动输入参考文案"
              maxLength={12000}
              disabled={disabled || !value.use_body}
              autoSize={{ minRows: 6, maxRows: 12 }}
              value={value.body}
              onChange={(e) => patch({ body: e.target.value })}
            />
          </div>
          <label>
            <span>标签</span>
            <Select
              aria-label="标签"
              mode="tags"
              tokenSeparators={[" ", "，", ","]}
              disabled={disabled || !value.use_body}
              value={value.topics}
              maxCount={30}
              maxTagTextLength={80}
              onChange={(topics) =>
                patch({
                  topics: topics
                    .map((t: string) => t.trim().replace(/^#+/, ""))
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
      </div>
    </section>
  );
}
