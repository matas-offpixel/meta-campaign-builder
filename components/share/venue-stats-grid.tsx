"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { Info } from "lucide-react";

import { fmtCurrency, fmtCurrencyCompact } from "@/lib/dashboard/format";
import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  type PlatformId,
} from "@/lib/dashboard/platform-colors";
import {
  aggregateStatsForAll,
  aggregateStatsForPlatform,
  buildWindowDaySet,
  type VenueStatsGridCells,
} from "@/lib/dashboard/venue-stats-grid-aggregator";
import type { DailyRollupRow } from "@/lib/db/client-portal-server";

/**
 * components/share/venue-stats-grid.tsx
 *
 * Black-Butter style topline campaign stats grid.
 *
 * 10 cells per platform: Spend / Impressions / Reach (sum) / Clicks
 * (with CPC subline) / CTR / CPM / Video Plays / Engagements / Cost
 * per Video Play / Cost per Engagement.
 *
 * Reads from the global Platform tab in the sticky header (passed in
 * via the `platform` prop). When the selected platform has no data
 * AND the venue isn't connected to that platform, renders a
 * connect-CTA card instead of a grid of zeros — see the spec note
 * about all-zero cells looking broken on the share surface.
 *
 * Window-aware: filters rollup rows to the days passed in via
 * `windowDays`. `null` means lifetime (no filter).
 *
 * Data source: the slim `DailyRollupRow[]` from the portal payload —
 * pre-extended in this PR to include meta_impressions / meta_reach /
 * meta_video_plays_3s / meta_engagements / tiktok_impressions /
 * tiktok_video_views / google_ads_impressions / google_ads_clicks /
 * google_ads_video_views columns.
 */

interface Props {
  rows: DailyRollupRow[];
  platform: PlatformId;
  /**
   * Resolved day list from `resolvePresetToDays(preset, customRange)`.
   * `null` means lifetime. Empty array means an explicitly empty
   * window (e.g. an unsupported preset) and yields zero everywhere.
   */
  windowDays: string[] | null;
  /** Whether the venue's client has a TikTok account linked. Drives
   *  the empty-state copy ("Not connected — connect in Settings →"
   *  vs "No TikTok activity in this window"). */
  hasTikTokAccount: boolean;
  /** Whether the venue's client has a Google Ads account linked. */
  hasGoogleAdsAccount: boolean;
  /** Settings href used by the "Not connected" cards. Internal-only;
   *  the share view passes a tooltip-disabled href. */
  settingsHref?: string | null;
  /**
   * Events powering this grid — must include `id` + `event_code` for
   * each event whose rollups appear in `rows`. Drives the
   * `(event_code, date)` dedup of campaign-wide Meta columns inside
   * `aggregateStatsForPlatform`. A multi-event WC26 venue (e.g. four
   * Shepherd's Bush fixtures sharing `WC26-LONDON-SHEPHERDS`) holds
   * the SAME campaign-wide `meta_reach` value on every sibling row —
   * without this map the aggregator would 4× the venue total.
   *
   * Pass an empty array on legacy call-sites where the rows are
   * already pre-deduped or per-event-correct; the aggregator skips
   * the dedup pass when the resulting map is empty.
   */
  events: ReadonlyArray<{ id: string; event_code: string | null }>;
  /**
   * Lifetime Meta totals from `event_code_lifetime_meta_cache`
   * (migration 068). Powers the **Reach** cell with Meta's
   * campaign-window deduplicated unique-users number, matching Meta
   * Ads Manager. Pre-PR #415 the cell summed daily reach values which
   * over-counted by ~2× (users reached on 4 days = 4×). The fallback
   * "Reach (sum)" label + old tooltip render when:
   *   - cache row is missing (cron hasn't written yet for this
   *     event_code), OR
   *   - the user has selected a non-lifetime window (cache is one
   *     number across the campaign window, not per-day), OR
   *   - the user has filtered to TikTok / Google Ads (the cache only
   *     covers Meta — TikTok / GA reach uses their respective
   *     platform-specific dedup which is summed in the row pipeline).
   *
   * `null` is the explicit "no cache available" signal; an undefined
   * prop renders the same fallback for backwards-compat with any
   * caller that hasn't been wired up yet.
   */
  lifetimeMeta?: {
    meta_reach: number | null;
    meta_impressions: number | null;
  } | null;
}

