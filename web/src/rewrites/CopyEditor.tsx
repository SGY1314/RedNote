import { Input, Select } from "antd";
import type { ReactNode } from "react";
import type { Content } from "../api";
export default function CopyEditor({
  content,
  onChange,
  disabled,
  children,
}: {
  content: Content;
  onChange: (content: Content) => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <div className="content-editor">
      <div className="draft-editor-heading">
        <strong>我的创作文案</strong>
        <small>
          在这里编辑标题、正文与话题，草稿自动同步；确认后的完整版本用于发布。
        </small>
      </div>
      <label>
        标题
        <Input
          aria-label="创作标题"
          disabled={disabled}
          placeholder="为这篇内容写一个标题"
          value={content.title}
          showCount
          maxLength={200}
          onChange={(e) => onChange({ ...content, title: e.target.value })}
        />
      </label>
      <label>
        正文
        <Input.TextArea
          aria-label="创作正文"
          disabled={disabled}
          placeholder="好的表达，从真实的想法开始…"
          value={content.body}
          onChange={(e) => onChange({ ...content, body: e.target.value })}
          autoSize={{ minRows: 10, maxRows: 24 }}
          showCount
        />
      </label>
      <label>
        话题
        <Select
          mode="tags"
          disabled={disabled}
          tokenSeparators={["，", ",", " "]}
          value={content.topics}
          placeholder="输入话题后按回车"
          onChange={(topics) => onChange({ ...content, topics })}
          style={{ width: "100%" }}
        />
      </label>
      {children}
    </div>
  );
}
