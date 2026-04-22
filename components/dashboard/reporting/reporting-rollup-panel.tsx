"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useWriteParams } from "@/components/dashboard/_shared/use-write-params";
import { compareToBenchmark } from "@/lib/reporting/benchmark-verdict";
import type { Aggregate } from "@/lib/reporting/aggregate";
import type {
  RollupBenchmark,
  RollupRow,
} from "@/lib/reporting/rollup-server";
import type { ClientRow } from "@/lib/db/clients";
import { fmtDate } from "@/lib/dashboard/format";

/**
 * components/dashboard/reporting/reporting-rollup-panel.tsx
 *
 * Cross-event reporting rollup. Owns:
 *   - Filter strip (client picker + date range + platform tabs).
 *     Filters are URL-driven so the server reload stays the source
 *     of truth — the panel doesn't refetch client-side.
 *   - KPI strip (5 cards) summarising the page-level totals.
 *   - Events table with one row per event in the window.
 *
 * Only the Meta tab is live; TikTok / Google Ads are placeholders that
 * mirror the per-event panel so flipping them on later is API-only.
 */

type PlatformId = "meta" | "tiktok" | "google-ads";

interface Props {
  rows: RollupRow[];
  totals: Aggregate;
  benchmarksByAccount: Record<string, RollupBenchmark>;
  window: { since: string; until: string };
  candidateEventsConsidered: number;
  /** Selected filters parsed from the URL on the server. */
  selected: {
    clientId: string | null;
    platform: PlatformId;
    since: string;
    until: string;
  };
  /** Client picker source — pre-loaded server-side to avoid a round-trip. */
  clients: Pick<ClientRow, "id" | "name">[];
}

const PLATFORMS: Array<{
  id: PlatformId;
  label: string;
  enabled: boolean;
}> = [
  { id: "meta", label: "Meta", enabled: true },
  { id: "tiktok", label: "TikTok", enabled: false },
  { id: "google-ads", label: "Google Ads", enabled: false },
];

