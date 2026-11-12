import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { Checkbox, Input } from "antd";
import "./title-idea-wheel.css";

export default function TitleIdeaWheel({
  candidates,
  generationKey,
  selectedIndex,
  customTitle,
  customSelected,
  disabled,
  limit,
  onSelect,
  onEdit,
  onCustomEdit,
  onCustomSelect,
}: {
  candidates: string[];
  generationKey: string;
  selectedIndex: number;
  customTitle: string;
  customSelected: boolean;
  disabled: boolean;
  limit: number;
  onSelect: (index: number | null) => void;
  onEdit: (index: number, text: string) => void;
  onCustomEdit: (text: string) => void;
  onCustomSelect: (selected: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const total = candidates.length + 1;
  useEffect(() => {
    setActive(selectedIndex >= 0 ? selectedIndex + 1 : 0);
  }, [generationKey]);
  useEffect(() => {
    if (customSelected) setActive(0);
    else if (selectedIndex >= 0) setActive(selectedIndex + 1);
  }, [selectedIndex, customSelected]);
  const current = Math.min(active, total - 1);
  const turn = (direction: number) => {
    if (!disabled && total > 1)
      setActive((index) => (index + direction + total) % total);
  };
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let accumulated = 0,
      last = 0;
    const wheel = (event: WheelEvent) => {
      if (disabled || total < 2 || event.ctrlKey) return;
      const target = event.target;
      if (
        target instanceof HTMLTextAreaElement &&
        target.scrollHeight > target.clientHeight + 1
      )
        return;
      const delta =
        (Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX) *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1);
      if (!delta) return;
      event.preventDefault();
      if (Date.now() - last < 220) return;
      accumulated += delta;
      if (Math.abs(accumulated) >= 32) {
        const direction = Math.sign(accumulated);
        setActive((index) => (index + direction + total) % total);
        accumulated = 0;
        last = Date.now();
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [disabled, total]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLInputElement ||
      disabled
    )
      return;
    const direction = ["ArrowRight", "ArrowDown"].includes(event.key)
      ? 1
      : ["ArrowLeft", "ArrowUp"].includes(event.key)
        ? -1
        : 0;
    if (direction) {
      event.preventDefault();
      turn(direction);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : total - 1);
    }
  };
  return (
    <div
      className="title-idea-wheel"
      ref={root}
      role="region"
      aria-label="标题创意轮盘"
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={onKeyDown}
    >
      <div className="title-wheel-stage">
        <div className="title-wheel-disc" aria-hidden="true">
          <div
            className="title-wheel-ring"
            style={{ transform: `rotate(${(-current * 360) / total}deg)` }}
          />
          <div className="title-wheel-hub">
            <span>{current ? String(current).padStart(2, "0") : "✎"}</span>
            <i />
            <small>{String(candidates.length).padStart(2, "0")}</small>
          </div>
        </div>
        <div className="title-wheel-candidates" aria-label="候选标题">
          {[customTitle, ...candidates].map((text, position) => {
            let slot = (position - current + total) % total;
            if (slot > total / 2) slot -= total;
            const custom = position === 0;
            const selected = custom
              ? customSelected
              : selectedIndex === position - 1;
            const length = Array.from(text).length;
            return (
              <article
                key={custom ? "custom" : position}
                aria-hidden={slot !== 0}
                className={`title-wheel-card${custom ? " is-custom" : ""}${slot === 0 ? " is-active" : ""}${selected ? " is-selected" : ""}`}
                data-index={position - 1}
                style={
                  {
                    "--wheel-slot": slot,
                    "--wheel-inset": `${Math.max(0, 1 - Math.abs(slot)) * 14}px`,
                    zIndex: total - Math.abs(slot),
                  } as CSSProperties
                }
              >
                <div className="title-wheel-card-meta">
                  <span>{custom ? "自定义标题" : `标题 ${position}`}</span>
                  <small
                    className={length > limit ? "workflow-over-limit" : ""}
                  >
                    {length} / {limit} 字
                  </small>
                  <Checkbox
                    aria-label={
                      custom ? "选用自定义标题" : `选用标题${position}`
                    }
                    checked={selected}
                    disabled={disabled || slot !== 0}
                    onChange={(event) =>
                      custom
                        ? onCustomSelect(event.target.checked)
                        : onSelect(event.target.checked ? position - 1 : null)
                    }
                  />
                </div>
                <Input.TextArea
                  aria-label={custom ? "自定义标题" : `编辑标题${position}`}
                  placeholder={custom ? "输入自定义标题" : undefined}
                  value={text}
                  disabled={disabled}
                  tabIndex={slot === 0 ? 0 : -1}
                  status={length > limit ? "error" : undefined}
                  rows={2}
                  onChange={(event) =>
                    custom
                      ? onCustomEdit(event.target.value)
                      : onEdit(position - 1, event.target.value)
                  }
                />
              </article>
            );
          })}
        </div>
      </div>
      <span
        className="title-wheel-status"
        role="status"
        aria-live="polite"
        aria-label="标题轮盘序号"
      >
        {current ? `${current} / ${candidates.length}` : "自定义"}
      </span>
    </div>
  );
}
