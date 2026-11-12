import { Button } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
export default function InlineDetail({
  open,
  title,
  onClose,
  extra,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const container = root.current?.closest(".page-content");
    if (!container) return;
    const scroll = container.scrollTop;
    container.scrollTop = 0;
    return () => {
      container.scrollTop = scroll;
    };
  }, [open]);
  if (!open) return null;
  return (
    <section ref={root} className="inline-detail-page" aria-label={title}>
      <header className="inline-detail-header">
        <Button aria-label="返回采集库" icon={<ArrowLeftOutlined />} onClick={onClose}>
          返回采集库
        </Button>
        <h2>{title}</h2>
        <div>{extra}</div>
      </header>
      <div className="inline-detail-content">{children}</div>
    </section>
  );
}
