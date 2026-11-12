import { CloseOutlined } from "@ant-design/icons";
import { Rate, Select } from "antd";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Note } from "../api";
import { patch } from "../api";

export const suggestedNoteTags = [
  "高粉",
  "高赞",
  "高收藏",
  "优质文案",
  "值得仿写",
];
export default function NoteCuration({
  note,
  tags,
  onSaved,
  disabled = false,
  compact = false,
  action,
  onDeleteTag,
}: {
  note: Note;
  tags: string[];
  onSaved: (note: Note) => void;
  disabled?: boolean;
  compact?: boolean;
  action?: ReactNode;
  onDeleteTag?: (tag: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [rating, setRating] = useState(note.rating || 0);
  const [labels, setLabels] = useState(note.tags || []);
  useEffect(() => {
    setRating(note.rating || 0);
    setLabels(note.tags || []);
  }, [note.id, note.rating, note.tags]);
  const save = async (value: { rating?: number; tags?: string[] }) => {
    if (saving || disabled) return;
    if (
      value.tags &&
      (value.tags.length > 20 ||
        value.tags.some((t) => Array.from(t).length > 40))
    ) {
      setLabels(note.tags || []);
      setStatus("最多 20 个标签，每个不超过 40 字");
      return;
    }
    setSaving(true);
    setStatus("保存中…");
    try {
      const saved = await patch<Note>("/collections/" + note.id, value);
      onSaved(saved);
      setStatus("已保存");
    } catch (error) {
      setRating(note.rating || 0);
      setLabels(note.tags || []);
      setStatus((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className={`note-curation${compact ? " note-curation-compact" : ""}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="note-rating" role="group" aria-label="个人评分">
        <Rate
          value={rating}
          count={5}
          allowClear
          disabled={saving || disabled}
          onChange={(value) => {
            setRating(value);
            void save({ rating: value });
          }}
        />
        <small role="status" aria-live="polite">
          {status}
        </small>
      </div>
      <div className="note-curation-controls">
        <Select
          size={compact ? "small" : "middle"}
          aria-label="个人分类标签"
          mode="tags"
          value={labels}
          disabled={saving || disabled}
          placeholder="打标签"
          maxTagCount="responsive"
          options={[...new Set([...suggestedNoteTags, ...tags, ...labels])].map(
            (value) => ({ value, label: value }),
          )}
          optionRender={(option) => (
            <div className="note-tag-option">
              <span>{option.label}</span>
              {onDeleteTag &&
                !suggestedNoteTags.includes(String(option.value)) && (
                  <button
                    type="button"
                    aria-label={`删除标签 ${option.value}`}
                    disabled={saving || disabled}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDeleteTag(String(option.value));
                    }}
                  >
                    <CloseOutlined />
                  </button>
                )}
            </div>
          )}
          onChange={(value) => {
            setLabels(value);
            void save({ tags: value });
          }}
        />
        {action}
      </div>
    </div>
  );
}
