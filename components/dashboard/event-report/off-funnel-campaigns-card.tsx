"use client";

import Link from "next/link";

import type { OffFunnelAuditRow } from "@/lib/dashboard/off-funnel-audit";

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function hostPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

export function OffFunnelCampaignsCard({
  rows,
}: {
  rows: OffFunnelAuditRow[];
}) {
  if (rows.length === 0) return null;

  return (
    <section
      data-testid="off-funnel-campaigns"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div>
        <h3 className="font-heading text-base tracking-wide">
          Live campaigns pointing off-funnel
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          These still send traffic somewhere other than the event page, so
          views will not appear in the funnel. Spend is the snapshot window
          — a leftover pound or two is usually not worth a relaunch.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <th className="px-2 py-2 font-medium">Campaign</th>
              <th className="px-2 py-2 font-medium">Platform</th>
              <th className="px-2 py-2 font-medium">Destination</th>
              <th className="px-2 py-2 font-medium">Event</th>
              <th className="px-2 py-2 font-medium text-right">Spend</th>
              <th className="px-2 py-2 font-medium"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.platform}:${row.campaignId}`}
                className="border-t border-border align-top"
              >
                <td className="px-2 py-2 font-medium">{row.campaignName}</td>
                <td className="px-2 py-2 capitalize text-muted-foreground">
                  {row.platform}
                </td>
                <td className="px-2 py-2">
                  <a
                    href={row.currentDestination}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-xs underline-offset-2 hover:underline"
                  >
                    {hostPath(row.currentDestination)}
                  </a>
                </td>
                <td className="px-2 py-2 text-muted-foreground">{row.eventName}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {GBP.format(row.spend)}
                </td>
                <td className="px-2 py-2">
                  <Link
                    href={row.action.href}
                    className="inline-flex rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary-hover"
                    title={row.action.reason}
                  >
                    {row.action.label}
                  </Link>
                  <p className="mt-1 max-w-xs text-[11px] text-muted-foreground">
                    {row.action.reason}
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