export function ReportingRollupPanel({
  rows,
  totals,
  benchmarksByAccount,
  window,
  candidateEventsConsidered,
  selected,
  clients,
}: Props) {
  const { writeParams } = useWriteParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Local mirrors so the date/select inputs are responsive between
  // edit and the URL commit. We only push to the URL on blur / submit
  // to avoid one-key-stroke server round-trips.
  const [sinceLocal, setSinceLocal] = useState(selected.since);
  const [untilLocal, setUntilLocal] = useState(selected.until);

  const commitFilters = (overrides: Partial<typeof selected>) => {
    const next = { ...selected, ...overrides };
    startTransition(() => {
      writeParams((p) => {
        if (next.clientId) p.set("client", next.clientId);
        else p.delete("client");
        if (next.platform && next.platform !== "meta") p.set("platform", next.platform);
        else p.delete("platform");
        if (next.since) p.set("from", next.since);
        else p.delete("from");
        if (next.until) p.set("to", next.until);
        else p.delete("to");
      });
    });
  };

  const onClientChange = (value: string) =>
    commitFilters({ clientId: value === "all" ? null : value });

  const onSinceCommit = () => {
    if (sinceLocal && sinceLocal !== selected.since) commitFilters({ since: sinceLocal });
  };
  const onUntilCommit = () => {
    if (untilLocal && untilLocal !== selected.until) commitFilters({ until: untilLocal });
  };

  const onPlatformChange = (id: PlatformId) =>
    commitFilters({ platform: id });

  const eventsRendered = rows.length;
  const eventsWithMetaData = useMemo(
    () => rows.filter((r) => r.reason === null && r.metaCampaignsMatched > 0).length,
    [rows],
  );

  return (
    <main className="flex-1 px-6 py-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Filter strip */}
        <section className="rounded-md border border-border bg-card p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[180px] flex-1">
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                Client
              </label>
              <select
                value={selected.clientId ?? "all"}
                onChange={(e) => onClientChange(e.target.value)}
                disabled={isPending}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-border-strong focus:outline-none"
              >
                <option value="all">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                From
              </label>
              <input
                type="date"
                value={sinceLocal}
                onChange={(e) => setSinceLocal(e.target.value)}
                onBlur={onSinceCommit}
                disabled={isPending}
                className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-border-strong focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                To
              </label>
              <input
                type="date"
                value={untilLocal}
                onChange={(e) => setUntilLocal(e.target.value)}
                onBlur={onUntilCommit}
                disabled={isPending}
                className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-border-strong focus:outline-none"
              />
            </div>
            <div className="ml-auto">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Platform
              </div>
              <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => p.enabled && onPlatformChange(p.id)}
                    disabled={!p.enabled || isPending}
                    title={!p.enabled ? "Coming soon" : undefined}
                    className={[
                      "rounded px-2.5 py-1 text-xs",
                      selected.platform === p.id
                        ? "bg-foreground text-background"
                        : p.enabled
                          ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                          : "cursor-not-allowed text-muted-foreground/40",
                    ].join(" ")}
                  >
                    {p.label}
                    {!p.enabled && (
                      <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                        soon
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {selected.platform !== "meta" ? (
          <PlatformPlaceholder platform={selected.platform} />
        ) : (
          <>
            {/* KPI strip */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <KpiCard label="Spend" value={fmtCurrency(totals.spend)} />
              <KpiCard label="Impressions" value={fmtInt(totals.impressions)} />
              <KpiCard label="Clicks" value={fmtInt(totals.clicks)} />
              <KpiCard
                label="CTR"
                value={totals.ctr != null ? `${totals.ctr.toFixed(2)}%` : "—"}
              />
              <KpiCard
                label="Blended CPR"
                value={totals.cpr != null ? fmtCurrency(totals.cpr) : "—"}
              />
              <KpiCard
                label="CPM"
                value={totals.cpm != null ? fmtCurrency(totals.cpm) : "—"}
              />
            </section>

            {/* Events table */}
            <section className="rounded-md border border-border bg-card">
              <div className="border-b border-border p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-heading text-base tracking-wide">Events in window</h2>
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDate(window.since)} → {fmtDate(window.until)} · {eventsRendered}{" "}
                    {eventsRendered === 1 ? "event" : "events"} · {eventsWithMetaData} with
                    Meta data
                  </p>
                </div>
              </div>
              {eventsRendered === 0 ? (
                <EmptyRollupState
                  candidateEventsConsidered={candidateEventsConsidered}
                />
              ) : (
                <RollupTable
                  rows={rows}
                  benchmarksByAccount={benchmarksByAccount}
                  onRowClick={(eventId) =>
                    router.push(`/events/${eventId}?tab=reporting`)
                  }
                />
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-medium tabular-nums">{value}</p>
    </div>
  );
}

function PlatformPlaceholder({ platform }: { platform: PlatformId }) {
  const label = platform === "tiktok" ? "TikTok" : "Google Ads";
  return (
    <section className="rounded-md border border-dashed border-border bg-muted/20 p-8 text-center">
      <p className="text-sm font-medium">{label} rollup coming soon</p>
      <p className="mt-1 text-xs text-muted-foreground">
        The native adapter for this platform is not connected yet. Switch to the Meta tab
        for live cross-event performance.
      </p>
    </section>
  );
}

function EmptyRollupState({
  candidateEventsConsidered,
}: {
  candidateEventsConsidered: number;
}) {
  return (
    <div className="p-8 text-center">
      <p className="text-sm font-medium">No events to report on yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {candidateEventsConsidered === 0
          ? "Publish a Meta campaign linked to an event and it'll show up here. The rollup only counts campaigns with status='published' and an event_id set."
          : "Filters narrowed every event out. Try widening the date range or clearing the client filter."}
      </p>
    </div>
  );
}

function RollupTable({
  rows,
  benchmarksByAccount,
  onRowClick,
}: {
  rows: RollupRow[];
  benchmarksByAccount: Record<string, RollupBenchmark>;
  onRowClick: (eventId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pl-4 pr-3 font-medium">Event</th>
            <th className="py-2 px-2 font-medium">Client</th>
            <th className="py-2 px-2 font-medium">Date</th>
            <th className="py-2 px-2 text-right font-medium">Linked</th>
            <th className="py-2 px-2 text-right font-medium">Spend</th>
            <th className="py-2 px-2 text-right font-medium">CTR</th>
            <th className="py-2 px-2 text-right font-medium">CPR</th>
            <th className="py-2 pr-4 pl-2 text-right font-medium">Clicks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const account =
              (r.event.client?.meta_ad_account_id as string | null | undefined) ?? null;
            const baseline = account
              ? (benchmarksByAccount[normalise(account)] ?? null)
              : null;
            const ctrVerdict = compareToBenchmark(
              r.totals.ctr,
              baseline?.ctr ?? null,
              "higher-is-better",
            );
            const cprVerdict = compareToBenchmark(
              r.totals.cpr,
              baseline?.cpr ?? null,
              "lower-is-better",
            );
            return (
              <tr
                key={r.event.id}
                onClick={() => onRowClick(r.event.id)}
                className="cursor-pointer border-b border-border/60 hover:bg-muted/40"
              >
                <td className="py-2 pl-4 pr-3">
                  <div className="flex flex-col">
                    <span className="truncate font-medium text-foreground">
                      {r.event.name}
                    </span>
                    {r.reason && (
                      <span className="text-[10px] text-muted-foreground">
                        {reasonLabel(r.reason)}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 px-2 text-muted-foreground">
                  {r.event.client?.name ?? "—"}
                </td>
                <td className="py-2 px-2 text-muted-foreground">
                  {r.event.event_date ? fmtDate(r.event.event_date) : "TBD"}
                </td>
                <td className="py-2 px-2 text-right tabular-nums">
                  {r.linkedCampaignsCount}
                </td>
                <td className="py-2 px-2 text-right tabular-nums">
                  {fmtCurrency(r.totals.spend)}
                </td>
                <ColouredCell
                  value={r.totals.ctr}
                  verdict={ctrVerdict}
                  format={(v) => `${v.toFixed(2)}%`}
                />
                <ColouredCell
                  value={r.totals.cpr}
                  verdict={cprVerdict}
                  format={fmtCurrency}
                />
                <td className="py-2 pr-4 pl-2 text-right tabular-nums">
                  {fmtInt(r.totals.clicks)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ColouredCell({
  value,
  verdict,
  format,
}: {
  value: number | null;
  verdict: ReturnType<typeof compareToBenchmark>;
  format: (v: number) => string;
}) {
  const cls =
    verdict === "better"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : verdict === "worse"
        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
        : verdict === "neutral"
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
          : "";
  const title =
    verdict === "better"
      ? ">10% better than account avg"
      : verdict === "worse"
        ? ">10% worse than account avg"
        : verdict === "neutral"
          ? "Within ±10% of account avg"
          : "No baseline available";
  return (
    <td
      className={`py-2 px-2 text-right tabular-nums ${cls}`.trim()}
      title={title}
    >
      {value == null ? "—" : format(value)}
    </td>
  );
}

function reasonLabel(reason: NonNullable<RollupRow["reason"]>): string {
  switch (reason) {
    case "no_event_code":
      return "Set an event code to enable matching";
    case "no_ad_account":
      return "No Meta ad account on the client";
    case "meta_token_failed":
      return "Meta token unavailable";
    case "meta_insights_failed":
      return "Insights fetch failed — retried later";
  }
}

function normalise(adAccount: string): string {
  return adAccount.startsWith("act_") ? adAccount : `act_${adAccount}`;
}

const CURRENCY_FMT = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function fmtCurrency(v: number): string {
  return CURRENCY_FMT.format(v);
}

function fmtInt(v: number): string {
  return Math.round(v).toLocaleString("en-GB");
}
