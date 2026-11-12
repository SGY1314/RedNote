import Icon, { ExclamationCircleFilled } from "@ant-design/icons";
import type { ReactNode } from "react";
import { useWorkspaceAppearance } from "../WorkspaceAppearance";

function Butterfly() {
  return (
    <svg
      viewBox="0 0 32 32"
      width="1em"
      height="1em"
      fill="none"
      aria-hidden="true"
    >
      <g
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15.5 16C12 8 5.5 3 3.5 7s-.5 10 9.5 12C7 16 4 19 6 23s7 4 9.5-4M16.5 16C20 8 26.5 3 28.5 7s.5 10-9.5 12c6-3 9 0 7 4s-7 4-9.5-4" />
        <path d="M16 13v11m-.5-10c-1-4-2-5-4-6m5 6c1-4 2-5 4-6M8 9c1.5 1 3 2.5 4 4m12-4c-1.5 1-3 2.5-4 4" />
      </g>
    </svg>
  );
}

export default function ConfirmActionIcon({
  fallback,
}: {
  fallback?: ReactNode;
}) {
  const { theme } = useWorkspaceAppearance();
  return theme === "rose" ? (
    <Icon
      className="confirm-butterfly"
      component={Butterfly}
      aria-label="蝴蝶"
    />
  ) : (
    (fallback ?? <ExclamationCircleFilled />)
  );
}
