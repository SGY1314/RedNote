import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export default function ProjectScrollList({
  children,
}: {
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; top: number } | null>(null);
  const id = useId();
  const [scroll, setScroll] = useState({ height: 0, total: 0, top: 0 });
  const [dragging, setDragging] = useState(false);
  const measure = () => {
    const el = viewport.current;
    if (!el) return;
    const next = {
      height: el.clientHeight,
      total: el.scrollHeight,
      top: el.scrollTop,
    };
    setScroll((old) =>
      old.height === next.height &&
      old.total === next.total &&
      old.top === next.top
        ? old
        : next,
    );
  };
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [children]);
  const max = Math.max(0, scroll.total - scroll.height);
  const thumb = Math.min(
    72,
    Math.max(32, (scroll.height * scroll.height) / (scroll.total || 1)),
    scroll.height,
  );
  const travel = Math.max(1, scroll.height - thumb);
  const setTop = (value: number) => {
    if (viewport.current)
      viewport.current.scrollTop = Math.max(0, Math.min(max, value));
  };
  const finish = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <div className="project-rail-scroll">
      <div
        ref={viewport}
        id={id}
        className="project-rail-list"
        onScroll={measure}
      >
        <div ref={content}>{children}</div>
      </div>
      {max > 0 && (
        <div
          className="project-scroll-track"
          onPointerDown={(event) => {
            if (event.button !== 0 || event.target !== event.currentTarget)
              return;
            event.preventDefault();
            setTop(
              ((event.clientY -
                event.currentTarget.getBoundingClientRect().top -
                thumb / 2) /
                travel) *
                max,
            );
          }}
        >
          <div
            role="scrollbar"
            aria-label="滚动项目列表"
            aria-controls={id}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={Math.round(scroll.top)}
            tabIndex={0}
            className={`project-scroll-thumb${dragging ? " is-dragging" : ""}`}
            style={{ height: thumb, top: (scroll.top / max) * travel }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              drag.current = { y: event.clientY, top: scroll.top };
              setDragging(true);
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (drag.current)
                setTop(
                  drag.current.top +
                    ((event.clientY - drag.current.y) / travel) * max,
                );
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
            onKeyDown={(event) => {
              const steps: Record<string, number> = {
                ArrowDown: 40,
                ArrowUp: -40,
                PageDown: scroll.height * 0.8,
                PageUp: -scroll.height * 0.8,
                Home: -max,
                End: max,
              };
              if (!(event.key in steps)) return;
              event.preventDefault();
              setTop(scroll.top + steps[event.key]);
            }}
          />
        </div>
      )}
    </div>
  );
}
