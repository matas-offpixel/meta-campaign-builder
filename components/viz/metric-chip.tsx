import type { ReactNode } from "react";

const SIZE_CLASS = {
  sm: "rounded-full border border-border bg-muted/40 px-1.5 py-0 text-[10px]",
  md: "rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]",
  lg: "rounded-md px-0 py-0 text-2xl font-semibold",
} as const;

export function MetricChip({
  label,
  children,
  className = "",
  size = "md",
}: {
  label: string;
  children: ReactNode;
  className?: string;
  size?: keyof typeof SIZE_CLASS;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 tabular-nums ${SIZE_CLASS[size]} ${className}`}
      aria-label={label}
      title={label}
    >
      {children}
    </span>
  );
}

export function AspectChip({
  ratio,
}: {
  ratio: string;
}) {
  const shape =
    ratio === "9:16"
      ? "h-3.5 w-2"
      : ratio === "1:1"
        ? "h-3 w-3"
        : ratio === "4:5"
          ? "h-3.5 w-2.5"
          : "h-2.5 w-3.5";
  return (
    <MetricChip label={ratio}>
      <span className={`rounded-[1px] border border-current ${shape}`} aria-hidden="true" />
      <span className="sr-only">{ratio}</span>
    </MetricChip>
  );
}
