import type { ReactNode } from "react";

import type { CreativeTagAssignmentWithTag } from "@/lib/reporting/creative-tag-breakdowns";
import {
  buildCreativeTagBreakdowns,
  buildCreativeTagTiles,
  type CreativeTagBreakdown,
  type CreativeTagTile,
} from "@/lib/reporting/creative-tag-breakdowns";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";
import { fmtCurrency } from "@/lib/dashboard/format";

interface Props {
  groups?: ConceptGroupRow[];
  assignments?: CreativeTagAssignmentWithTag[];
  breakdowns?: CreativeTagBreakdown[];
  kind?: string | null;
}

export function ShareCreativeTagBreakdowns({
  groups = [],
  assignments = [],
  breakdowns,
  kind,
}: Props) {
  const rowsByDimension =
    breakdowns ?? buildCreativeTagBreakdowns(groups, assignments);
  const tiles = buildCreativeTagTiles(groups, assignments);
  const isBrandCampaign = kind === "brand_campaign";

  if (assignments.length === 0 && !breakdowns) return null;
  if (rowsByDimension.length === 0) return null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-heading text-sm tracking-wide text-foreground">
          Tag performance breakdown
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Spend and volume metrics are summed across tagged active creative
          concepts. Rate metrics are recomputed from summed numerator and
          denominator, not averaged across rows.
        </p>
      </div>

      {rowsByDimension.map((breakdown) => (
        <DimensionBreakdown
          key={breakdown.dimension}
          breakdown={breakdown}
          tiles={tiles.filter((tile) => tile.dimension === breakdown.dimension)}
          isBrandCampaign={isBrandCampaign}
        />
      ))}
    </div>
  );
}

function DimensionBreakdown({
  breakdown,
  tiles,
  isBrandCampaign,
}: {
  breakdown: CreativeTagBreakdown;
  tiles: CreativeTagTile[];
  isBrandCampaign: boolean;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {formatDimension(breakdown.dimension)}
      </h4>

      {tiles.length > 0 ? (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {tiles.map((tile) => (
            <TagTile
              key={`${tile.dimension}:${tile.value_key}`}
              tile={tile}
              isBrandCampaign={isBrandCampaign}
            />
          ))}
        </div>
      ) : null}

      <details className="group rounded-md border border-border bg-card/50">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-foreground marker:hidden">
          <span>Show details</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground group-open:hidden">
            Expand
          </span>
          <span className="hidden text-[10px] uppercase tracking-wider text-muted-foreground group-open:inline">
            Hide
          </span>
        </summary>
        <div className="overflow-x-auto border-t border-border">
          <BreakdownTable
            breakdown={breakdown}
            isBrandCampaign={isBrandCampaign}
          />
        </div>
      </details>
    </div>
  );
}

function TagTile({
  tile,
  isBrandCampaign,
}: {
  tile: CreativeTagTile;
  isBrandCampaign: boolean;
}) {
  const secondary = secondaryMetric(tile, isBrandCampaign);
  return (
    <div className="flex w-[230px] shrink-0 flex-col gap-3 rounded-md border border-border bg-card p-3 shadow-sm">
      <ThumbnailCollage tile={tile} />
      <div className="min-w-0">
        <div className="line-clamp-1 text-sm font-medium text-foreground">
          {tile.value_label}
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Spend
            </div>
            <div className="text-lg font-semibold text-foreground">
              {fmtCurrency(tile.spend)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {secondary.label}
            </div>
            <div className="text-sm font-medium text-foreground">
              {secondary.value}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThumbnailCollage({ tile }: { tile: CreativeTagTile }) {
  if (tile.thumbnails.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded bg-muted text-lg font-semibold uppercase text-muted-foreground">
        {initials(tile.fallbackLabel)}
      </div>
    );
  }

  return (
    <div className="grid aspect-[4/3] grid-cols-2 gap-1 overflow-hidden rounded bg-muted">
      {tile.thumbnails.map((url, index) => (
        // Mirrors the active-creatives card: remote Meta thumbnail domains are
        // not routed through Next image optimisation.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${url}-${index}`}
          src={url}
          alt=""
          className={`h-full w-full object-cover ${
            tile.thumbnails.length === 1 ? "col-span-2 row-span-2" : ""
          }`}
          loading="lazy"
        />
      ))}
    </div>
  );
}

function BreakdownTable({
  breakdown,
  isBrandCampaign,
}: {
  breakdown: CreativeTagBreakdown;
  isBrandCampaign: boolean;
}) {
  return (
    <table className="w-full min-w-[760px] border-collapse text-xs">
      <thead className="bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
        <tr>
          <Th align="left">Tag</Th>
          <Th align="right">Ads</Th>
          <Th align="right">Spend</Th>
          <Th align="right">Impr</Th>
          <Th align="right">Reach</Th>
          <Th align="right">Clicks</Th>
          <Th align="right">CTR</Th>
          {!isBrandCampaign ? <Th align="right">Regs</Th> : null}
          {!isBrandCampaign ? <Th align="right">CPR</Th> : null}
          {!isBrandCampaign ? <Th align="right">Purch</Th> : null}
        </tr>
      </thead>
      <tbody>
        {breakdown.rows.map((row) => (
          <tr
            key={row.value_key}
            className="border-t border-border odd:bg-background even:bg-card/40"
          >
            <Td align="left">
              <span className="block max-w-[260px] truncate">
                {row.value_label}
              </span>
            </Td>
            <Td align="right">{fmtInt(row.ad_count)}</Td>
            <Td align="right">{fmtCurrency(row.spend)}</Td>
            <Td align="right">{fmtInt(row.impressions)}</Td>
            <Td align="right">{fmtInt(row.reach)}</Td>
            <Td align="right">{fmtInt(row.clicks)}</Td>
            <Td align="right">{fmtPct(row.ctr)}</Td>
            {!isBrandCampaign ? (
              <Td align="right">{fmtInt(row.registrations)}</Td>
            ) : null}
            {!isBrandCampaign ? (
              <Td align="right">{fmtMoneyOrDash(row.cpr)}</Td>
            ) : null}
            {!isBrandCampaign ? (
              <Td align="right">{fmtInt(row.purchases)}</Td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatDimension(value: string): string {
  return value.replace(/_/g, " ");
}

function fmtInt(value: number): string {
  return Math.round(value).toLocaleString("en-GB");
}

function fmtPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

function fmtMoneyOrDash(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return fmtCurrency(value);
}

function secondaryMetric(
  tile: CreativeTagTile,
  isBrandCampaign: boolean,
): { label: string; value: string } {
  if (!isBrandCampaign) {
    return { label: "Purch", value: fmtInt(tile.purchases) };
  }
  if (tile.registrations > 0) {
    return { label: "Regs", value: fmtInt(tile.registrations) };
  }
  if (tile.impressions > 0) {
    return { label: "Impr", value: fmtInt(tile.impressions) };
  }
  if (tile.reach > 0) {
    return { label: "Reach", value: fmtInt(tile.reach) };
  }
  return { label: "Clicks", value: fmtInt(tile.clicks) };
}

function initials(label: string): string {
  const words = label
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0]).join("");
  return letters || "?";
}

function Th({
  children,
  align = "right",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-2 font-medium ${
        align === "left" ? "text-left" : "text-right"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "right",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td className={`px-3 py-2 ${align === "left" ? "text-left" : "text-right"}`}>
      {children}
    </td>
  );
}
