import { useEffect, useState } from "react";
import { Button, Input, Select } from "antd";
import {
  CheckCircleFilled,
  CheckCircleOutlined,
  CheckOutlined,
  DownOutlined,
  UpOutlined,
} from "@ant-design/icons";
import "./copy-letter.css";

export default function CopyLetter({
  original,
  originalLabel = "原始文案",
  candidates,
  selectedIndex,
  text,
  topics,
  disabled,
  onSelect,
  onOriginal,
  onText,
  onTopics,
}: {
  original: { body: string; topics: string[] };
  originalLabel?: string;
  candidates: { body: string; topics: string[] }[];
  selectedIndex: number;
  text: string;
  topics: string[];
  disabled: boolean;
  onSelect: (index: number | null) => void;
  onOriginal: () => void;
  onText: (index: number, text: string) => void;
  onTopics: (index: number, topics: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewIndex, setViewIndex] = useState(selectedIndex);
  const currentIndex = viewIndex < candidates.length ? viewIndex : -1;
  const originalVisible = currentIndex < 0;
  const chosen = selectedIndex === currentIndex;
  const body = originalVisible
    ? original.body
    : chosen
      ? text
      : candidates[currentIndex].body;
  const tags = originalVisible
    ? original.topics
    : chosen
      ? topics
      : candidates[currentIndex].topics;
  useEffect(() => {
    setViewIndex(selectedIndex);
    setOpen(false);
  }, [selectedIndex]);
  const show = (index: number) => {
    setViewIndex(index);
    setOpen(false);
  };
  return (
    <div className={`copy-letter-workspace${open ? " is-open" : ""}`}>
      <nav className="copy-letter-sidebar" aria-label="文案信笺">
        <Button
          aria-label={`查看${originalLabel}`}
          aria-pressed={originalVisible}
          disabled={disabled}
          onClick={() => show(-1)}
        >
          1
          {selectedIndex < 0 && (
            <CheckOutlined className="copy-letter-chosen-mark" />
          )}
        </Button>
        {candidates.map((_, index) => (
          <Button
            key={index}
            aria-label={`查看文案${index + 1}`}
            aria-pressed={currentIndex === index}
            disabled={disabled}
            onClick={() => show(index)}
          >
            {index + 2}
            {selectedIndex === index && (
              <CheckOutlined className="copy-letter-chosen-mark" />
            )}
          </Button>
        ))}
      </nav>
      <div className="copy-letter-stage">
        <div className="copy-envelope-back" aria-hidden="true" />
        <section
          className="copy-letter-paper"
          aria-label={
            originalVisible
              ? `${originalLabel}信笺`
              : `文案${currentIndex + 1}信笺`
          }
        >
          <header>
            <strong>
              {originalVisible ? originalLabel : `文案 ${currentIndex + 1}`}
            </strong>
            <div className="copy-letter-actions">
              <Button
                className="copy-letter-choice"
                type="text"
                size="small"
                aria-label="选用当前文案"
                aria-pressed={chosen}
                title={chosen ? "已选用当前文案" : "选用当前文案"}
                disabled={disabled}
                icon={chosen ? <CheckCircleFilled /> : <CheckCircleOutlined />}
                onClick={() =>
                  originalVisible ? onOriginal() : onSelect(currentIndex)
                }
              />
              <Button
                type="text"
                size="small"
                aria-label={open ? "收起信笺" : "展开信笺"}
                aria-expanded={open}
                icon={open ? <DownOutlined /> : <UpOutlined />}
                onClick={() => setOpen(!open)}
              />
            </div>
          </header>
          {open ? (
            <div className="copy-letter-content">
              <Input.TextArea
                aria-label="最终文案"
                value={body}
                disabled={disabled}
                onChange={(event) => onText(currentIndex, event.target.value)}
                status={Array.from(body).length > 12000 ? "error" : undefined}
              />
              <Select
                aria-label="文案话题"
                mode="tags"
                suffixIcon={null}
                value={tags}
                onChange={(value) => onTopics(currentIndex, value)}
                disabled={disabled}
              />
              <small
                className={
                  Array.from(body).length > 12000 ? "workflow-over-limit" : ""
                }
              >
                {Array.from(body).length} / 12000 字
              </small>
            </div>
          ) : (
            <button
              type="button"
              className="copy-letter-preview"
              aria-label="打开文案信笺"
              onClick={() => setOpen(true)}
            >
              <p>{body}</p>
              <small>{tags.map((topic) => "#" + topic).join(" ")}</small>
            </button>
          )}
        </section>
        <div className="copy-envelope-front" aria-hidden="true">
          <svg
            className="copy-envelope-puppy"
            viewBox="0 0 120 144"
            fill="none"
          >
            <g
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M49 59C35 60 26 53 27 44L22 40Q19 32 28 30L40 27Q43 15 54 16Q73 13 80 31" />
              <path d="M63 24Q83 19 88 39Q91 58 79 63Q68 63 68 45" />
              <path d="M32 46Q37 51 43 46M51 60C43 76 39 94 43 110L40 125Q38 133 50 133H59M75 65Q83 82 82 103C97 100 108 110 100 127Q95 135 82 133H68Q58 133 60 124L61 91" />
              <path d="M72 106Q59 116 65 128H85M82 103Q100 99 102 83Q111 88 108 106Q106 117 100 127M48 64L75 68" />
              <path d="m58 68 4 6-5 5-4-6Z" />
              <circle
                cx="46"
                cy="35"
                r="1.6"
                fill="currentColor"
                stroke="none"
              />
              <path d="m23 33 5 1-4 4Z" fill="currentColor" />
              <path
                d="M15 18c-6-5-12 3 0 10 12-7 6-15 0-10Z"
                strokeWidth="1.8"
              />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
