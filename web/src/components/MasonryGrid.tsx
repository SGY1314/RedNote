import { useLayoutEffect, useRef, type ReactNode } from "react";

export default function MasonryGrid({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const cards = Array.from(root.current?.children || []) as HTMLElement[];
    const measure = () => {
      const spans = cards.map((card) =>
        Math.ceil(card.getBoundingClientRect().height + 16),
      );
      cards.forEach((card, index) => {
        card.style.gridRowEnd = `span ${spans[index]}`;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [children]);
  return (
    <div ref={root} className="collection-grid">
      {children}
    </div>
  );
}
