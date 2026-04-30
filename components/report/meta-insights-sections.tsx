"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { fmtCurrency } from "@/lib/dashboard/format";
import {
  campaignStatusReasonLabel,
  campaignStatusLabel,
  campaignStatusTone,
  sortCampaignsByStatusThenSpend,
} from "@/lib/insights/campaign-status";
import type { CampaignStatusReason } from "@/lib/insights/campaign-status";
import type { EventInsightsPayload } from "@/lib/insights/types";
import type { MetaDemographicRow } from "@/lib/insights/types";

export function MetaCampaignStatsSection({
  meta,
  isRefreshing = false,
  kind = "event",
}: {
  meta: EventInsightsPayload;
  isRefreshing?: boolean;
  kind?: "event" | "brand_campaign";
}) {
  const isBrandCampaign = kind === "brand_campaign";
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
        {!isBrandCampaign ? (
          <Metric
            label="Landing page views"
            value={fmtInt(meta.totals.landingPageViews)}
            sub={formatCostPerSub(
              meta.totalSpend,
              meta.totals.landingPageViews,
              "LPV",
            )}
          />
        ) : null}
        <Metric
          label="Clicks"
          value={fmtInt(meta.totals.clicks)}
          sub={formatCostPerSub(meta.totalSpend, meta.totals.clicks, "click")}
        />
        {isBrandCampaign ? (
          <Metric
            label="CTR"
            value={fmtPct(rate(meta.totals.clicks, meta.totals.impressions))}
          />
        ) : null}
        {!isBrandCampaign ? (
          <Metric label="Registrations" value={fmtInt(meta.totals.registrations)} />
        ) : null}
        {!isBrandCampaign ? (
          <Metric label="Purchases" value={fmtInt(meta.totals.purchases)} />
        ) : null}
        {!isBrandCampaign ? <Metric label="ROAS" value={fmtRoas(meta.totals.roas)} /> : null}
        {!isBrandCampaign ? (
          <Metric label="Purchase value" value={fmtCurrency(meta.totals.purchaseValue)} />
        ) : null}
        <Metric label="CPM" value={fmtCurrency(meta.totals.cpm)} />
        <Metric label="Frequency" value={fmtDecimal(meta.totals.frequency)} />
        {!isBrandCampaign ? <Metric label="CPR" value={fmtCurrency(meta.totals.cpr)} /> : null}
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
  kind = "event",
}: {
  meta: EventInsightsPayload;
  kind?: "event" | "brand_campaign";
}) {
  const campaigns = sortCampaignsByStatusThenSpend(meta.campaigns);
  const isBrandCampaign = kind === "brand_campaign";

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
                {!isBrandCampaign ? <Th align="right">Regs</Th> : null}
                {!isBrandCampaign ? <Th align="right">LPV</Th> : null}
                {!isBrandCampaign ? <Th align="right">Purch</Th> : null}
                <Th align="right">Impr</Th>
                <Th align="right">Reach</Th>
                {isBrandCampaign ? <Th align="right">Clicks</Th> : null}
                {isBrandCampaign ? <Th align="right">CTR</Th> : null}
                {isBrandCampaign ? <Th align="right">CPM</Th> : null}
                {!isBrandCampaign ? <Th align="right">CPR</Th> : null}
                {!isBrandCampaign ? <Th align="right">CPA</Th> : null}
                {!isBrandCampaign ? <Th align="right">CPLPV</Th> : null}
                {!isBrandCampaign ? <Th align="right">ROAS</Th> : null}
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
                  {!isBrandCampaign ? <Td align="right">{fmtInt(c.registrations)}</Td> : null}
                  {!isBrandCampaign ? <Td align="right">{fmtInt(c.landingPageViews)}</Td> : null}
                  {!isBrandCampaign ? <Td align="right">{fmtInt(c.purchases)}</Td> : null}
                  <Td align="right">{fmtInt(c.impressions)}</Td>
                  <Td align="right">{fmtInt(c.reach)}</Td>
                  {isBrandCampaign ? <Td align="right">{fmtInt(c.clicks)}</Td> : null}
                  {isBrandCampaign ? <Td align="right">{fmtPct(rate(c.clicks, c.impressions))}</Td> : null}
                  {isBrandCampaign ? <Td align="right">{c.impressions > 0 ? fmtCurrency((c.spend / c.impressions) * 1000) : "—"}</Td> : null}
                  {!isBrandCampaign ? <Td align="right">{c.cpr > 0 ? fmtCurrency(c.cpr) : "—"}</Td> : null}
                  {!isBrandCampaign ? <Td align="right">{c.purchases > 0 ? fmtCurrency(c.cpp) : "—"}</Td> : null}
                  {!isBrandCampaign ? (
                    <Td align="right">
                      {c.cplpv > 0 ? fmtCurrency(c.cplpv) : "—"}
                    </Td>
                  ) : null}
                  {!isBrandCampaign ? <Td align="right">{fmtRoas(c.roas)}</Td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function MetaDemographicsSection({ meta }: { meta: EventInsightsPayload }) {
  const demographics = meta.demographics;
  if (!demographics) return null;
  return (
    <>
      <BreakdownSection title="Top regions" defaultOpen>
        <DemographicTable rows={demographics.regions} emptyLabel="No Meta region rows available yet." />
      </BreakdownSection>
      <BreakdownSection title="Demographics — Age" defaultOpen>
        <DemographicTable rows={demographics.ageRanges} emptyLabel="No Meta age rows available yet." />
      </BreakdownSection>
      <BreakdownSection title="Demographics — Gender" defaultOpen>
        <DemographicTable rows={demographics.genders} emptyLabel="No Meta gender rows available yet." />
      </BreakdownSection>
    </>
  );
}

function BreakdownSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-md border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-5 py-3 text-left"
        onClick={() => setOpen((s) => !s)}
      >
        <h3 className="font-heading text-sm tracking-wide">{title}</h3>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && <div className="border-t border-border px-5 py-4">{children}</div>}
    </section>
  );
}

function DemographicTable({
  rows,
  emptyLabel,
}: {
  rows: MetaDemographicRow[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  const top = rows.slice(0, 10);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="pb-2">Segment</th>
            <th className="pb-2 text-right">Spend</th>
            <th className="pb-2 text-right">Impr.</th>
            <th className="pb-2 text-right">Reach</th>
            <th className="pb-2 text-right">Clicks</th>
            <th className="pb-2 text-right">CTR</th>
          </tr>
        </thead>
        <tbody>
          {top.map((row) => (
            <tr key={row.label} className="border-t border-border/40 text-foreground">
              <td className="py-1.5 pr-3">{row.label}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtCurrency(row.spend)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtInt(row.impressions)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtInt(row.reach)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtInt(row.clicks)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {fmtPct(rate(row.clicks, row.impressions))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function fmtPct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(2)}%`;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return (numerator / denominator) * 100;
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
