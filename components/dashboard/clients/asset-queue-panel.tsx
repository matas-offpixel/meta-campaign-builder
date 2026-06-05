"use client";

/**
 * AssetQueuePanel
 *
 * Renders the full asset queue workflow for a client:
 *   - No config → "Set up asset queue" CTA
 *   - Configured → Scrape button + queue table grouped by status
 *
 * Each "matched" row has a Prepare button; each "pending" row has a
 * Confirm & Launch modal (opens in-place). "launched" rows are collapsed.
 * "error" rows show expandable error + Retry/Skip buttons.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, RefreshCw, ChevronDown, ChevronRight,
  ExternalLink, AlertCircle, CheckCircle2, Clock, SkipForward,
} from "lucide-react";
import Link from "next/link";
import type { AssetQueueRow, AssetQueueStatus } from "@/lib/db/asset-queue";

interface ScrapeResult {
  scraped: number;
  new: number;
  matched: number;
  errors: number;
  errorDetails: Array<{ assetName: string; location: string; reason: string }>;
}

interface AssetQueuePanelProps {
  clientId: string;
  /** When supplied, skips the internal config-fetch (server pre-loaded). */
  hasConfig?: boolean;
}

const STATUS_LABEL: Record<AssetQueueStatus, string> = {
  matched: "Ready to prepare",
  pending: "Ready to confirm",
  confirmed: "Confirmed",
  launched: "Launched",
  skipped: "Skipped",
  error: "Error",
};

const STATUS_COLOUR: Record<AssetQueueStatus, string> = {
  matched: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  confirmed: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  launched: "bg-green-500/15 text-green-700 dark:text-green-300",
  skipped: "bg-muted text-muted-foreground",
  error: "bg-red-500/15 text-red-700 dark:text-red-300",
};

