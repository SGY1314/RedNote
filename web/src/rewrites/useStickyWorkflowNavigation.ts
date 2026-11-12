import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export function useStickyWorkflowNavigation(
  root: RefObject<HTMLElement | null>,
  ready?: string,
) {
  const navigation = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const element = root.current,
      nav = navigation.current;
    const scroller = element?.closest<HTMLElement>(".rewrite-main");
    if (!element || !nav || !scroller) return;
    let frame = 0;
    let collapsed = false;
    let initialized = false;
    const update = () => {
      frame = 0;
      if (!element.getClientRects().length) return;
      const scrollTop =
        scroller.getBoundingClientRect().top + scroller.clientTop;
      const headerBottom =
        document.querySelector(".topbar")?.getBoundingClientRect().bottom ||
        scrollTop;
      const boundary = Math.max(scrollTop, headerBottom);
      const inset = boundary - scrollTop;
      nav.style.setProperty("--workflow-navigation-top", `${inset}px`);
      const distance = element.getBoundingClientRect().top - boundary;
      const next = collapsed ? distance <= 1.5 : distance <= 0.5;
      if (!initialized || next !== collapsed) {
        initialized = true;
        collapsed = next;
        setCompact(next);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    const topbar = document.querySelector(".topbar");
    if (topbar) observer.observe(topbar);
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [root, ready]);
  return { navigation, compact };
}
