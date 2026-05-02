"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Ticket,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  EventTicketingLink,
  TicketSalesSnapshot,
} from "@/lib/ticketing/types";
import type { SafeTicketingConnection } from "@/lib/db/event-ticketing-summary";

/**
 * components/dashboard/events/eventbrite-live-block.tsx
 *
 * Top-of-page live ticketing block for the event detail view. Renders one
 * of three states based on the prefetched summary:
 *
 *   1. No connection on the client    → CTA pointing to /clients/.../?tab=ticketing
 *   2. Connection but no link         → "Link ticketing event" deferred
 *                                       to <EventbriteLinkPanel />, only
 *                                       a tiny banner here.
 *   3. Linked + at least one snapshot → live capacity / sold / revenue /
 *                                       sell-through % + Refresh button
 *                                       + last-synced timestamp.
 *
 * Sync-on-load behaviour: when a link exists and the connection's
 * `last_synced_at` is older than 5 minutes (or null) on first paint, the
 * component triggers `POST /api/ticketing/sync?eventId=...` once on
 * mount and then re-fetches `GET /api/ticketing/eventbrite-stats` to
 * refresh the displayed numbers. Manual Refresh does the same dance
 * regardless of staleness.
 *
 * The block deliberately doesn't accept the full snapshot history — the
 * Reporting tab's <TicketPacingCard /> still owns the pacing chart.
 * This block is a single-row "what does the box office say right now?"
 * surface.
 */

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

interface Props {
  eventId: string;
  clientId: string | null;
  /** Capacity from the internal `events` row — fallback when Eventbrite has none. */
  fallbackCapacity: number | null;
  initialLink: EventTicketingLink | null;
  initialConnection: SafeTicketingConnection | null;
  initialLatestSnapshot: TicketSalesSnapshot | null;
}

interface FetchedSummary {
  link: EventTicketingLink | null;
  connection: SafeTicketingConnection | null;
  latestSnapshot: TicketSalesSnapshot | null;
}

export function EventbriteLiveBlock({
  eventId,
  clientId,
  fallbackCapacity,
  initialLink,
  initialConnection,
  initialLatestSnapshot,
}: Props) {
  const [link, setLink] = useState(initialLink);
  const [connection, setConnection] = useState(initialConnection);
  const [latest, setLatest] = useState(initialLatestSnapshot);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoTried, setAutoTried] = useState(false);

  // Re-hydrate from incoming server props if the parent re-renders
  // (e.g. after the link panel POSTs and triggers `router.refresh()`).
  useEffect(() => setLink(initialLink), [initialLink]);
  useEffect(() => setConnection(initialConnection), [initialConnection]);
  useEffect(
    () => setLatest(initialLatestSnapshot),
    [initialLatestSnapshot],
  );

  async function refreshSummary() {
    const res = await fetch(
      `/api/ticketing/eventbrite-stats?eventId=${encodeURIComponent(eventId)}`,
      { cache: "no-store" },
    );
    const json = (await res.json()) as {
      ok: boolean;
      error?: string;
      summary?: FetchedSummary;
    };
    if (!res.ok || !json.ok || !json.summary) {
      throw new Error(json.error ?? "Failed to refresh ticketing stats.");
    }
    setLink(json.summary.link);
    setConnection(json.summary.connection);
    setLatest(json.summary.latestSnapshot);
  }

  async function syncNow() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ticketing/sync?eventId=${encodeURIComponent(eventId)}`,
        { method: "POST" },
      );
      const json = (await res.json()) as {
        ok: boolean;
        results?: Array<{ ok: boolean; error?: string }>;
        error?: string;
      };
      // 207 (multi-status) means partial success — show the first
      // failing link's error but keep going to refresh the snapshot.
      if (!res.ok && res.status !== 207) {
        throw new Error(json.error ?? "Ticketing sync failed.");
      }
      const firstFailure = (json.results ?? []).find((r) => !r.ok);
      if (firstFailure) {
        setError(firstFailure.error ?? "One or more links failed to sync.");
      }
      await refreshSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setSyncing(false);
    }
  }

  // Auto-sync on mount when the connection is stale. Guarded by
  // `autoTried` so an unsuccessful auto-sync doesn't loop on every
  // re-render — the user can still click Refresh manually.
  useEffect(() => {
    if (autoTried) return;
    if (!link || !connection) return;
    const lastSynced = connection.last_synced_at
      ? new Date(connection.last_synced_at).getTime()
      : 0;
    const stale = Date.now() - lastSynced > STALE_THRESHOLD_MS;
    if (!stale) return;
    setAutoTried(true);
    void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.id, connection?.id, autoTried]);

  // ─── Render ────────────────────────────────────────────────────────

  if (!clientId) {
    // Brand campaigns / unowned events. Don't render anything — the
    // event-detail page already gates on isBrand for the pacing card.
    return null;
  }

  // State 1: no connection on this client
  if (!connection) {
    return (
      <section className="rounded-md border border-dashed border-border bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <Ticket className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">Ticketing</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect Eventbrite or 4thefans on the client&rsquo;s Ticketing
              tab to pull live capacity, tickets sold and revenue into
              this page.
            </p>
            <a
              href={`/clients/${clientId}?tab=ticketing`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
            >
              Connect ticketing
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </section>
    );
  }

  // State 2: connection but not yet linked to a specific ticketing event
  if (!link) {
    return (
      <section className="rounded-md border border-dashed border-border bg-muted/10 p-4">
        <div className="flex items-start gap-3">
          <Ticket className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">Ticketing</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Connection saved on the client. Pick the matching ticketing
              event in the panel below to start pulling live numbers.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // State 3: linked. Compute live numbers.
  const sold = latest?.tickets_sold ?? 0;
  const capacity = latest?.tickets_available ?? fallbackCapacity ?? null;
  const sellThrough =
    capacity != null && capacity > 0 ? (sold / capacity) * 100 : null;
  const grossCents = latest?.gross_revenue_cents ?? null;
  const currency = latest?.currency ?? "GBP";
  const lastSyncedLabel = connection.last_synced_at
    ? formatRelative(connection.last_synced_at)
    : "never";

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Ticket className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="font-heading text-base tracking-wide">
              {providerLabel(connection.provider)} — live
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {link.external_event_url ? (
                <a
                  href={link.external_event_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  Linked event ({link.external_event_id})
                </a>
              ) : (
                <>Linked event ({link.external_event_id})</>
              )}
              {" · "}
              last synced {lastSyncedLabel}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void syncNow()}
          disabled={syncing}
        >
          {syncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat label="Capacity" value={fmtInt(capacity)} />
        <Stat label="Tickets sold" value={fmtInt(sold)} />
        <Stat label="Gross revenue" value={fmtMoney(grossCents, currency)} />
        <Stat label="Sell-through" value={fmtPct(sellThrough)} />
      </dl>

      {error ? (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      ) : null}
      {connection.last_error && !error ? (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-3 w-3" />
          Last sync error: {connection.last_error}
        </p>
      ) : null}
      {!latest ? (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3 w-3" />
          No snapshot yet — click Refresh to pull current sales from
          ticketing.
        </p>
      ) : null}
    </section>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-heading text-lg tracking-wide tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function providerLabel(provider: SafeTicketingConnection["provider"]): string {
  return provider === "fourthefans" ? "4thefans" : "Eventbrite";
}

// ─── Formatters ───────────────────────────────────────────────────────

function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-GB");
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function fmtMoney(cents: number | null, currency: string | null): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const cur = currency ?? "GBP";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    // Unknown currency code — fall back to the raw number with a hint.
    return `${cur} ${(cents / 100).toFixed(0)}`;
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