function StatusBadge({ status }: { status: AssetQueueStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOUR[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ─── Confirm & Launch modal ───────────────────────────────────────────────────

interface ConfirmModalProps {
  row: AssetQueueRow;
  clientId: string;
  onClose: () => void;
  onLaunched: () => void;
}

function ConfirmModal({ row, clientId, onClose, onLaunched }: ConfirmModalProps) {
  const [primaryText, setPrimaryText] = useState(row.generated_copy ?? "");
  const [headline, setHeadline] = useState("");
  const [ctaValue, setCtaValue] = useState(row.generated_cta ?? "LEARN_MORE");
  const [destUrl, setDestUrl] = useState(row.generated_url ?? "");
  const [adAccountId, setAdAccountId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [adSetIds, setAdSetIds] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLaunch() {
    if (!adAccountId || !campaignId || !adSetIds) {
      setError("Ad Account ID, Campaign ID, and Ad Set IDs are required.");
      return;
    }
    const adSetIdList = adSetIds.split(",").map((s) => s.trim()).filter(Boolean);
    if (adSetIdList.length === 0) {
      setError("Enter at least one ad set ID.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Save confirmed overrides first
      await fetch(`/api/clients/${clientId}/asset-queue/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          overrides: { primaryText, headline, ctaValue, destUrl },
        }),
      });

      // Call bulk-attach-ads with a single creative
      const creative = {
        primaryText,
        headline,
        callToAction: ctaValue,
        destinationUrl: destUrl,
        storageAssetPath: row.asset_blob_url,
      };

      const bulkRes = await fetch("/api/meta/bulk-attach-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adAccountId,
          campaignAdSets: { [campaignId]: adSetIdList },
          newCreatives: [creative],
        }),
      });

      const bulkData = await bulkRes.json();
      if (!bulkRes.ok) {
        setError(bulkData.error ?? "Launch failed");
        return;
      }

      // Extract Meta ad IDs from the bulk-attach response
      const metaAdIds: string[] = [];
      for (const campaign of Object.values(bulkData.campaigns ?? {})) {
        const c = campaign as { ads?: Array<{ adId: string }> };
        for (const ad of c.ads ?? []) {
          if (ad.adId) metaAdIds.push(ad.adId);
        }
      }

      // Mark row as launched
      await fetch(`/api/clients/${clientId}/asset-queue/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "launched", metaAdIds }),
      });

      onLaunched();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-heading text-lg tracking-wide">Confirm & Launch</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {row.asset_name} · {row.funnel} · {row.location}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {/* Asset preview */}
        {row.asset_blob_url && (
          <div className="mb-4 overflow-hidden rounded-lg border border-border bg-muted">
            {/\.(mp4|mov|webm)$/i.test(row.asset_blob_url) ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                src={`/api/storage-proxy?path=${encodeURIComponent(row.asset_blob_url)}`}
                controls
                className="max-h-48 w-full object-contain"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/storage-proxy?path=${encodeURIComponent(row.asset_blob_url)}`}
                alt={row.asset_name ?? "Asset preview"}
                className="max-h-48 w-full object-contain"
              />
            )}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Event</label>
            <p className="mt-0.5 text-sm">{row.resolved_event_code ?? "—"}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Primary text <span className="text-muted-foreground/60">(max 100 chars)</span>
            </label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              rows={3}
              maxLength={100}
              value={primaryText}
              onChange={(e) => setPrimaryText(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Headline <span className="text-muted-foreground/60">(max 30 chars)</span>
              </label>
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                maxLength={30}
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">CTA</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={ctaValue}
                onChange={(e) => setCtaValue(e.target.value)}
              >
                {["WATCH_MORE", "LEARN_MORE", "GET_TICKETS", "SIGN_UP", "BOOK_TRAVEL", "BUY_TICKETS"].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Destination URL</label>
            <input
              type="url"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={destUrl}
              onChange={(e) => setDestUrl(e.target.value)}
            />
          </div>

          <hr className="border-border" />

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Ad Account ID</label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="act_..."
              value={adAccountId}
              onChange={(e) => setAdAccountId(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Campaign ID</label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Ad Set IDs <span className="text-muted-foreground/60">(comma-separated)</span>
            </label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              value={adSetIds}
              onChange={(e) => setAdSetIds(e.target.value)}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleLaunch}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Launch to Meta
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Queue row card ───────────────────────────────────────────────────────────

function QueueRowCard({
  row,
  clientId,
  onUpdate,
}: {
  row: AssetQueueRow;
  clientId: string;
  onUpdate: () => void;
}) {
  const [preparing, setPreparing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handlePrepare() {
    setPreparing(true);
    try {
      await fetch(`/api/clients/${clientId}/asset-queue/${row.id}/prepare`, { method: "POST" });
      onUpdate();
    } finally {
      setPreparing(false);
    }
  }

  async function handleSkip() {
    await fetch(`/api/clients/${clientId}/asset-queue/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "skip" }),
    });
    onUpdate();
  }

  const isCollapsed = row.status === "launched" || row.status === "skipped";

  return (
    <>
      {showConfirm && (
        <ConfirmModal
          row={row}
          clientId={clientId}
          onClose={() => setShowConfirm(false)}
          onLaunched={() => { setShowConfirm(false); onUpdate(); }}
        />
      )}

      <div className="rounded-lg border border-border bg-card">
        <div
          className="flex cursor-pointer items-center gap-3 p-3"
          onClick={() => isCollapsed && setExpanded((e) => !e)}
        >
          {isCollapsed ? (
            expanded
              ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : null}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="truncate text-sm font-medium">{row.asset_name ?? "—"}</span>
              <StatusBadge status={row.status} />
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {[row.funnel, row.location, row.nation].filter(Boolean).join(" · ")}
              {row.resolved_event_code && ` → ${row.resolved_event_code}`}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {row.status === "matched" && (
              <button
                onClick={handlePrepare}
                disabled={preparing}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
              >
                {preparing && <Loader2 className="h-3 w-3 animate-spin" />}
                Prepare
              </button>
            )}
            {row.status === "pending" && (
              <button
                onClick={() => setShowConfirm(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Confirm & Launch
              </button>
            )}
            {(row.status === "matched" || row.status === "pending" || row.status === "error") && (
              <button
                onClick={handleSkip}
                title="Skip this row"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <SkipForward className="h-3.5 w-3.5" />
              </button>
            )}
            {row.status === "launched" && row.launched_meta_ad_ids && (row.launched_meta_ad_ids as string[]).length > 0 && (
              <a
                href={`https://www.facebook.com/adsmanager/manage/ads`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                Ads Manager
              </a>
            )}
          </div>
        </div>

        {row.status === "error" && (
          <div className="border-t border-border px-3 pb-3 pt-2 text-xs text-destructive">
            <AlertCircle className="mr-1 inline-block h-3.5 w-3.5" />
            {row.error_message === "no_venue_mapping"
              ? `No venue mapping found for "${row.location}". Add one in Venue Mappings.`
              : row.error_message ?? "Unknown error"}
          </div>
        )}

        {row.status === "launched" && expanded && (
          <div className="border-t border-border px-3 pb-3 pt-2 text-xs text-muted-foreground">
            Ad IDs: {(row.launched_meta_ad_ids as string[] | null)?.join(", ") ?? "—"}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

const STATUS_ORDER: AssetQueueStatus[] = ["error", "matched", "pending", "confirmed", "launched", "skipped"];

export function AssetQueuePanel({ clientId, hasConfig: hasConfigProp }: AssetQueuePanelProps) {
  const [rows, setRows] = useState<AssetQueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  // null = still fetching, true/false = resolved
  const [hasConfig, setHasConfig] = useState<boolean | null>(hasConfigProp ?? null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/asset-queue?pageSize=100`);
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (hasConfigProp !== undefined) {
      if (hasConfigProp) loadQueue();
      return;
    }
    // Self-fetch config status
    fetch(`/api/clients/${clientId}/asset-sheet-config`)
      .then((r) => r.json())
      .then((data) => {
        const configured = !!data.config?.google_sheet_id;
        setHasConfig(configured);
        if (configured) loadQueue();
      })
      .catch(() => setHasConfig(false));
  }, [clientId, hasConfigProp, loadQueue]);

  async function handleScrape() {
    setScraping(true);
    setScrapeResult(null);
    setScrapeError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/asset-queue/scrape`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setScrapeError(data.error ?? "Scrape failed");
      } else {
        setScrapeResult(data);
        await loadQueue();
      }
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setScraping(false);
    }
  }

  if (hasConfig === null) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!hasConfig) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
        <div className="mb-3 text-4xl">📋</div>
        <h3 className="font-heading text-base tracking-wide">Asset queue not configured</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Connect a Google Sheet to start ingesting Dropbox creative assets automatically.
        </p>
        <Link
          href={`/clients/${clientId}/asset-queue/config`}
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Set up asset queue
        </Link>
      </div>
    );
  }

  const grouped = new Map<AssetQueueStatus, AssetQueueRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.status) ?? [];
    existing.push(row);
    grouped.set(row.status, existing);
  }

  const activeCount =
    (grouped.get("matched")?.length ?? 0) +
    (grouped.get("pending")?.length ?? 0) +
    (grouped.get("error")?.length ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-base tracking-wide">Asset Queue</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {total} total · {activeCount} need attention
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/clients/${clientId}/venue-mappings`}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Venue mappings
          </Link>
          <Link
            href={`/clients/${clientId}/asset-queue/config`}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Config
          </Link>
          <button
            onClick={handleScrape}
            disabled={scraping}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {scraping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Scrape new assets
          </button>
        </div>
      </div>

      {scrapeResult && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
          <div>
            Found <strong>{scrapeResult.scraped}</strong> rows in sheet ·{" "}
            <strong>{scrapeResult.new}</strong> new ·{" "}
            <strong>{scrapeResult.matched}</strong> matched to events
            {scrapeResult.errors > 0 && (
              <> · <span className="text-destructive"><strong>{scrapeResult.errors}</strong> need venue mapping</span></>
            )}
          </div>
        </div>
      )}
      {scrapeError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {scrapeError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No assets in queue. Click &ldquo;Scrape new assets&rdquo; to pull from the sheet.
        </div>
      ) : (
        <div className="space-y-6">
          {STATUS_ORDER.map((status) => {
            const group = grouped.get(status);
            if (!group || group.length === 0) return null;
            return (
              <section key={status}>
                <div className="mb-2 flex items-center gap-2">
                  {status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
                  {(status === "matched" || status === "pending") && <Clock className="h-4 w-4 text-blue-500" />}
                  {status === "launched" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                  <h3 className="text-sm font-medium">
                    {STATUS_LABEL[status]}
                    <span className="ml-1.5 text-muted-foreground">({group.length})</span>
                  </h3>
                </div>
                <div className="space-y-2">
                  {group.map((row) => (
                    <QueueRowCard key={row.id} row={row} clientId={clientId} onUpdate={loadQueue} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
