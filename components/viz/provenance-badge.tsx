import {
  VIZ_PROVENANCE_MARK,
  VIZ_PROVENANCE_TOKEN,
  VIZ_TYPE,
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
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 ${
        label ? `${VIZ_TYPE.label} normal-case tracking-normal` : VIZ_TYPE.micro
      } ${VIZ_PROVENANCE_TOKEN[provenance]}`}
      title={provenance}
      aria-label={label ?? provenance}
    >
      {mark}
    </span>
  );
}
