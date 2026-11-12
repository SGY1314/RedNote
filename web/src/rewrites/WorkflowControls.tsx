import { createContext, useContext, useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { SettingOutlined } from "@ant-design/icons";
import { Checkbox } from "antd";
import { useMediaQuery } from "../hooks/useMediaQuery";
export const WorkflowVisibilityContext = createContext(true);

export function WorkflowResultPanel({
  title,
  className,
  children,
  action,
}: {
  title: string;
  className: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="workflow-result-section">
      <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {title}
        {action}
      </h3>
      <div className={`${className} workflow-result-panel`}>{children}</div>
    </section>
  );
}

export function WorkflowSettings({
  summary,
  missing,
  children,
}: {
  summary: string;
  missing?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`workflow-config${missing ? " is-missing" : ""}`}
      aria-label="创作设置"
    >
      <div className="workflow-config-heading">
        <SettingOutlined />
        <span title={summary}>{summary}</span>
      </div>
      <div className="workflow-config-body">{children}</div>
    </section>
  );
}

export function WorkflowActionBar({
  children,
  mobile,
  hint,
  dock = true,
}: {
  children: ReactNode;
  mobile?: ReactNode;
  hint?: string;
  dock?: boolean;
}) {
  const narrow = useMediaQuery("(max-width: 700px)");
  const visible = useContext(WorkflowVisibilityContext);
  useEffect(() => {
    if (!narrow || !dock || !visible) return;
    document.body.classList.add("workflow-has-dock");
    return () => document.body.classList.remove("workflow-has-dock");
  }, [narrow, dock, visible]);
  if (!visible) return null;
  if (narrow && dock)
    return createPortal(
      <div
        className="workflow-mobile-dock"
        role="region"
        aria-label="当前步骤操作"
      >
        {hint && <small role="status">{hint}</small>}
        <div>{mobile ?? children}</div>
      </div>,
      document.body,
    );
  return <div className="workflow-next">{children}</div>;
}

export function WorkflowCandidates({
  items,
  selectedIndex,
  isTitle,
  limit,
  onSelect,
}: {
  items: { text: string; topics?: string[] }[];
  selectedIndex: number;
  isTitle: boolean;
  limit: number;
  onSelect: (index: number | null) => void;
}) {
  return (
    <div
      className="workflow-candidates"
      aria-label={isTitle ? "候选标题" : "候选文案"}
    >
      {items.map((item, index) => (
        <article
          key={index}
          className={selectedIndex === index ? "selected" : ""}
        >
          <Checkbox
            className="workflow-candidate-choice"
            aria-label={`选用${isTitle ? "标题" : "文案"}${index + 1}`}
            checked={selectedIndex === index}
            onChange={(event) => onSelect(event.target.checked ? index : null)}
          >
            <div className="workflow-candidate-content">
              <small>
                <span>
                  {isTitle ? "标题" : "文案"} {index + 1}
                </span>
              </small>
              {isTitle ? (
                <strong>{item.text}</strong>
              ) : (
                <p className="workflow-copy-excerpt">{item.text}</p>
              )}
              {isTitle && (
                <small
                  className={
                    Array.from(item.text).length > limit
                      ? "workflow-over-limit"
                      : ""
                  }
                >
                  {Array.from(item.text).length} / {limit} 字
                </small>
              )}
            </div>
          </Checkbox>
          {!isTitle && (
            <details className="workflow-candidate-full">
              <summary>查看全文与话题</summary>
              <p>{item.text}</p>
              <small>{item.topics?.map((t) => `#${t}`).join(" ")}</small>
            </details>
          )}
        </article>
      ))}
    </div>
  );
}
