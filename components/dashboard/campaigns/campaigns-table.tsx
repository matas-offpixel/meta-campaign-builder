"use client";

/**
 * components/dashboard/campaigns/campaigns-table.tsx
 *
 * Campaign + ad-set table for the internal campaigns surface. The
 * server has already aggregated `active_creatives_snapshots` into
 * the `CampaignsAggregateRow` shape (see `campaigns-aggregator.ts`).
 *
 * Columns (campaign + ad-set rows share the same shape):
 *   Name · Status · Spend · Impressions · CPM · Link clicks · CTR ·
 *   Meta purchases · Meta CPA · Sales (est., spend-share) · CPA (est.) ·
 *   Attribution badge.
 *
 * Two interaction primitives:
 *   - Expandable campaign disclosure that reveals child ad-sets.
 *   - Sortable columns (cycle asc/desc) — defaults to spend desc.
 *
 * Cross-check: when `cpaDivergent === true` (per the >3× rule in
 * `campaigns-aggregator.isDivergent`), both Meta CPA and CPA (est.)
 * cells render with a ⚠️ icon + tooltip.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";

import type {
  CampaignsAggregateRow,
  CampaignsAdSetRow,
} from "@/lib/dashboard/campaigns-aggregator";
import { AttributionGapColumn } from "@/components/dashboard/client-portal/AttributionGapColumn";

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("en-GB");
const PCT = new Intl.NumberFormat("en-GB", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type SortKey =
  | "name"
  | "status"
  | "spend"
  | "impressions"
  | "cpm"
  | "clicks"
  | "ctr"
  | "metaRegs"
  | "metaCpa"
  | "estSales"
  | "estCpa";

type SortDir = "asc" | "desc";

interface Props {
  rows: CampaignsAggregateRow[];
}

export function CampaignsTable({ rows }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      return compareNullableDir(av, bv, sortDir);
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const toggleExpanded = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[1280px] border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <SortableTh
              label="Name"
              k="name"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
            />
            <SortableTh
              label="Status"
              k="status"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              align="left"
            />
            <SortableTh
              label="Spend"
              k="spend"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              align="right"
            />
            <SortableTh
              label="Impr."
              k="impressions"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              align="right"
            />
            <SortableTh
              label="CPM"
              k="cpm"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              align="right"
            />
            <SortableTh
              label="Clicks"
              k="clicks"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              align="right"
            />
            <SortableTh
              label="CTR"
              k="ctr"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              align="right"
            />
            <SortableTh
              label="Meta purchases"
              k="metaRegs"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              align="right"
              tooltip={tooltips.metaPurchases}
            />
            <SortableTh
              label="Meta CPA"
              k="metaCpa"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              align="right"
              tooltip={tooltips.metaCpa}
            />
            <SortableTh
              label="Sales (est.)"
              k="estSales"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              align="right"
              tooltip={tooltips.estSales}
            />
            <SortableTh
              label="CPA (est.)"
              k="estCpa"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              align="right"
              tooltip={tooltips.estCpa}
            />
            <th className="px-2 py-2 text-left">Attribution</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => {
            const open = expanded.has(row.campaignId);
            return (
              <RowGroup
                key={row.campaignId}
                row={row}
                striped={i % 2 === 1}
                open={open}
                onToggle={() => toggleExpanded(row.campaignId)}
              />
            );
          })}
          {sortedRows.length === 0 && (
            <tr>
              <td
                colSpan={12}
                className="px-3 py-6 text-center text-xs text-muted-foreground"
              >
                No campaigns matched the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const tooltips = {
  metaPurchases:
    "Directly reported by Meta. May be over- or under-counted — check the attribution badge.",
  metaCpa:
    "Spend / Meta purchases. Meta-reported, subject to the same caveats as the purchases column.",
  estSales:
    "Proportional allocation by spend-share. Not measured per-touchpoint. Phase 1a (per-order email match) is gated on client-side pixel work.",
  estCpa:
    "Cost per estimated sale. Use for relative ad-set comparison only.",
} as const;

interface RowGroupProps {
  row: CampaignsAggregateRow;
  striped: boolean;
  open: boolean;
  onToggle: () => void;
}

function RowGroup({ row, striped, open, onToggle }: RowGroupProps) {
  return (
    <>
      <tr
        className={`border-t border-border ${striped ? "bg-muted/20" : ""}`}
      >
        <td className="px-2 py-2 align-top">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1 text-left font-medium text-foreground hover:text-foreground/80"
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="truncate">
              {row.campaignName ?? row.campaignId}
            </span>
          </button>
          {row.eventCodes.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
              {row.eventCodes.map((c) => (
                <span
                  key={c}
                  className="rounded bg-muted px-1 py-0.5 font-mono"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </td>
        <td className="px-2 py-2 align-top text-xs">
          <StatusBadge status={row.status} />
        </td>
        <NumberCell value={GBP.format(row.spend)} />
        <NumberCell value={NUM.format(Math.round(row.impressions))} />
        <NumberCell value={row.cpm == null ? "—" : GBP2.format(row.cpm)} />
        <NumberCell value={NUM.format(Math.round(row.clicks))} />
        <NumberCell
          value={row.ctr == null ? "—" : `${row.ctr.toFixed(2)}%`}
        />
        <NumberCell value={NUM.format(Math.round(row.metaRegs))} />
        <NumberCell
          value={row.metaCpa == null ? "—" : GBP2.format(row.metaCpa)}
          divergent={row.cpaDivergent}
          divergentDirection="meta"
        />
        <NumberCell
          value={
            row.estSales == null
              ? "—"
              : NUM.format(Math.round(row.estSales))
          }
          muted
        />
        <NumberCell
          value={row.estCpa == null ? "—" : GBP2.format(row.estCpa)}
          divergent={row.cpaDivergent}
          divergentDirection="est"
          muted
        />
        <td className="px-2 py-2 align-top">
          <AttributionGapColumn attribution={row.attribution} />
        </td>
      </tr>
      {open &&
        row.adSets.map((adset) => (
          <AdSetRow
            key={`${row.campaignId}|${adset.adSetId}`}
            adset={adset}
            striped={striped}
          />
        ))}
    </>
  );
}

function AdSetRow({
  adset,
  striped,
}: {
  adset: CampaignsAdSetRow;
  striped: boolean;
}) {
  return (
    <tr
      className={`border-t border-border/60 ${striped ? "bg-muted/10" : "bg-background"}`}
    >
      <td className="px-2 py-1.5 pl-8 align-top">
        <span className="text-xs text-muted-foreground">
          {adset.adSetName ?? adset.adSetId}
        </span>
      </td>
      <td className="px-2 py-1.5 align-top text-xs">
        <StatusBadge status={adset.status} />
      </td>
      <NumberCell value={GBP.format(adset.spend)} muted />
      <NumberCell value={NUM.format(Math.round(adset.impressions))} muted />
      <NumberCell value={adset.cpm == null ? "—" : GBP2.format(adset.cpm)} muted />
      <NumberCell value={NUM.format(Math.round(adset.clicks))} muted />
      <NumberCell value={adset.ctr == null ? "—" : `${adset.ctr.toFixed(2)}%`} muted />
      <NumberCell value={NUM.format(Math.round(adset.metaRegs))} muted />
      <NumberCell
        value={adset.metaCpa == null ? "—" : GBP2.format(adset.metaCpa)}
        divergent={adset.cpaDivergent}
        divergentDirection="meta"
        muted
      />
      <NumberCell
        value={
          adset.estSales == null
            ? "—"
            : NUM.format(Math.round(adset.estSales))
        }
        muted
      />
      <NumberCell
        value={adset.estCpa == null ? "—" : GBP2.format(adset.estCpa)}
        divergent={adset.cpaDivergent}
        divergentDirection="est"
        muted
      />
      <td className="px-2 py-1.5 align-top">
        <AttributionGapColumn attribution={adset.attribution} compact />
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: "active" | "paused" }) {
  const tone =
    status === "active"
      ? "bg-emerald-100 text-emerald-700"
      : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}
    >
      {status}
    </span>
  );
}

function NumberCell({
  value,
  muted = false,
  divergent = false,
  divergentDirection,
}: {
  value: string;
  muted?: boolean;
  divergent?: boolean;
  divergentDirection?: "meta" | "est";
}) {
  return (
    <td
      className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${
        muted ? "text-muted-foreground" : "text-foreground"
      }`}
    >
      <span className="inline-flex items-center justify-end gap-1">
        {divergent && (
          <AlertTriangle
            className="h-3 w-3 text-amber-600"
            aria-label={
              divergentDirection === "meta"
                ? "Meta-reported CPA diverges from spend-share estimate by >3×"
                : "Spend-share estimate diverges from Meta-reported CPA by >3×"
            }
          />
        )}
        {value}
      </span>
    </td>
  );
}

function SortableTh({
  label,
  k,
  activeKey,
  dir,
  onSort,
  align = "left",
  tooltip,
}: {
  label: string;
  k: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  tooltip?: string;
}) {
  const isActive = activeKey === k;
  return (
    <th
      className={`whitespace-nowrap px-2 py-2 ${align === "right" ? "text-right" : "text-left"}`}
      title={tooltip}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""} hover:text-foreground`}
      >
        {label}
        {isActive && <span aria-hidden>{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function sortValue(row: CampaignsAggregateRow, k: SortKey): unknown {
  switch (k) {
    case "name":
      return (row.campaignName ?? row.campaignId).toLowerCase();
    case "status":
      return row.status;
    case "spend":
      return row.spend;
    case "impressions":
      return row.impressions;
    case "cpm":
      return row.cpm;
    case "clicks":
      return row.clicks;
    case "ctr":
      return row.ctr;
    case "metaRegs":
      return row.metaRegs;
    case "metaCpa":
      return row.metaCpa;
    case "estSales":
      return row.estSales;
    case "estCpa":
      return row.estCpa;
    default:
      return null;
  }
}

function compareNullableDir(a: unknown, b: unknown, dir: SortDir): number {
  const sign = dir === "asc" ? 1 : -1;
  const aIsNullish = a == null;
  const bIsNullish = b == null;
  if (aIsNullish && bIsNullish) return 0;
  if (aIsNullish) return 1; // nulls always last
  if (bIsNullish) return -1;
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * sign;
  }
  return String(a).localeCompare(String(b)) * sign;
}

// Surface the column-tooltip strings for tests + storybook consumers
// that mount the table without rendering the header semantics.
export const CAMPAIGN_COLUMN_TOOLTIPS = tooltips;

// Re-exports for unrelated callers that want the formatters used in
// this surface (parity with PCT formatter elsewhere on the dashboard).
export const _formatters = { GBP, GBP2, NUM, PCT };
