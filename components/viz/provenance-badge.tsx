import {
  VIZ_PROVENANCE_MARK,
  VIZ_PROVENANCE_TOKEN,
  type VizProvenance,
} from "@/lib/viz/tokens";

export function ProvenanceBadge({
  provenance,
  label,
}: {
  provenance: VizProvenance;
  /** Override the mark — e.g. `v3 → v4` or the sheet's `┄`. */
  label?: string;
}) {
  const mark = label ?? VIZ_PROVENANCE_MARK[provenance];
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
        label ? "normal-case tracking-normal" : "uppercase tracking-[0.14em]"
      } ${VIZ_PROVENANCE_TOKEN[provenance]}`}
      title={provenance}
      aria-label={label ?? provenance}
    >
      {mark}
    </span>
  );
}
