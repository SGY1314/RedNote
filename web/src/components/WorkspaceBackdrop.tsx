import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useWorkspaceAppearance } from "../WorkspaceAppearance";
import PixelBackdrop from "./PixelBackdrop";

/** One continuous landscape follows the visible workspace's own scroll area. */
export default function WorkspaceBackdrop({ page }: { page: string }) {
  const { theme } = useWorkspaceAppearance();
  const root = useRef<HTMLDivElement>(null);
  const scrollLayer = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState({
    hero: window.innerHeight,
    height: window.innerHeight,
    tiles: 1,
  });
  useLayoutEffect(() => {
    if (theme !== "rose") return;
    const shell = root.current?.closest(".app-shell");
    if (!shell) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const scroller = shell.querySelector<HTMLElement>(
        page === "rewrites" ? ".page-rewrites .rewrite-main" : ".page-content",
      );
      const hero = Math.max(
        window.innerHeight,
        Math.round((window.innerWidth * 941) / 1672),
      );
      const top =
        shell.querySelector(".topbar")?.getBoundingClientRect().bottom || 0;
      const height = Math.max(
        window.innerHeight,
        (scroller?.scrollHeight || 0) + top + 48,
      );
      const tiles = Math.ceil(Math.max(0, height - hero) / (hero / 2)) + 1;
      setScene((old) =>
        old.hero === hero && old.height === height && old.tiles === tiles
          ? old
          : { hero, height, tiles },
      );
      scrollLayer.current?.style.setProperty(
        "transform",
        `translate3d(0, -${scroller?.scrollTop || 0}px, 0)`,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    const observe = () => {
      resize.disconnect();
      const scroller = shell.querySelector<HTMLElement>(
        page === "rewrites" ? ".page-rewrites .rewrite-main" : ".page-content",
      );
      if (scroller) {
        resize.observe(scroller);
        [...scroller.children].forEach((child) => resize.observe(child));
      }
      schedule();
    };
    const mutations = new MutationObserver(observe);
    const content = shell.querySelector(".page-content");
    if (content) mutations.observe(content, { childList: true, subtree: true });
    shell.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    observe();
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      shell.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [page, theme]);
  if (theme === "pixel") return <PixelBackdrop page={page} />;
  return (
    <div ref={root} className="workspace-backdrop" aria-hidden="true">
      <div
        ref={scrollLayer}
        className="workspace-scene-scroll"
        style={
          {
            height: scene.height,
            "--scene-hero-height": `${scene.hero}px`,
            "--scene-tile-height": `${scene.hero / 2}px`,
          } as CSSProperties
        }
      >
        <div className="workspace-dune-field">
          <div className="workspace-landscape" />
          {Array.from({ length: scene.tiles }, (_, index) => (
            <div
              key={index}
              className={`workspace-dune-tile${index % 2 === 0 ? " is-reflected" : ""}`}
              style={{ top: scene.hero + (index * scene.hero) / 2 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
