import { Button, type ButtonProps } from "antd";
import type { CSSProperties } from "react";

const particles = [
  [22, 3, 0.92, -1.1],
  [67, 2, 1.15, -3.4],
  [35, 5, 0.85, -2.3],
  [78, 3, 1.1, -0.6],
  [48, 2, 1, -4.2],
  [17, 4, 1.2, -1.8],
  [62, 3, 0.88, -2.9],
  [39, 2, 1.06, -0.2],
  [73, 5, 0.96, -3.7],
];

export default function GenerateButton({
  children,
  className = "",
  loading,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <Button
      {...props}
      type="primary"
      loading={loading}
      disabled={disabled || !!loading}
      className={`ai-generation-button particle-generate-button ${className}`}
      aria-busy={!!loading}
      data-accelerating={loading ? "true" : undefined}
      icon={
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9.5 4 2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2Z" />
          <path d="M19 2v6m-3-3h6M21 17v4m-2-2h4" />
        </svg>
      }
    >
      <span className="particle-generate-field" aria-hidden="true">
        {particles.map(([y, size, speed, delay], index) => (
          <span
            key={index}
            className={`particle-generate-stream${index % 4 === 2 ? " is-star" : ""}`}
            style={
              {
                "--particle-y": `${y}%`,
                "--particle-size": `${size}px`,
                "--particle-speed": speed,
                "--particle-delay": `${delay}s`,
              } as CSSProperties
            }
          />
        ))}
      </span>
      <span className="particle-generate-label">{children}</span>
    </Button>
  );
}
