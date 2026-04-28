"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Loader2,
  RefreshCcw,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  compareToBenchmark,
  type BenchmarkVerdict,
} from "@/lib/reporting/benchmark-verdict";

/**
 * components/dashboard/events/linked-campaigns-performance.tsx
 *
 * "CAMPAIGN PERFORMANCE" panel for the event detail Campaigns tab.
 *
 * Behaviour:
 *   - Platform tabs: Meta + TikTok are live; Google Ads remains disabled
 *     with a "Coming soon" tooltip.
 *   - Time range toggle (All / 30d / 14d / 7d / 3d / Yesterday).
 *     Default 30d. Each change triggers a fresh fetch; benchmarks
 *     stay locked to the rolling 90-day window so colour coding
 *     doesn't shift under the user.
 *   - Each row click opens the Meta campaign in Ads Manager in a new
 *     tab. The whole row is clickable so it acts as a quick edit
 *     bridge without polluting the UI with a separate "open" button.
 *
 * Empty states:
 *   - `no_event_code`  → "Set an event code on this event …"
 *   - `no_ad_account`  → "Connect a Meta ad account on the client …"
 *   - 0 matches        → "No Meta campaigns found for this event_code."
 */

type PlatformId = "meta" | "tiktok" | "google";
type RangeKey = "all" | "30d" | "14d" | "7d" | "3d" | "yesterday";

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpm: number | null;
  cpr: number | null;
  results: number;
  ad_account_id: string;
}

interface Benchmarks {
  ctr: number | null;
  cpm: number | null;
  cpr: number | null;
  campaignsCounted: number;
}

interface ApiResponse {
  ok: boolean;
  reason?: string;
  error?: string;
  campaigns?: CampaignRow[];
  benchmarks?: Benchmarks;
  event_code?: string | null;
  ad_account_id?: string | null;
  window?: { since: string; until: string } | null;
}

interface Props {
  eventId: string;
  /** Surfaces inline so the panel can self-explain when no event_code is set. */
  hasEventCode: boolean;
}

const RANGES: Array<{ id: RangeKey; label: string }> = [
  { id: "30d", label: "30d" },
  { id: "14d", label: "14d" },
  { id: "7d", label: "7d" },
  { id: "3d", label: "3d" },
  { id: "yesterday", label: "Yesterday" },
  { id: "all", label: "All time" },
];

const PLATFORMS: Array<{
  id: PlatformId;
  label: string;
  enabled: boolean;
  tooltip?: string;
}> = [
  { id: "meta", label: "Meta", enabled: true },
  { id: "tiktok", label: "TikTok", enabled: true },
  { id: "google", label: "Google Ads", enabled: false, tooltip: "Coming soon" },
];

