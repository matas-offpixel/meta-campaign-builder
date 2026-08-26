import { VIZ_STATUS_LABEL, VIZ_STATUS_TOKEN, type VizStatus } from "@/lib/viz/tokens";

export function StatusDot({
  status,
  className = "",
}: {
  status: VizStatus;
  className?: string;
}) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${VIZ_STATUS_TOKEN[status]} ${className}`}
      aria-label={VIZ_STATUS_LABEL[status]}
      title={VIZ_STATUS_LABEL[status]}
    />
  );
}