export function VenueStatsGrid({
  rows,
  platform,
  windowDays,
  hasTikTokAccount,
  hasGoogleAdsAccount,
  settingsHref,
  events,
  lifetimeMeta,
}: Props) {
  const windowSet = useMemo(() => buildWindowDaySet(windowDays), [windowDays]);

  const eventIdToCode = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const event of events) map.set(event.id, event.event_code);
    return map;
  }, [events]);

  const cells = useMemo<VenueStatsGridCells>(() => {
    if (platform === "all") {
      return aggregateStatsForAll(rows, windowSet, eventIdToCode);
    }
    return aggregateStatsForPlatform(rows, platform, windowSet, eventIdToCode);
  }, [rows, platform, windowSet, eventIdToCode]);

  // The lifetime cache row only applies to lifetime Meta-or-All views.
  // Anything else (windowed view, TikTok/GA tab) falls back to the
  // summed reach with the legacy "Reach (sum)" label + tooltip.
  const showLifetimeReach =
    (platform === "meta" || platform === "all") &&
    windowDays === null &&
    lifetimeMeta != null &&
    typeof lifetimeMeta.meta_reach === "number" &&
    lifetimeMeta.meta_reach > 0;
  const reachValue = showLifetimeReach
    ? (lifetimeMeta as { meta_reach: number }).meta_reach
    : cells.reach;

  // Empty-state cards: only when the user has selected TikTok or
  // Google Ads AND there's no data AND the venue isn't connected.
  // "All" + zero is just an "early days" venue — render the grid
  // with zeros + the standard headline so the shape is consistent.
  if (
    platform === "tiktok" &&
    !cells.hasData &&
    !hasTikTokAccount
  ) {
    return (
      <NotConnectedCard
        platform="tiktok"
        settingsHref={settingsHref}
        copy="No TikTok account linked yet."
      />
    );
  }
  if (
    platform === "google_ads" &&
    !cells.hasData &&
    !hasGoogleAdsAccount
  ) {
    return (
      <NotConnectedCard
        platform="google_ads"
        settingsHref={settingsHref}
        copy="Google Ads not connected — connect in Settings →"
      />
    );
  }

  const accent = PLATFORM_COLORS[platform];
  const platformLabel = PLATFORM_LABELS[platform];

  return (
    <section
      className="space-y-3"
      data-testid="venue-stats-grid"
      data-platform={platform}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            Total Spend {fmtCurrencyCompact(cells.spend)}
          </span>{" "}
          across {cells.daysCount} day{cells.daysCount === 1 ? "" : "s"}
          {platform !== "all" ? (
            <>
              {" "}
              · <span className="text-foreground">{platformLabel}</span>
            </>
          ) : null}
        </p>
      </header>
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        style={
          platform !== "all"
            ? { borderTop: `2px solid ${accent}`, paddingTop: "0.75rem" }
            : undefined
        }
      >
        <Cell
          label="Spend"
          value={fmtCurrency(cells.spend)}
          testid="venue-stats-cell-spend"
        />
        <Cell
          label="Impressions"
          value={fmtIntOrDash(cells.impressions)}
          testid="venue-stats-cell-impressions"
        />
        <Cell
          label={
            showLifetimeReach ? (
              <span className="inline-flex items-center gap-1">
                Reach
                <button
                  type="button"
                  className="inline-flex rounded p-0.5 text-muted-foreground hover:text-foreground"
                  title="Unique people reached across this venue's campaigns — matches Meta Ads Manager's deduplicated reach figure."
                  aria-label="About Reach"
                  data-testid="venue-stats-cell-reach-tooltip-lifetime"
                >
                  <Info className="h-3 w-3 shrink-0" strokeWidth={2} />
                </button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                Reach (sum)
                <button
                  type="button"
                  className="inline-flex rounded p-0.5 text-muted-foreground hover:text-foreground"
                  title="Reach (sum) is summed across campaigns — not deduplicated unique reach across the venue. A user reached by more than one campaign is counted once per campaign. Video Plays uses Meta’s default 3-second video view action (and platform-equivalents on TikTok / Google Ads)."
                  aria-label="About Reach (sum)"
                  data-testid="venue-stats-cell-reach-tooltip-summed"
                >
                  <Info className="h-3 w-3 shrink-0" strokeWidth={2} />
                </button>
              </span>
            )
          }
          value={fmtIntOrDash(reachValue)}
          testid="venue-stats-cell-reach"
        />
        <Cell
          label="Clicks"
          value={fmtIntOrDash(cells.clicks)}
          sub={
            cells.costPerClick != null
              ? `${fmtCurrency(cells.costPerClick)} per click`
              : null
          }
          testid="venue-stats-cell-clicks"
        />
        <Cell
          label="CTR"
          value={fmtPctOrDash(cells.ctr)}
          testid="venue-stats-cell-ctr"
        />
        <Cell
          label="CPM"
          value={fmtCurrencyOrDash(cells.cpm)}
          testid="venue-stats-cell-cpm"
        />
        <Cell
          label="Video Plays"
          value={fmtIntOrDash(cells.videoPlays)}
          testid="venue-stats-cell-video-plays"
        />
        <Cell
          label="Engagements"
          value={fmtIntOrDash(cells.engagements)}
          testid="venue-stats-cell-engagements"
        />
        <Cell
          label="Cost per Video Play"
          value={fmtCurrencyOrDash(cells.costPerVideoPlay)}
          testid="venue-stats-cell-cost-per-video-play"
        />
        <Cell
          label="Cost per Engagement"
          value={fmtCurrencyOrDash(cells.costPerEngagement)}
          testid="venue-stats-cell-cost-per-engagement"
        />
      </div>
    </section>
  );
}

