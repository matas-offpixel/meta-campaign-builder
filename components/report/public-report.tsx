import { fmtCurrency, fmtDate } from "@/lib/dashboard/format";
import type { EventInsightsPayload } from "@/lib/insights/types";

import { CreativePerformanceLazy } from "./creative-performance-lazy";

interface PublicReportEvent {
  name: string;
  venueName: string | null;
  venueCity: string | null;
  venueCountry: string | null;
  eventDate: string | null;
  eventStartAt: string | null;
  paidMediaBudget: number | null;
}

interface Props {
  event: PublicReportEvent;
  insights: EventInsightsPayload;
  /**
   * Token is needed by the lazy creative loader (it calls
   * `/api/share/report/[token]/creatives`). It IS the public identifier
   * for this report — already in the URL, so rendering it inside the page
   * doesn't add any new exposure.
   */
  shareToken: string;
}

/**
 * Read-only e-labs-style event report. No tabs, no edit controls, no
 * filters beyond the implicit "All time" window.
 *
 * Internal IDs (event_id, client_id, user_id, ad_account_id) deliberately
 * do not appear in props — only the public token. data-* attributes are
 * limited to layout markers; nothing carries an internal identifier.
 */
export function PublicReport({ event, insights, shareToken }: Props) {
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

  const channelMultiActive = isMultiChannelActive(insights);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <ReportHeader
        eventName={event.name}
        venue={venue}
        eventDateLabel={eventDateLabel}
      />

      <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
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

        {/* Campaign performance — high-level money */}
        <Section title="Campaign performance">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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

        {/* Creative performance — lazy load */}
        <Section title="Creative performance">
          <CreativePerformanceLazy shareToken={shareToken} />
        </Section>
      </div>

      <ReportFooter fetchedAt={insights.fetchedAt} />
    </main>
  );
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
