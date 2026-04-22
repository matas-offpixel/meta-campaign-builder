"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
  ImageOff,
  Layers,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { fmtCurrency } from "@/lib/dashboard/format";

/**
 * components/dashboard/events/event-active-creatives-panel.tsx
 *
 * "Active Creatives" tab on the event detail page. One card per
 * creative (not per ad — a single creative typically powers
 * several ad sets, sometimes several campaigns), with aggregated
 * spend / CTR / CPR / frequency and a deep link to Ads Manager.
 *
 * Data is fetched live from /api/events/[id]/active-creatives
 * (no client cache); the route is per-event so payloads stay
 * small and the up-to-10-second wait is acceptable when the user
 * clicks into the tab. The "Refresh" button re-calls the route.
 *
 * Sort happens client-side over the already-grouped row set so
 * switching ordering doesn't require another round-trip.
 *
 * Co-located with the other event-* panels rather than a new
 * top-level components/event/ folder so the dashboard-boundaries
 * rule (`components/dashboard/**` is write-freely) keeps holding.
 */

interface AdsetRef {
  id: string;
  name: string | null;
}
interface CampaignRef {
  id: string;
  name: string | null;
}

interface CreativeRow {
  creative_id: string;
  creative_name: string | null;
  headline: string | null;
  body: string | null;
  thumbnail_url: string | null;
  ad_count: number;
  adsets: AdsetRef[];
  campaigns: CampaignRef[];
  representative_ad_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  registrations: number;
  cpr: number | null;
  purchases: number;
  cpp: number | null;
  frequency: number | null;
}

interface SuccessResponse {
  ok: true;
  creatives: CreativeRow[];
  ad_account_id: string | null;
  event_code: string | null;
  fetched_at: string;
  reason?:
    | "no_event_code"
    | "no_ad_account"
    | "no_linked_campaigns";
  meta: {
    campaigns_total: number;
    campaigns_failed: number;
    ads_fetched: number;
    dropped_no_creative: number;
    truncated: boolean;
  };
}

interface FailureResponse {
  ok: false;
  reason?: string;
  error?: string;
}

type SortKey = "spend_desc" | "ctr_desc" | "cpr_asc" | "freq_desc";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "spend_desc", label: "Spend (high → low)" },
  { value: "ctr_desc", label: "CTR (high → low)" },
  { value: "cpr_asc", label: "CPR (low → high)" },
  { value: "freq_desc", label: "Frequency (high → low)" },
];