function Cell({
  label,
  value,
  sub,
  testid,
}: {
  label: ReactNode;
  value: string;
  sub?: string | null;
  /**
   * `data-testid` for DOM-level regression tests. Memory anchor:
   * `feedback_resolver_dashboard_test_gap.md` — pipeline tests
   * cannot catch a missing data-loader wire-up, only DOM tests can,
   * so every cell in the grid is individually addressable.
   */
  testid?: string;
}) {
  return (
    <div
      className="rounded-md border border-border bg-card p-3"
      data-testid={testid}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground [&_button]:normal-case">
        {label}
      </div>
      <p
        className="mt-1 font-heading text-lg tracking-wide tabular-nums text-foreground"
        data-testid={testid ? `${testid}-value` : undefined}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function NotConnectedCard({
  platform,
  settingsHref,
  copy,
}: {
  platform: Exclude<PlatformId, "all">;
  settingsHref: string | null | undefined;
  copy: string;
}) {
  const accent = PLATFORM_COLORS[platform];
  return (
    <section
      className="rounded-md border border-dashed border-border bg-card p-6"
      data-testid={`venue-stats-grid-empty-${platform}`}
      data-platform={platform}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <p className="text-sm font-medium text-foreground">
            {PLATFORM_LABELS[platform]} not connected
          </p>
        </div>
        {settingsHref ? (
          <Link
            href={settingsHref}
            className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            Connect in Settings →
          </Link>
        ) : (
          <span
            className="inline-flex cursor-not-allowed items-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground"
            title="Settings access not available on the share view"
          >
            Connect in Settings →
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{copy}</p>
    </section>
  );
}

const INT_FMT = new Intl.NumberFormat("en-GB");
const PCT_FMT = new Intl.NumberFormat("en-GB", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtIntOrDash(n: number): string {
  if (n <= 0 || !Number.isFinite(n)) return "—";
  return INT_FMT.format(Math.round(n));
}

function fmtPctOrDash(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return PCT_FMT.format(n / 100);
}

function fmtCurrencyOrDash(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  return fmtCurrency(n);
}
