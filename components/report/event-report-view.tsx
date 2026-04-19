"use client";

import { useState } from "react";

import { fmtCurrency, fmtDate } from "@/lib/dashboard/format";
import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  type CustomDateRange,
  type DatePreset,
  type EventInsightsPayload,
} from "@/lib/insights/types";

import { CreativePerformanceLazy } from "./creative-performance-lazy";

/**
 * components/report/event-report-view.tsx
 *
 * Shared report layout used by BOTH the public share page
 * (`app/share/report/[token]/page.tsx`) and the internal Reporting tab
 * mirror (`components/report/internal-event-report.tsx`). Single source
 * of truth so the two views never drift visually.
 *
 * Client component because the timeframe selector is interactive.
 * The two callsites differ only in HOW the timeframe change is plumbed:
 *
 *   - Public  → URL state (`router.push("?tf=…")` → RSC re-renders).
 *   - Internal → local state (`setDatePreset` → re-fetch via /api/insights).
 *
 * `creativesSource` is a discriminated union so the lazy creative panel
 * can hit the right route (share or internal) without this layout
 * needing to know which surface it's rendering on.
 */

export interface EventReportViewEvent {
  name: string;
  venueName: string | null;
  venueCity: string | null;
  venueCountry: string | null;
  eventDate: string | null;
  eventStartAt: string | null;
  paidMediaBudget: number | null;
  ticketsSold: number | null;
  /**
   * Where `ticketsSold` came from:
   *   - "plan"    → latest ad_plan_days.tickets_sold_cumulative
   *   - "manual"  → events.tickets_sold (override input)
   *   - null      → no figure recorded yet
   * Drives the StatCard sub-line + the read-only / editable mode of
   * the TicketsSoldPanel on the internal Reporting tab.
   */
  ticketsSoldSource?: "plan" | "manual" | null;
  /**
   * Plan-day date that supplied `ticketsSold` when `ticketsSoldSource ===
   * "plan"`. Surfaced in the StatCard sub-line as "From campaign plan ·
   * {date}". Null for manual / not-yet-recorded.
   */
  ticketsSoldAsOf?: string | null;
}

export type CreativesSource =
  | { kind: "share"; token: string }
  | { kind: "internal"; eventId: string };

interface Props {
  event: EventReportViewEvent;
  insights: EventInsightsPayload;
  datePreset: DatePreset;
  /**
   * Active custom range when `datePreset === "custom"`. Drives the
   * highlighted "{from} → {to}" label in the dedicated picker row.
   * Required for the picker row to seed its inputs on first paint;
   * undefined for any preset.
   */
  customRange?: CustomDateRange;
  creativesSource: CreativesSource;
  /**
   * Called when the visitor picks a new timeframe.
   *   - Public  → router.push with ?tf=<preset> on the same pathname,
   *     plus from/to when preset === "custom".
   *   - Internal → setDatePreset state + refetch the insights route.
   * The `customRange` argument is required when `preset === "custom"`,
   * absent for all preset values.
   */
  onTimeframeChange: (
    preset: DatePreset,
    customRange?: CustomDateRange,
  ) => void;
  /**
   * True while a parent is re-fetching insights for a new preset. Greys
   * out the timeframe buttons + dims the metric grid so the visitor
   * gets feedback that the click landed. Optional — defaults to false.
   */
  isRefreshing?: boolean;
  /**
   * Layout mode.
   *   - "standalone" (default): full-page chrome — wrapping `<main>`
   *     with min-h-screen, big report header, "Powered by Off Pixel"
   *     footer. Used by the public share page.
   *   - "embedded": no `<main>`, no header, no footer — just the
   *     report body. Used inside the internal Reporting tab where
   *     the dashboard already provides chrome + page header.
   */
  variant?: "standalone" | "embedded";
}

