import type { DrawerProps } from "antd";
import { Drawer } from "antd";

// Reuse the same working editor in a tab or in its existing drawer entry point.
export default function WorkspaceSurface({
  embedded,
  children,
  title,
  ...props
}: DrawerProps & { embedded?: boolean }) {
  if (embedded)
    return (
      <section className="embedded-workspace">
        {title && <h3>{title}</h3>}
        {children}
      </section>
    );
  return (
    <Drawer title={title} {...props}>
      {children}
    </Drawer>
  );
}
