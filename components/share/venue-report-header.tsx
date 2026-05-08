"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Loader2, RefreshCw, Share2 } from "lucide-react";

import { CustomRangePicker, TimeframeSelector } from "@/components/report/timeframe-controls";
import { fmtDate } from "@/lib/dashboard/format";
import {
  isSyncSuccessful,
  safeJson,
  type SyncResponseBody,
} from "@/lib/dashboard/sync-button-helpers";
import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  PLATFORM_ORDER,
  type PlatformId,
} from "@/lib/dashboard/platform-colors";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";

/**
 * components/share/venue-report-header.tsx
 *
 * Sticky header rendered at the top of the venue report on both the
 * internal `/clients/[id]/venues/[event_code]` route and the external
 * `/share/venue/[token]` route. Single source of truth for the global
 * Timeframe + Platform filters that drive the topline stats grid,
 * trend chart, daily tracker, and active creatives below it.
 *
 * Two halves:
 *   - Title row (always visible): aggregate name + Live indicator +
 *     Sync now button.
 *   - Controls row (Performance tab only): days-until chip + Timeframe
 *     selector + Platform tabs.
 *
 * URL search params:
 *   - `?tab=performance|insights|pacing` — already owned by the parent
 *     page; sub-tab bar links into the param so the back button works.
 *   - `?tf=<DatePreset>` — drives Timeframe selector. Persisted via
 *     `router.replace()` so a back-button doesn't replay every flick.
 *   - `?platform=all|meta|tiktok|google_ads` — drives Platform pills.
 *     Same replace semantics.
 *
 * Why sticky:
 *   The Performance tab scrolls deep (3 perf cards → additional entries
 *   → stats grid → trend chart → daily tracker → event breakdown →
 *   creatives). Without a sticky header the operator has no way to
 *   re-orient or change scope without scrolling all the way back up.
 *
 * Mobile collapse:
 *   Below 640px the days-until chip + Timeframe + Platform stack
 *   vertically. The title row stays inline (truncate-aware).
 */

export type VenueSubTab = "performance" | "insights" | "pacing";

interface SubTab {
  id: VenueSubTab;
  label: string;
  href: string;
}

interface Props {
  /** Aggregate display name e.g. "Arsenal Champions League Final – London". */
  title: string;
  /** Event code shown muted under the title (e.g. "4TF26-ARSENAL-CL-FL"). */
  subtitle?: string;
  /** Sub-tabs threaded from the parent (Performance always present). */
  subTabs: SubTab[];
  activeTab: VenueSubTab;
  /** Days until the venue's primary event date. Null when date TBC. */
  daysUntil: number | null;
  /** Display date for the days-until chip subtitle. */
  displayEventDate: string | null;
  /** ISO timestamp of the latest data sync (the freshest of any
   *  paid-media or ticket sync). Drives the "last synced …" indicator. */
  lastSyncedAt: string | null;
  /** Current global timeframe (drives Stats Grid + Trend + Tracker + Creatives). */
  datePreset: DatePreset;
  customRange?: CustomDateRange;
  /** Current global platform filter. */
  platform: PlatformId;
  /**
   * Event ids to fan out the Sync Now button across. Internal view
   * passes the full list (`/api/ticketing/rollup-sync?eventId=...`
   * per id); share view passes an empty array because the public
   * route doesn't expose a venue-scope sync. Empty array → Sync Now
   * just `router.refresh()`s.
   */
  syncEventIds: string[];
  /**
   * When set and the route is internal (`/clients/*`), shows "Share" next to
   * Sync — POST `/api/share/client` mints `/share/client/[token]`. Hidden on
   * `/share/*` routes so viewers never see a duplicate share affordance.
   */
  shareClientId?: string | null;
}