export function EventReportView({
  event,
  insights,
  datePreset,
  customRange,
  creativesSource,
  onTimeframeChange,
  isRefreshing = false,
  variant = "standalone",
}: Props) {
  const venue = [event.venueName, event.venueCity, event.venueCountry]
    .filter(Boolean)
    .join(", ");

  const eventDateLabel = event.eventDate ? fmtDate(event.eventDate) : "—";

  const daysUntil = computeDaysUntil(event.eventDate);
  const budget = event.paidMediaBudget ?? 0;
  const spend = insights.totals.spend;
  const remaining = Math.max(0, budget - spend);
  const budgetUsedPct =
    budget > 0 ? Math.min(100, (spend / budget) * 100) : null;

  // Tickets sold + cost per ticket. Null/zero ticket counts render
  // as em-dash to avoid misleading clients with a £Infinity / £NaN.
  const ticketsSold = event.ticketsSold;
  const totalSpend = insights.totalSpend;
  const costPerTicket =
    ticketsSold && ticketsSold > 0 && totalSpend > 0
      ? totalSpend / ticketsSold
      : null;

  const channelMultiActive = isMultiChannelActive(insights);

  // Embedded mode skips the standalone chrome (the dashboard's
  // PageHeader already shows event name + venue + date) and renders the
  // report body inline so the Reporting tab doesn't end up with two
  // headers stacked.
  const Outer = variant === "standalone" ? "main" : "div";
  const outerClass =
    variant === "standalone"
      ? "min-h-screen bg-background text-foreground"
      : "";
  const bodyClass =
    variant === "standalone"
      ? "mx-auto max-w-6xl space-y-8 px-6 py-10"
      : "space-y-8";

  return (
    <Outer className={outerClass}>
      {variant === "standalone" ? (
        <ReportHeader
          eventName={event.name}
          venue={venue}
          eventDateLabel={eventDateLabel}
        />
      ) : null}

      <div className={bodyClass}>
        {/* Top row — event-level facts */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatCard
            label="Days until event"
            value={daysUntil != null ? daysUntilLabel(daysUntil) : "—"}
            sub={event.eventDate ? fmtDate(event.eventDate) : null}
          />
          <StatCard
            label="Paid media budget"
            value={budget > 0 ? fmtCurrency(budget) : "—"}
            sub={
              budgetUsedPct != null
                ? `${budgetUsedPct.toFixed(0)}% used`
                : null
            }
          />
        </section>

        {/* Timeframe selector — shared with both surfaces */}
        <div className="space-y-2">
          <TimeframeSelector
            active={datePreset}
            disabled={isRefreshing}
            onChange={(preset) => onTimeframeChange(preset)}
          />
          <CustomRangePicker
            active={datePreset === "custom"}
            disabled={isRefreshing}
            initialRange={customRange ?? null}
            onApply={(range) => onTimeframeChange("custom", range)}
          />
        </div>

        {/* Campaign performance — high-level money + tickets */}
        <Section title="Campaign performance">
          <div
            className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 ${
              isRefreshing ? "opacity-60 transition-opacity" : ""
            }`}
          >
            <StatCard label="Total spend" value={fmtCurrency(insights.totalSpend)} />
            <StatCard label="Meta spend" value={fmtCurrency(insights.totals.spend)} />
            <StatCard
              label="Budget used"
              value={
                budget > 0
                  ? `${((spend / budget) * 100).toFixed(0)}%`
                  : "—"
              }
              sub={budget > 0 ? fmtCurrency(spend) : null}
            />
            <StatCard
              label="Budget remaining"
              value={budget > 0 ? fmtCurrency(remaining) : "—"}
            />
            <StatCard
              label="Tickets sold"
              value={ticketsSold != null ? fmtInt(ticketsSold) : "—"}
              sub={resolveTicketsSoldSub(event)}
            />
            <StatCard
              label="Cost per ticket"
              value={costPerTicket != null ? fmtCurrency(costPerTicket) : "—"}
              sub={
                costPerTicket != null
                  ? `${fmtInt(ticketsSold!)} tickets`
                  : ticketsSold === 0
                    ? "0 tickets sold"
                    : null
              }
            />
          </div>
          {channelMultiActive ? (
            <ChannelBreakdownStrip
              meta={insights.channelBreakdown.meta}
              tiktok={insights.channelBreakdown.tiktok}
              google={insights.channelBreakdown.google}
            />
          ) : null}
        </Section>

        {/* Meta campaign stats — flat metric grid */}
        <Section title="Meta campaign stats">
          <div
            className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${
              isRefreshing ? "opacity-60 transition-opacity" : ""
            }`}
          >
            <Metric label="Spend" value={fmtCurrency(insights.totals.spend)} />
            <Metric
              label="Impressions"
              value={fmtInt(insights.totals.impressions)}
            />
            {/*
              "Reach (sum)" — explicitly labelled so a client can't read
              this as deduped unique reach across the event. The aside
              below the grid spells out the caveat.
            */}
            <Metric
              label="Reach (sum)"
              value={fmtInt(insights.totals.reachSum)}
            />
            <Metric
              label="Landing page views"
              value={fmtInt(insights.totals.landingPageViews)}
            />
            <Metric label="Clicks" value={fmtInt(insights.totals.clicks)} />
            <Metric
              label="Registrations"
              value={fmtInt(insights.totals.registrations)}
            />
            <Metric
              label="Purchases"
              value={fmtInt(insights.totals.purchases)}
            />
            <Metric label="ROAS" value={fmtRoas(insights.totals.roas)} />
            <Metric
              label="Purchase value"
              value={fmtCurrency(insights.totals.purchaseValue)}
            />
            <Metric label="CPM" value={fmtCurrency(insights.totals.cpm)} />
            <Metric
              label="Frequency"
              value={fmtDecimal(insights.totals.frequency)}
            />
            <Metric label="CPR" value={fmtCurrency(insights.totals.cpr)} />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Reach (sum)</span> is
            summed across campaigns — not deduplicated unique reach across the
            event. A user reached by more than one campaign is counted once
            per campaign. Frequency is derived from the same sum and is
            therefore a conservative under-estimate. Per-campaign rows below
            show each campaign&rsquo;s deduplicated reach.
          </p>
        </Section>

        {/* Per-campaign breakdown table */}
        <Section title="Meta campaign breakdown">
          {insights.campaigns.length === 0 ? (
            <EmptyHint>No matched Meta campaigns yet.</EmptyHint>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[720px] border-collapse text-xs">
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
                    <Th align="right">CPLPV</Th>
                    <Th align="right">ROAS</Th>
                  </tr>
                </thead>
                <tbody>
                  {insights.campaigns.map((c) => (
                    <tr
                      key={c.id}
                      className="border-t border-border odd:bg-background even:bg-card/40"
                    >
                      {/*
                        Campaign name can leak the bracket-wrapped event_code
                        (e.g. "[UTB0042-New] Awareness"). That's fine — the
                        code is intentionally human-readable and the client
                        already knows their event. Numeric internal IDs
                        (campaign.id) are NOT rendered.
                      */}
                      <Td align="left">
                        <span className="block max-w-[260px] truncate">
                          {c.name}
                        </span>
                      </Td>
                      <Td>
                        <StatusChip status={c.status} />
                      </Td>
                      <Td align="right">{fmtCurrency(c.spend)}</Td>
                      <Td align="right">{fmtInt(c.registrations)}</Td>
                      <Td align="right">{fmtInt(c.landingPageViews)}</Td>
                      <Td align="right">{fmtInt(c.purchases)}</Td>
                      <Td align="right">{fmtInt(c.reach)}</Td>
                      <Td align="right">{fmtInt(c.impressions)}</Td>
                      <Td align="right">
                        {c.cpr > 0 ? fmtCurrency(c.cpr) : "—"}
                      </Td>
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

        {/* Creative performance — lazy load, source-aware (share vs internal) */}
        <Section title="Creative performance">
          <CreativePerformanceLazy
            source={creativesSource}
            datePreset={datePreset}
            customRange={customRange}
          />
        </Section>
      </div>

      {variant === "standalone" ? (
        <ReportFooter fetchedAt={insights.fetchedAt} />
      ) : (
        <p className="pt-4 text-right text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Last updated {fmtRelativeShort(insights.fetchedAt)} · refreshes every 5 minutes
        </p>
      )}
    </Outer>
  );
}

// ─── Tickets sold sub-line ─────────────────────────────────────────────────

function resolveTicketsSoldSub(event: EventReportViewEvent): string | null {
  if (event.ticketsSold == null) return "Not yet recorded";
  if (event.ticketsSoldSource === "plan" && event.ticketsSoldAsOf) {
    return `From campaign plan · ${fmtDate(event.ticketsSoldAsOf)}`;
  }
  if (event.ticketsSold === 0) return "0 to date";
  return null;
}

// ─── Timeframe selector ────────────────────────────────────────────────────

function TimeframeSelector({
  active,
  disabled,
  onChange,
}: {
  active: DatePreset;
  disabled: boolean;
  onChange: (preset: DatePreset) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Timeframe
      </p>
      <div className="flex flex-wrap gap-1.5">
        {DATE_PRESETS.map((p) => {
          // "custom" lives in its own picker row below — DATE_PRESETS
          // omits it deliberately, so active==="custom" naturally
          // leaves every preset button un-highlighted.
          const isActive = p === active;
          return (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() => onChange(p)}
              className={`rounded-md border px-2.5 py-1 text-[11px] tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50 ${
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground"
              }`}
            >
              {DATE_PRESET_LABELS[p]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Custom range picker ──────────────────────────────────────────────────

/**
 * From / To date inputs that own their own "draft" state until the user
 * hits Apply. Decoupling the inputs from the active range avoids firing
 * a Meta call on each keystroke and lets the user freely flip between
 * "since" and "until" without intermediate fetches.
 *
 * `min` is today - 37 months (Meta's retention cap); `max` is today UTC
 * (no future windows). Both bounds match the server-side validator in
 * `lib/insights/meta.ts#resolveCustomRange` so a successful client-side
 * Apply never fails server-side validation.
 */
function CustomRangePicker({
  active,
  disabled,
  initialRange,
  onApply,
}: {
  active: boolean;
  disabled: boolean;
  initialRange: CustomDateRange | null;
  onApply: (range: CustomDateRange) => void;
}) {
  const todayIso = todayIsoUtc();
  const minIso = minSinceIsoUtc();

  const [from, setFrom] = useState<string>(initialRange?.since ?? "");
  const [to, setTo] = useState<string>(initialRange?.until ?? "");

  // Re-seed the draft inputs when the parent's `initialRange` shifts —
  // e.g. navigating between two share URLs that differ only in
  // ?from / ?to. React 19's `react-hooks/set-state-in-effect` rules out
  // the obvious `useEffect(() => setFrom(...))` shape, so we use the
  // "adjust state in render" pattern: track the parent range as a
  // string and trigger the re-seed synchronously when it differs.
  // No extra render commit, no stale-data window.
  const initialKey = `${initialRange?.since ?? ""}|${initialRange?.until ?? ""}`;
  const [trackedKey, setTrackedKey] = useState<string>(initialKey);
  if (trackedKey !== initialKey) {
    setTrackedKey(initialKey);
    setFrom(initialRange?.since ?? "");
    setTo(initialRange?.until ?? "");
  }

  const isValid =
    from !== "" &&
    to !== "" &&
    from >= minIso &&
    to <= todayIso &&
    from <= to;

  const handleApply = () => {
    if (!isValid) return;
    onApply({ since: from, until: to });
  };

  const activeLabel =
    active && initialRange
      ? `${fmtDate(initialRange.since)} → ${fmtDate(initialRange.until)}`
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`flex flex-wrap items-end gap-2 rounded-md border px-2.5 py-2 transition ${
          active
            ? "border-primary bg-primary/5"
            : "border-border bg-background"
        }`}
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            From
          </span>
          <input
            type="date"
            min={minIso}
            max={todayIso}
            value={from}
            disabled={disabled}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border-strong bg-background px-2 py-1 text-[12px] text-foreground disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            To
          </span>
          <input
            type="date"
            min={minIso}
            max={todayIso}
            value={to}
            disabled={disabled}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border-strong bg-background px-2 py-1 text-[12px] text-foreground disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          disabled={disabled || !isValid}
          onClick={handleApply}
          className="rounded-md border border-primary bg-primary px-2.5 py-1 text-[11px] font-medium tracking-wide text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply
        </button>
        {activeLabel ? (
          <span className="text-[11px] font-medium tracking-wide text-primary">
            {activeLabel}
          </span>
        ) : (
          <span className="text-[11px] tracking-wide text-muted-foreground">
            Custom range
          </span>
        )}
      </div>
      {from !== "" && to !== "" && from > to ? (
        <p className="text-[10px] text-destructive">
          From date must be on or before To date.
        </p>
      ) : null}
    </div>
  );
}

function todayIsoUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function minSinceIsoUtc(): string {
  const d = new Date();
  // Meta retention is 37 months; using setUTCMonth handles month-length
  // wrap-around correctly.
  d.setUTCMonth(d.getUTCMonth() - 37);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// ─── Header / footer ───────────────────────────────────────────────────────

function ReportHeader({
  eventName,
  venue,
  eventDateLabel,
}: {
  eventName: string;
  venue: string;
  eventDateLabel: string;
}) {
  return (
    <header className="border-b border-border bg-background px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Event Report by Off Pixel
        </p>
        <h1 className="font-heading text-3xl tracking-wide text-foreground">
          {eventName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {[venue || null, eventDateLabel || null]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
      </div>
    </header>
  );
}

function ReportFooter({ fetchedAt }: { fetchedAt: string }) {
  return (
    <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
      <p>Powered by Off Pixel</p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.2em]">
        Last updated {fmtRelativeShort(fetchedAt)} · refreshes every 5 minutes
      </p>
    </footer>
  );
}

// ─── Layout primitives ────────────────────────────────────────────────────

function Section({
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

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-heading text-xl tracking-wide text-foreground">
        {value}
      </p>
      {sub ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === "ACTIVE"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : status.includes("PAUSED")
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
    >
      {status.toLowerCase().replaceAll("_", " ")}
    </span>
  );
}

function Th({
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

function Td({
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
    <td className={`px-3 py-2 ${alignClass}`}>{children}</td>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function ChannelBreakdownStrip({
  meta,
  tiktok,
  google,
}: {
  meta: number;
  tiktok: number | null;
  google: number | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Metric label="Meta" value={fmtCurrency(meta)} />
      {tiktok != null ? (
        <Metric label="TikTok" value={fmtCurrency(tiktok)} />
      ) : null}
      {google != null ? (
        <Metric label="Google" value={fmtCurrency(google)} />
      ) : null}
    </div>
  );
}

// ─── Formatters ────────────────────────────────────────────────────────────

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

function fmtDecimal(n: number): string {
  return n > 0 ? n.toFixed(2) : "—";
}

function fmtRoas(n: number): string {
  return n > 0 ? `${n.toFixed(2)}×` : "—";
}

function fmtRelativeShort(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "just now";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return `${Math.round(diff / 86_400_000)} d ago`;
}

function computeDaysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = Date.parse(`${iso}T00:00:00`);
  if (!Number.isFinite(target)) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now.getTime()) / 86_400_000);
}

function daysUntilLabel(d: number): string {
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d > 1) return `${d} days`;
  if (d === -1) return "Yesterday";
  return `${Math.abs(d)} days ago`;
}

function isMultiChannelActive(p: EventInsightsPayload): boolean {
  return (
    p.channelBreakdown.tiktok != null || p.channelBreakdown.google != null
  );
}
