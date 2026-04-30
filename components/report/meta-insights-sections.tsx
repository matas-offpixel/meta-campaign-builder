"use client";

import { fmtCurrency } from "@/lib/dashboard/format";
import {
  campaignStatusReasonLabel,
  campaignStatusLabel,
  campaignStatusTone,
  sortCampaignsByStatusThenSpend,
} from "@/lib/insights/campaign-status";
import type { CampaignStatusReason } from "@/lib/insights/campaign-status";
import type { EventInsightsPayload } from "@/lib/insights/types";

export function MetaCampaignStatsSection({
  meta,
  isRefreshing = false,
}: {
  meta: EventInsightsPayload;
  isRefreshing?: boolean;
}) {
  return (
    <Section title="Meta campaign stats">
      <div
        className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${
          isRefreshing ? "opacity-60 transition-opacity" : ""
        }`}
      >
        <Metric label="Spend" value={fmtCurrency(meta.totals.spend)} />
        <Metric label="Impressions" value={fmtInt(meta.totals.impressions)} />
        <Metric label="Reach (sum)" value={fmtInt(meta.totals.reachSum)} />
        <Metric
          label="Landing page views"
          value={fmtInt(meta.totals.landingPageViews)}
          sub={formatCostPerSub(
            meta.totalSpend,
            meta.totals.landingPageViews,
            "LPV",
          )}
        />
        <Metric
          label="Clicks"
          value={fmtInt(meta.totals.clicks)}
          sub={formatCostPerSub(meta.totalSpend, meta.totals.clicks, "click")}
        />
        <Metric
          label="Registrations"
          value={fmtInt(meta.totals.registrations)}
        />
        <Metric label="Purchases" value={fmtInt(meta.totals.purchases)} />
        <Metric label="ROAS" value={fmtRoas(meta.totals.roas)} />
        <Metric
          label="Purchase value"
          value={fmtCurrency(meta.totals.purchaseValue)}
        />
        <Metric label="CPM" value={fmtCurrency(meta.totals.cpm)} />
        <Metric label="Frequency" value={fmtDecimal(meta.totals.frequency)} />
        <Metric label="CPR" value={fmtCurrency(meta.totals.cpr)} />
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Reach (sum)</span> is
        summed across campaigns — not deduplicated unique reach across the
        event. A user reached by more than one campaign is counted once per
        campaign. Frequency is derived from the same sum and is therefore a
        conservative under-estimate. Per-campaign rows below show each
        campaign&rsquo;s deduplicated reach.
      </p>
    </Section>
  );
}

export function MetaCampaignBreakdownSection({
  meta,
}: {
  meta: EventInsightsPayload;
}) {
  const campaigns = sortCampaignsByStatusThenSpend(meta.campaigns);

  return (
    <Section title="Meta campaign breakdown">
      {meta.campaigns.length === 0 ? (
        <EmptyHint>No matched Meta campaigns yet.</EmptyHint>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[780px] border-collapse text-xs">
            <thead className="bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <Th align="left">Campaign</Th>
                <Th>Status</Th>
                <Th align="right">Spend</Th>
                <Th align="right">Regs</Th>
                <Th align="right">LPV</Th>
                <Th align="right">Purch</Th>
                <Th align="right">Reach</Th>
                <Th align="right">Impr</Th>
                <Th align="right">CPR</Th>
                <Th align="right">CPA</Th>
                <Th align="right">CPLPV</Th>
                <Th align="right">ROAS</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-border odd:bg-background even:bg-card/40"
                >
                  <Td align="left">
                    <span className="block max-w-[260px] truncate">
                      {c.name}
                    </span>
                  </Td>
                  <Td>
                    <StatusChip status={c.status} reason={c.statusReason} />
                  </Td>
                  <Td align="right">{fmtCurrency(c.spend)}</Td>
                  <Td align="right">{fmtInt(c.registrations)}</Td>
                  <Td align="right">{fmtInt(c.landingPageViews)}</Td>
                  <Td align="right">{fmtInt(c.purchases)}</Td>
                  <Td align="right">{fmtInt(c.reach)}</Td>
                  <Td align="right">{fmtInt(c.impressions)}</Td>
                  <Td align="right">{c.cpr > 0 ? fmtCurrency(c.cpr) : "—"}</Td>
                  <Td align="right">{c.purchases > 0 ? fmtCurrency(c.cpp) : "—"}</Td>
                  <Td align="right">
                    {c.cplpv > 0 ? fmtCurrency(c.cplpv) : "—"}
                  </Td>
                  <Td align="right">{fmtRoas(c.roas)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-base tracking-wide text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm text-foreground">{value}</p>
      {sub ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}

export function Th({
  children,
  align = "center",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  const alignClass =
    align === "left"
      ? "text-left"
      : align === "right"
        ? "text-right"
        : "text-center";
  return (
    <th className={`px-3 py-2 ${alignClass} font-medium`}>{children}</th>
  );
}

export function Td({
  children,
  align = "center",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  const alignClass =
    align === "left"
      ? "text-left"
      : align === "right"
        ? "text-right"
        : "text-center";
  return <td className={`px-3 py-2 ${alignClass}`}>{children}</td>;
}

export function StatusChip({
  status,
  reason,
}: {
  status: string;
  reason?: CampaignStatusReason;
}) {
  const tone = campaignStatusTone(status);
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
      >
        {campaignStatusLabel(status)}
      </span>
      {reason ? (
        <span className="text-[10px] leading-none text-muted-foreground">
          {campaignStatusReasonLabel(reason)}
        </span>
      ) : null}
    </span>
  );
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

export function fmtDecimal(n: number): string {
  return n > 0 ? n.toFixed(2) : "—";
}

export function fmtRoas(n: number): string {
  return n > 0 ? `${n.toFixed(2)}×` : "—";
}

function formatCostPerSub(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  unit: string,
): string | null {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  const value = numerator / denominator;
  if (!Number.isFinite(value)) return null;
  const formatted = value.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} per ${unit}`;
}