export function VenueReportHeader({
  title,
  subtitle,
  subTabs,
  activeTab,
  daysUntil,
  displayEventDate,
  lastSyncedAt,
  datePreset,
  customRange,
  platform,
  syncEventIds,
  shareClientId,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [shareLinkKind, setShareLinkKind] = useState<"editable" | "view" | null>(
    null,
  );
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPerformance = activeTab === "performance";

  const showClientShare =
    Boolean(shareClientId) && pathname.startsWith("/clients/");

  const setSearchParam = (key: string, value: string | null) => {
    // Preserve any other query params on the URL (Insights / Pacing
    // sub-state, future filters) so updating one doesn't blow away
    // the rest. `router.replace()` keeps the browser history clean —
    // a flick through Past 30d → Past 14d → Past 7d shouldn't
    // leave 3 entries behind to back-button through.
    const sp = new URLSearchParams(window.location.search);
    if (value == null || value === "") sp.delete(key);
    else sp.set(key, value);
    const query = sp.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    });
  };

  const handleTimeframeChange = (
    preset: DatePreset,
    nextRange?: CustomDateRange,
  ) => {
    const sp = new URLSearchParams(window.location.search);
    if (preset === "maximum") sp.delete("tf");
    else sp.set("tf", preset);
    if (preset === "custom" && nextRange) {
      sp.set("from", nextRange.since);
      sp.set("to", nextRange.until);
    } else {
      sp.delete("from");
      sp.delete("to");
    }
    const query = sp.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    });
  };

  const handlePlatformChange = (next: PlatformId) => {
    setSearchParam("platform", next === "all" ? null : next);
  };

  const handleShareClient = useCallback(async () => {
    if (!shareClientId) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const res = await fetch("/api/share/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: shareClientId }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        url?: string;
        can_edit?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.url) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      await navigator.clipboard.writeText(json.url);
      setShareLinkKind(json.can_edit ? "editable" : "view");
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setShareToast(`Share link copied: ${json.url}`);
      toastTimerRef.current = setTimeout(() => {
        setShareToast(null);
        toastTimerRef.current = null;
      }, 6000);
    } catch (err) {
      setShareError(
        err instanceof Error ? err.message : "Could not create share link.",
      );
    } finally {
      setShareBusy(false);
    }
  }, [shareClientId]);

  useEffect(() => {
    if (!showClientShare) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (
        e.metaKey &&
        e.shiftKey &&
        (e.key === "s" || e.key === "S") &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        void handleShareClient();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showClientShare, handleShareClient]);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      if (syncEventIds.length > 0) {
        // Fan out one rollup-sync POST per event id in parallel —
        // mirrors `VenueSyncButton`'s contract (`Promise.allSettled`
        // so a single event failure doesn't poison the others).
        // First failure surfaces in the inline error banner; the
        // server logs carry the full per-event detail.
        const results = await Promise.allSettled(
          syncEventIds.map(async (id) => {
            const res = await fetch(
              `/api/ticketing/rollup-sync?eventId=${encodeURIComponent(id)}`,
              { method: "POST" },
            );
            const body = await safeJson<SyncResponseBody>(res);
            if (!res.ok && res.status !== 207) {
              throw new Error(
                `HTTP ${res.status} for event ${id.slice(0, 8)}`,
              );
            }
            if (!isSyncSuccessful(body)) {
              throw new Error(
                `Sync incomplete for event ${id.slice(0, 8)}`,
              );
            }
            return body;
          }),
        );
        const firstErr = results.find((r) => r.status === "rejected") as
          | PromiseRejectedResult
          | undefined;
        if (firstErr) {
          const message =
            firstErr.reason instanceof Error
              ? firstErr.reason.message
              : String(firstErr.reason);
          // Keep the error inline but still run router.refresh()
          // so the rows that DID sync flow through.
          setSyncError(`Some events failed to sync — ${message}`);
        }
      }
      router.refresh();
    } catch (err) {
      setSyncError(
        err instanceof Error ? err.message : "Sync failed — try again.",
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const lastSyncedLabel = useMemo(
    () => formatLastSynced(lastSyncedAt),
    [lastSyncedAt],
  );

  return (
    <header
      className="sticky top-0 z-30 -mx-6 border-b border-border bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      data-testid="venue-report-header"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-xl tracking-wide text-foreground sm:text-2xl">
            {title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {subtitle ? (
              <span className="font-mono text-[11px]">{subtitle}</span>
            ) : null}
            <LiveIndicator label={lastSyncedLabel} />
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
          {showClientShare ? (
            <button
              type="button"
              onClick={() => void handleShareClient()}
              disabled={shareBusy || isPending}
              title="Copy client portal share link (⌘⇧S)"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="venue-report-share-client"
            >
              {shareBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {shareBusy
                ? "Sharing…"
                : shareLinkKind === "editable"
                  ? "Share (editable)"
                  : shareLinkKind === "view"
                    ? "Share (view-only)"
                    : "Share"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleSync}
            disabled={isSyncing || isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="venue-report-sync-now"
          >
            {isSyncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isSyncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>
      {syncError ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive"
        >
          {syncError}
        </p>
      ) : null}
      {shareError ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive"
        >
          {shareError}
        </p>
      ) : null}
      {shareToast ? (
        <p
          role="status"
          className="fixed bottom-4 right-4 z-50 max-w-md rounded-md border border-border bg-card px-4 py-3 text-xs text-foreground shadow-lg"
          data-testid="venue-report-share-toast"
        >
          {shareToast}
        </p>
      ) : null}

      <nav
        aria-label="Venue report sections"
        className="mt-3 flex flex-wrap gap-2"
      >
        {subTabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              prefetch={false}
              className={`inline-flex items-center rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {isPerformance ? (
        <div
          className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
          data-testid="venue-report-controls"
        >
          <DaysUntilChip days={daysUntil} dateLabel={displayEventDate} />
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <PlatformTabs platform={platform} onChange={handlePlatformChange} />
            <div className="flex flex-col gap-1.5">
              <TimeframeSelector
                active={datePreset}
                disabled={isPending}
                onChange={(preset) => handleTimeframeChange(preset)}
              />
              <CustomRangePicker
                active={datePreset === "custom"}
                disabled={isPending}
                initialRange={customRange ?? null}
                onApply={(range) => handleTimeframeChange("custom", range)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function LiveIndicator({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="relative inline-flex h-2 w-2 items-center justify-center"
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span>{label}</span>
    </span>
  );
}

function DaysUntilChip({
  days,
  dateLabel,
}: {
  days: number | null;
  dateLabel: string | null;
}) {
  if (days == null) {
    return (
      <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
        <span className="text-muted-foreground">Date</span>
        <span className="font-medium text-foreground">TBC</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
      <span className="text-muted-foreground">Days until event</span>
      <span className="font-medium tabular-nums text-foreground">
        {daysUntilLabel(days)}
      </span>
      {dateLabel ? (
        <span className="text-muted-foreground">· {fmtDate(dateLabel)}</span>
      ) : null}
    </span>
  );
}

function PlatformTabs({
  platform,
  onChange,
}: {
  platform: PlatformId;
  onChange: (next: PlatformId) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Platform"
      className="inline-flex flex-wrap rounded-md border border-border bg-card p-0.5"
      data-testid="venue-report-platform-tabs"
    >
      {PLATFORM_ORDER.map((id) => {
        const active = id === platform;
        const colour = PLATFORM_COLORS[id];
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-muted text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={
              active && id !== "all"
                ? { boxShadow: `inset 0 -2px 0 ${colour}` }
                : undefined
            }
          >
            {id !== "all" ? (
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: colour }}
              />
            ) : null}
            {PLATFORM_LABELS[id]}
          </button>
        );
      })}
    </div>
  );
}

function daysUntilLabel(d: number): string {
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  if (d < -1) return `${Math.abs(d)} days ago`;
  return `${d} days`;
}

function formatLastSynced(iso: string | null): string {
  if (!iso) return "Live · awaiting first sync";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "Live · sync time unknown";
  const date = new Date(ms);
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const today = new Date();
  const sameDay =
    date.getUTCFullYear() === today.getUTCFullYear() &&
    date.getUTCMonth() === today.getUTCMonth() &&
    date.getUTCDate() === today.getUTCDate();
  if (sameDay) return `Live · last synced ${time}`;
  const dayLabel = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  return `Live · last synced ${dayLabel} ${time}`;
}
