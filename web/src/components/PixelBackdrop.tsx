import { useLayoutEffect, useRef } from "react";

const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const noise = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

/** A deterministic, low-resolution scene; source photos and user media stay intact. */
export function PixelScene({ preview = false }: { preview?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const box = canvas.getBoundingClientRect(),
        grid = preview ? 3 : 5;
      const width = Math.ceil(box.width / grid),
        height = Math.ceil(box.height / grid);
      if (!width || !height) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#050505";
      ctx.fillRect(0, 0, width, height);
      const radius = height * 0.38,
        mx = width * 0.23,
        my = height * 0.92;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const random = noise(x, y),
            dx = (x - mx) / radius,
            dy = (y - my) / radius;
          const d = dx * dx + dy * dy;
          const mist =
            Math.exp(
              -((y / height - 0.46 - 0.065 * Math.sin((x / width) * 7)) ** 2) /
                0.013,
            ) * Math.exp(-((x / width - 0.72) ** 2) / 0.12);
          let value = mist * 0.16;
          if (d < 1) {
            const light = Math.sqrt(1 - d) * 0.35 + Math.max(0, -dx) * 0.12;
            const crater =
              Math.sin(x * 0.17 + Math.cos(y * 0.18) * 2) *
              Math.cos(y * 0.19 + x * 0.08);
            value = 0.09 + light + crater * 0.12 + (random - 0.5) * 0.1;
          }
          const threshold = bayer[(y % 4) * 4 + (x % 4)] / 16;
          if (value > threshold * 0.75) {
            const tone = Math.round(Math.max(20, Math.min(130, value * 240)));
            ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
            ctx.fillRect(x, y, 1, 1);
          }
          if (random > 0.9975 && d > 1.05) {
            const tone = 65 + Math.floor(noise(y, x + 12) * 90);
            ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
            ctx.fillRect(x, y, 1, 1);
          }
        }
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [preview]);
  return (
    <canvas
      ref={ref}
      className={`pixel-sky-canvas${preview ? " is-preview" : ""}`}
      aria-hidden="true"
    />
  );
}

export default function PixelBackdrop({ page }: { page: string }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const shell = root.current?.closest(".app-shell");
    let frame = 0;
    const update = () => {
      frame = 0;
      const scroller = shell?.querySelector<HTMLElement>(
        page === "rewrites" ? ".page-rewrites .rewrite-main" : ".page-content",
      );
      const offset =
        Math.round(Math.min(60, (scroller?.scrollTop || 0) * 0.08) / 4) * 4;
      root.current?.style.setProperty("--pixel-scroll", `${-offset}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    shell?.addEventListener("scroll", schedule, true);
    update();
    return () => {
      cancelAnimationFrame(frame);
      shell?.removeEventListener("scroll", schedule, true);
    };
  }, [page]);
  return (
    <div
      ref={root}
      className="workspace-backdrop pixel-backdrop"
      aria-hidden="true"
    >
      <PixelScene />
      <span className="pixel-twinkles" />
    </div>
  );
}