export function LinkedCampaignsPerformance({ eventId, hasEventCode }: Props) {
  const [platform, setPlatform] = useState<PlatformId>("meta");
  const [range, setRange] = useState<RangeKey>("30d");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the latest in-flight fetch so a slow response from a
  // previous range can't overwrite the latest one — classic
  // race-condition guard for fetch-on-toggle UIs.
  const fetchTokenRef = useRef(0);

  const refetch = useCallback(async () => {
    if (platform === "google") {
      setData(null);
      setError(null);
      return;
    }
    const token = ++fetchTokenRef.current;
    setLoading(true);
    setError(null);
    try {
      const base =
        platform === "tiktok"
          ? "/api/reporting/event-campaigns/tiktok"
          : "/api/reporting/event-campaigns";
      const url = `${base}?eventId=${encodeURIComponent(
        eventId,
      )}&range=${range}&platform=${platform}`;
      const res = await fetch(url, { credentials: "same-origin" });
      const json = (await res.json()) as ApiResponse;
      if (token !== fetchTokenRef.current) return;
      if (!res.ok && !json.ok) {
        setError(json.error ?? "Failed to load campaigns");
        setData(json);
      } else {
        setData(json);
      }
    } catch (err) {
      if (token !== fetchTokenRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load campaigns");
    } finally {
      if (token === fetchTokenRef.current) setLoading(false);
    }
  }, [eventId, platform, range]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-heading text-base tracking-wide">
            Campaign performance
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Live insights for every Meta or TikTok campaign whose name contains the
            event&apos;s event code. Each cell is colour-coded against this
            ad account&apos;s rolling 90-day average.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={loading || platform === "google"}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-border py-2">
        <div className="flex items-center gap-1">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => p.enabled && setPlatform(p.id)}
              disabled={!p.enabled}
              title={p.tooltip}
              className={[
                "rounded-md px-2.5 py-1 text-xs",
                platform === p.id
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
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={[
                "rounded-md px-2 py-0.5 text-[11px]",
                range === r.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <PerformanceBody
          platform={platform}
          loading={loading}
          error={error}
          data={data}
          hasEventCode={hasEventCode}
        />
      </div>
    </section>
  );
}

function PerformanceBody({
  platform,
  loading,
  error,
  data,
  hasEventCode,
}: {
  platform: PlatformId;
  loading: boolean;
  error: string | null;
  data: ApiResponse | null;
  hasEventCode: boolean;
}) {
  if (platform === "google") {
    return (
      <EmptyState
        title="Google Ads reporting coming soon"
        body="The native adapter for this platform is not connected yet. Meta and TikTok are live."
      />
    );
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading campaign insights…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!data) return null;

  if (!hasEventCode || data.reason === "no_event_code") {
    return (
      <EmptyState
        title="No event code set"
        body={`Set an event code on this event to enable campaign matching. We use a substring match against ${platform === "tiktok" ? "TikTok" : "Meta"} campaign names.`}
      />
    );
  }
  if (data.reason === "no_ad_account" || data.reason === "no_tiktok_account") {
    return (
      <EmptyState
        title={
          platform === "tiktok"
            ? "No TikTok account on this event"
            : "No Meta ad account on the client"
        }
        body={
          platform === "tiktok"
            ? "Link a TikTok account on this event or its client so we can read insights for it."
            : "Connect a Meta ad account on this event's client so we can read insights for it."
        }
      />
    );
  }
  if (data.reason === "no_access_token" || data.reason === "no_advertiser_id") {
    return (
      <EmptyState
        title="TikTok OAuth is not connected"
        body="Connect TikTok Business API OAuth for this account before loading live insights."
      />
    );
  }
  const campaigns = data.campaigns ?? [];
  if (campaigns.length === 0) {
    return (
      <EmptyState
        title={`No matching ${platform === "tiktok" ? "TikTok" : "Meta"} campaigns`}
        body={`No ${platform === "tiktok" ? "TikTok" : "Meta"} campaigns in this account contain "${data.event_code}". Rename a campaign to match, or update the event code.`}
      />
    );
  }

  return (
    <CampaignTable
      campaigns={campaigns}
      benchmarks={data.benchmarks ?? { ctr: null, cpm: null, cpr: null, campaignsCounted: 0 }}
      platform={platform}
    />
  );
}

function CampaignTable({
  campaigns,
  benchmarks,
  platform,
}: {
  campaigns: CampaignRow[];
  benchmarks: Benchmarks;
  platform: Exclude<PlatformId, "google">;
}) {
  const totals = useMemo(() => {
    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
    const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
    const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
    const totalResults = campaigns.reduce((s, c) => s + c.results, 0);
    return {
      spend: totalSpend,
      impressions: totalImpressions,
      ctr:
        totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null,
      cpm:
        totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : null,
      cpr: totalResults > 0 ? totalSpend / totalResults : null,
      results: totalResults,
    };
  }, [campaigns]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Campaign</th>
            <th className="py-2 px-2 text-right font-medium">Spend</th>
            <th className="py-2 px-2 text-right font-medium">Impressions</th>
            <th className="py-2 px-2 text-right font-medium">CTR</th>
            <th className="py-2 px-2 text-right font-medium">CPM</th>
            <th className="py-2 px-2 text-right font-medium">CPR</th>
            <th className="py-2 px-2 text-right font-medium">Results</th>
            <th className="py-2 pl-2 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => {
            const ctrVerdict = compareToBenchmark(
              c.ctr,
              benchmarks.ctr,
              "higher-is-better",
            );
            const cpmVerdict = compareToBenchmark(
              c.cpm,
              benchmarks.cpm,
              "lower-is-better",
            );
            const cprVerdict = compareToBenchmark(
              c.cpr,
              benchmarks.cpr,
              "lower-is-better",
            );
            const adsManagerUrl =
              platform === "meta"
                ? `https://business.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(
                    c.ad_account_id,
                  )}&selected_campaign_ids=${encodeURIComponent(c.id)}`
                : null;
            return (
              <tr
                key={c.id}
                onClick={() => {
                  if (adsManagerUrl) {
                    window.open(adsManagerUrl, "_blank", "noopener,noreferrer");
                  }
                }}
                className={[
                  "border-b border-border/60 align-middle hover:bg-muted/40",
                  adsManagerUrl ? "cursor-pointer" : "",
                ].join(" ")}
                title={adsManagerUrl ? "Open in Meta Ads Manager" : undefined}
              >
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-foreground">
                      {c.name}
                    </span>
                    {adsManagerUrl ? (
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                    ) : null}
                  </div>
                </td>
                <td className="py-2 px-2 text-right tabular-nums">
                  {formatCurrency(c.spend)}
                </td>
                <td className="py-2 px-2 text-right tabular-nums">
                  {formatInt(c.impressions)}
                </td>
                <MetricCell value={c.ctr} verdict={ctrVerdict} format={(v) => `${v.toFixed(2)}%`} />
                <MetricCell value={c.cpm} verdict={cpmVerdict} format={formatCurrency} />
                <MetricCell value={c.cpr} verdict={cprVerdict} format={formatCurrency} />
                <td className="py-2 px-2 text-right tabular-nums">
                  {formatInt(c.results)}
                </td>
                <td className="py-2 pl-2 text-right">
                  <CampaignStatusPill status={c.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border text-[11px] text-foreground">
            <td className="py-2 pr-3 font-medium uppercase tracking-wider text-muted-foreground">
              Total
            </td>
            <td className="py-2 px-2 text-right tabular-nums">
              {formatCurrency(totals.spend)}
            </td>
            <td className="py-2 px-2 text-right tabular-nums">
              {formatInt(totals.impressions)}
            </td>
            <td className="py-2 px-2 text-right tabular-nums">
              {totals.ctr != null ? `${totals.ctr.toFixed(2)}%` : "—"}
            </td>
            <td className="py-2 px-2 text-right tabular-nums">
              {totals.cpm != null ? formatCurrency(totals.cpm) : "—"}
            </td>
            <td className="py-2 px-2 text-right tabular-nums">
              {totals.cpr != null ? formatCurrency(totals.cpr) : "—"}
            </td>
            <td className="py-2 px-2 text-right tabular-nums">
              {formatInt(totals.results)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
      {benchmarks.ctr != null && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Account benchmarks (rolling 90d, n={benchmarks.campaignsCounted}): CTR {benchmarks.ctr.toFixed(2)}% · CPM {formatCurrency(benchmarks.cpm ?? 0)} · CPR {benchmarks.cpr != null ? formatCurrency(benchmarks.cpr) : "—"}
        </p>
      )}
      {benchmarks.ctr == null && platform === "meta" && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Not enough recent campaign data on this ad account for colour coding (need ≥5 campaigns in the last 90 days).
        </p>
      )}
      {benchmarks.ctr == null && platform === "tiktok" && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          TikTok benchmark colour-coding is not configured yet; campaign rows are shown without a baseline.
        </p>
      )}
    </div>
  );
}

function MetricCell({
  value,
  verdict,
  format,
}: {
  value: number | null;
  verdict: BenchmarkVerdict;
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
  return (
    <td
      className={`py-2 px-2 text-right tabular-nums ${cls}`.trim()}
      title={
        verdict === "better"
          ? ">10% better than account avg"
          : verdict === "worse"
            ? ">10% worse than account avg"
            : verdict === "neutral"
              ? "Within ±10% of account avg"
              : "No baseline available"
      }
    >
      {value == null ? "—" : format(value)}
    </td>
  );
}

function CampaignStatusPill({ status }: { status: string }) {
  const tone =
    status === "ACTIVE"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : status === "PAUSED"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : status === "DELETED" || status === "ARCHIVED"
          ? "bg-muted text-muted-foreground"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
    >
      {status.toLowerCase().replace(/_/g, " ")}
    </span>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

const CURRENCY_FMT = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function formatCurrency(v: number): string {
  return CURRENCY_FMT.format(v);
}

function formatInt(v: number): string {
  return Math.round(v).toLocaleString("en-GB");
}
