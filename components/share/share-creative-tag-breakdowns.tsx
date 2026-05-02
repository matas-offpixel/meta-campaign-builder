import type { ReactNode } from "react";

import type { CreativeTagAssignmentWithTag } from "@/lib/reporting/creative-tag-breakdowns";
import {
  buildCreativeTagBreakdowns,
  type CreativeTagBreakdown,
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
        <div key={breakdown.dimension} className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {formatDimension(breakdown.dimension)}
          </h4>
          <div className="overflow-x-auto rounded-md border border-border">
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
                    key={row.value_label}
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
          </div>
        </div>
      ))}
    </div>
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
