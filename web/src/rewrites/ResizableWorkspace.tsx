import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const KEY = "rednote.rewrite.rail-width",
  MIN = 220,
  MAX = 440,
  DEFAULT = 244;
export default function ResizableWorkspace({
  rail,
  children,
  className = "rewrite-workspace",
  railCollapsed = false,
}: {
  className?: string;
  railCollapsed?: boolean;
  rail: ReactNode;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [preferred, setPreferred] = useState(() => {
    try {
      const value = Number(localStorage.getItem(KEY));
      return Number.isFinite(value) && value >= MIN
        ? Math.min(MAX, value)
        : DEFAULT;
    } catch {
      return DEFAULT;
    }
  });
  const [available, setAvailable] = useState(0);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const element = root.current;
    const measure = () =>
      setAvailable(
        element.clientWidth ||
          element.closest<HTMLElement>(".main-shell")?.clientWidth ||
          0,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const maximum = available
    ? Math.max(MIN, Math.min(MAX, available - 480))
    : MAX;
  const width = Math.max(MIN, Math.min(preferred, maximum));
  const latest = useRef(preferred);
  latest.current = preferred;
  const save = (value: number) => {
    try {
      localStorage.setItem(KEY, String(value));
    } catch {
      /* Keep the width for this visit. */
    }
  };
  const update = (value: number, persist = false) => {
    const next = Math.round(Math.max(MIN, Math.min(maximum, value)));
    latest.current = next;
    setPreferred(next);
    if (persist) save(next);
  };
  const finish = () => {
    if (drag.current) save(latest.current);
    drag.current = null;
    setDragging(false);
  };
  return (
    <div
      ref={root}
      className={`${className}${dragging ? " is-resizing" : ""}${railCollapsed ? " is-rail-collapsed" : ""}`}
      style={{ "--project-rail-width": `${width}px` } as CSSProperties}
    >
      {rail}
      <div
        className="project-rail-resizer"
        role="separator"
        tabIndex={0}
        aria-label="调整项目列表宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN}
        aria-valuemax={maximum}
        aria-valuenow={width}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          drag.current = { x: e.clientX, width };
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            update(drag.current.width + e.clientX - drag.current.x);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onDoubleClick={() => update(DEFAULT, true)}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          update(
            e.key === "Home"
              ? MIN
              : e.key === "End"
                ? maximum
                : width +
                  (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 32 : 16),
            true,
          );
        }}
      />
      {children}
    </div>
  );
}
