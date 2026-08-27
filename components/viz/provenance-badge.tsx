import {
  VIZ_PROVENANCE_MARK,
  VIZ_PROVENANCE_TOKEN,
  type VizProvenance,
} from "@/lib/viz/tokens";

export function ProvenanceBadge({
  provenance,
}: {
  provenance: VizProvenance;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] ${VIZ_PROVENANCE_TOKEN[provenance]}`}
      title={provenance}
      aria-label={provenance}
    >
      {VIZ_PROVENANCE_MARK[provenance]}
    </span>
  );
}
