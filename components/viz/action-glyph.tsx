import {
  isVizAction,
  VIZ_ACTION_GLYPH,
  VIZ_ACTION_LABEL,
  VIZ_ACTION_TOKEN,
  type VizAction,
} from "@/lib/viz/tokens";

export function ActionGlyph({
  action,
  filled = false,
  className = "",
}: {
  action: string;
  filled?: boolean;
  className?: string;
}) {
  const key: VizAction = isVizAction(action) ? action : "maintain";
  const dashed = key === "metric_unavailable";
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded text-[11px] leading-none ${VIZ_ACTION_TOKEN[key]} ${
        filled ? "bg-current/10" : "border border-current/40 bg-transparent"
      } ${dashed ? "border-dashed" : ""} ${className}`}
      aria-label={VIZ_ACTION_LABEL[key]}
      title={VIZ_ACTION_LABEL[key]}
    >
      <span aria-hidden="true">{VIZ_ACTION_GLYPH[key]}</span>
    </span>
  );
}