function sortCreatives(
  rows: readonly CreativeRow[],
  key: SortKey,
): CreativeRow[] {
  const out = [...rows];
  const cmp = (a: number | null, b: number | null, asc: boolean): number => {
    // Nulls always sort to the bottom regardless of direction so a
    // creative with no registrations doesn't claim the "best CPR"
    // slot when the user picks CPR ASC.
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return asc ? a - b : b - a;
  };
  switch (key) {
    case "spend_desc":
      out.sort((a, b) => cmp(a.spend, b.spend, false));
      break;
    case "ctr_desc":
      out.sort((a, b) => cmp(a.ctr, b.ctr, false));
      break;
    case "cpr_asc":
      out.sort((a, b) => cmp(a.cpr, b.cpr, true));
      break;
    case "freq_desc":
      out.sort((a, b) => cmp(a.frequency, b.frequency, false));
      break;
  }
  return out;
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}
function fmtMoneyOrDash(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return fmtCurrency(v);
}
function fmtFreq(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

function adsManagerUrl(adId: string, adAccountId: string | null): string {
  // selected_ad_ids deep-links straight to the ad row.
  // act_id is required to scope to the right ad account; without
  // it Ads Manager throws an "ambiguous account" interstitial.
  const accountParam = adAccountId
    ? `&act=${encodeURIComponent(adAccountId.replace(/^act_/, ""))}`
    : "";
  return `https://business.facebook.com/adsmanager/manage/ads?selected_ad_ids=${encodeURIComponent(adId)}${accountParam}`;
}

interface Props {
  eventId: string;
}

export function EventActiveCreativesPanel({ eventId }: Props) {
  const [data, setData] = useState<SuccessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("spend_desc");

  const load = useCallback(
    async (opts: { refresh: boolean }) => {
      if (opts.refresh) setRefreshing(true);
      else setLoading(true);
      setTopError(null);
      setAuthExpired(false);
      try {
        const res = await fetch(`/api/events/${eventId}/active-creatives`, {
          method: "GET",
          cache: "no-store",
        });
        const j = (await res.json()) as SuccessResponse | FailureResponse;
        if (res.status === 401 || res.status === 403) {
          if ("reason" in j && j.reason === "auth_expired") {
            setAuthExpired(true);
          } else if ("error" in j && j.error) {
            setTopError(j.error);
          } else {
            setTopError("Not signed in.");
          }
          return;
        }
        if (!res.ok || !("ok" in j) || !j.ok) {
          const msg =
            "error" in j && j.error ? j.error : `HTTP ${res.status}`;
          setTopError(msg);
          return;
        }
        setData(j);
      } catch (err) {
        setTopError(
          err instanceof Error ? err.message : "Failed to load active creatives",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [eventId],
  );

  useEffect(() => {
    void load({ refresh: false });
  }, [load]);

  const sorted = useMemo(
    () => (data ? sortCreatives(data.creatives, sortKey) : []),
    [data, sortKey],
  );

  const handleSortChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setSortKey(e.target.value as SortKey);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-heading text-xl tracking-wide text-foreground">
            Active Creatives
          </h2>
          {data && data.creatives.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {data.creatives.length} creative
              {data.creatives.length === 1 ? "" : "s"} ·{" "}
              {data.meta.ads_fetched} ad
              {data.meta.ads_fetched === 1 ? "" : "s"} across{" "}
              {data.meta.campaigns_total} campaign
              {data.meta.campaigns_total === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data && data.creatives.length > 1 && (
            <div className="w-56">
              <Select
                aria-label="Sort by"
                options={SORT_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                value={sortKey}
                onChange={handleSortChange}
              />
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load({ refresh: true })}
            disabled={loading || refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {data?.meta.truncated && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          Showing the first 200 creatives. The remainder were trimmed to keep
          this view responsive — narrow your campaigns or use Ads Manager
          for the full list.
        </div>
      )}

      {data && data.meta.campaigns_failed > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          {data.meta.campaigns_failed} of {data.meta.campaigns_total} linked
          campaign
          {data.meta.campaigns_failed === 1 ? "" : "s"} failed to load.
          Showing creatives from the rest.
        </div>
      )}

      {loading && !data && (
        <div className="rounded-md border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
          Fetching live from Meta — up to 10s.
        </div>
      )}

      {!loading && authExpired && (
        <ErrorBox
          title="Your Facebook session expired."
          body="Reconnect to refresh the live ad list."
        >
          <Link
            href="/auth/facebook-start"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Reconnect Facebook
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </ErrorBox>
      )}

      {!loading && !authExpired && topError && (
        <ErrorBox title="Couldn't load active creatives." body={topError}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load({ refresh: false })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
        </ErrorBox>
      )}

      {!loading && !topError && !authExpired && data && (
        <EmptyOrGrid
          data={data}
          sorted={sorted}
          eventId={eventId}
        />
      )}
    </div>
  );
}

function EmptyOrGrid({
  data,
  sorted,
  eventId,
}: {
  data: SuccessResponse;
  sorted: CreativeRow[];
  eventId: string;
}) {
  if (data.reason === "no_event_code") {
    return (
      <EmptyBox
        title="This event has no event code yet."
        body="Add an event code so we can find the live Meta campaigns linked to it."
      />
    );
  }
  if (data.reason === "no_ad_account") {
    return (
      <EmptyBox
        title="No Meta ad account on this client."
        body="Set the client's default ad account to enable live ad reporting."
      />
    );
  }
  if (data.reason === "no_linked_campaigns") {
    return (
      <EmptyBox
        title="No Meta campaigns linked to this event yet."
        body="Link one in the wizard to start tracking its creatives here."
      >
        <Link
          href={`/campaign/new?eventId=${encodeURIComponent(eventId)}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          Open the campaign wizard
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </EmptyBox>
    );
  }
  if (sorted.length === 0) {
    return (
      <EmptyBox
        title="No ads are currently active for this event."
        body={
          data.meta.dropped_no_creative > 0
            ? `Found ${data.meta.dropped_no_creative} active ad${data.meta.dropped_no_creative === 1 ? "" : "s"} without a creative attached. Cached insights for paused ads aren't shown here.`
            : "Cached insights for paused ads aren't shown here. Activate an ad to see it appear."
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((row) => (
        <CreativeCard
          key={row.creative_id}
          row={row}
          adAccountId={data.ad_account_id}
        />
      ))}
    </div>
  );
}

function CreativeCard({
  row,
  adAccountId,
}: {
  row: CreativeRow;
  adAccountId: string | null;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Thumbnail url={row.thumbnail_url} alt={row.creative_name ?? "Creative"} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-sm font-medium text-foreground">
            {row.headline ?? row.creative_name ?? "(no headline)"}
          </div>
          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {row.body ?? "—"}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">
          <Layers className="mr-1 h-3 w-3" />
          {row.ad_count} ad{row.ad_count === 1 ? "" : "s"} ·{" "}
          {row.adsets.length} ad set{row.adsets.length === 1 ? "" : "s"}
        </Badge>
        {row.campaigns.length > 1 && (
          <Badge variant="outline">
            {row.campaigns.length} campaigns
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Stat label="Spend" value={fmtCurrency(row.spend)} prominent />
        <Stat label="CTR" value={fmtPct(row.ctr)} />
        <Stat label="CPR" value={fmtMoneyOrDash(row.cpr)} />
        <Stat label="Frequency" value={fmtFreq(row.frequency)} />
      </div>

      <div className="mt-auto pt-1">
        <a
          href={adsManagerUrl(row.representative_ad_id, adAccountId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open in Ads Manager
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

function Thumbnail({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return (
      <div className="flex h-16 w-16 flex-none items-center justify-center rounded border border-border bg-muted text-muted-foreground">
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }
  return (
    // Plain <img> instead of next/image because Meta's CDN URLs are
    // signed and short-lived — the next/image loader can't cache or
    // optimise them, and configuring a remotePatterns entry per
    // edge subdomain isn't worth the maintenance burden.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      width={64}
      height={64}
      className="h-16 w-16 flex-none rounded border border-border object-cover"
      loading="lazy"
    />
  );
}

function Stat({
  label,
  value,
  prominent = false,
}: {
  label: string;
  value: string;
  prominent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={
          prominent
            ? "text-base font-semibold text-foreground"
            : "text-sm text-foreground"
        }
      >
        {value}
      </div>
    </div>
  );
}

function ErrorBox({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        {title}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}

function EmptyBox({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-6 text-center">
      <div className="mb-1 text-sm font-medium text-foreground">{title}</div>
      <p className="mb-3 text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}
