"use client";

/**
 * AssetQueuePanel
 *
 * Renders the full asset queue workflow for a client:
 *   - No config → "Set up asset queue" CTA
 *   - Configured → Scrape button + queue table grouped by status
 *
 * Status flows:
 *   matched / matched_umbrella → [Prepare] → pending
 *   pending (single-venue)     → [Confirm & Launch modal] → launched
 *   pending (umbrella)         → [Review & Confirm modal] → confirmed
 *   confirmed (umbrella)       → [Open Bulk Attach] → (external bulk-attach)
 *   error                      → [Retry / Skip]
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, RefreshCw, ChevronDown, ChevronRight,
  ExternalLink, AlertCircle, CheckCircle2, Clock, SkipForward, Globe,
} from "lucide-react";
import Link from "next/link";
import type { AssetQueueRow, AssetQueueStatus } from "@/lib/db/asset-queue";

const BULK_ATTACH_CAP = 8;

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
  matched_umbrella: "Umbrella — ready to prepare",
  pending: "Ready to confirm",
  confirmed: "Confirmed",
  launched: "Launched",
  skipped: "Skipped",
  error: "Error",
};

const STATUS_COLOUR: Record<AssetQueueStatus, string> = {
  matched: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  matched_umbrella: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  confirmed: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  launched: "bg-green-500/15 text-green-700 dark:text-green-300",
  skipped: "bg-muted text-muted-foreground",
  error: "bg-red-500/15 text-red-700 dark:text-red-300",
};

function StatusBadge({ status }: { status: AssetQueueStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOUR[status]}`}>
      {status === "matched_umbrella" && <Globe className="h-3 w-3" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

// ─── Confirm modal (single-venue) ─────────────────────────────────────────────

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
      await fetch(`/api/clients/${clientId}/asset-queue/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          overrides: { primaryText, headline, ctaValue, destUrl },
        }),
      });

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

      const metaAdIds: string[] = [];
      for (const campaign of Object.values(bulkData.campaigns ?? {})) {
        const c = campaign as { ads?: Array<{ adId: string }> };
        for (const ad of c.ads ?? []) {
          if (ad.adId) metaAdIds.push(ad.adId);
        }
      }

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
    <ModalShell title="Confirm & Launch" subtitle={`${row.asset_name} · ${row.funnel} · ${row.location}`} onClose={onClose}>
      <AssetPreview row={row} />

      <div className="space-y-3">
        <InfoRow label="Event">{row.resolved_event_code ?? "—"}</InfoRow>
        <CopyFields
          primaryText={primaryText} setPrimaryText={setPrimaryText}
          headline={headline} setHeadline={setHeadline}
          ctaValue={ctaValue} setCtaValue={setCtaValue}
          destUrl={destUrl} setDestUrl={setDestUrl}
        />

        <hr className="border-border" />

        <TextInput label="Ad Account ID" placeholder="act_..." value={adAccountId} onChange={setAdAccountId} />
        <TextInput label="Campaign ID" value={campaignId} onChange={setCampaignId} />
        <TextInput label="Ad Set IDs (comma-separated)" value={adSetIds} onChange={setAdSetIds} />

        {error && <ErrorBox>{error}</ErrorBox>}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
        <button
          onClick={handleLaunch}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Launch to Meta
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Umbrella review modal (confirm copy; no direct Meta launch) ───────────────

interface UmbrellaReviewModalProps {
  row: AssetQueueRow;
  clientId: string;
  onClose: () => void;
  onConfirmed: () => void;
}

function UmbrellaReviewModal({ row, clientId, onClose, onConfirmed }: UmbrellaReviewModalProps) {
  const [primaryText, setPrimaryText] = useState(row.generated_copy ?? "");
  const [headline, setHeadline] = useState("");
  const [ctaValue, setCtaValue] = useState(row.generated_cta ?? "LEARN_MORE");
  const [destUrl, setDestUrl] = useState(row.generated_url ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codes = row.resolved_event_codes_multi ?? [];

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/asset-queue/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          overrides: { primaryText, headline, ctaValue, destUrl },
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Save failed");
        return;
      }
      onConfirmed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell
      title="Review Umbrella Copy"
      subtitle={`${row.asset_name} · ${row.funnel} · All ${row.nation ?? ""} venues`}
      onClose={onClose}
    >
      <AssetPreview row={row} />

      <div className="mb-3 rounded-lg border border-teal-200 bg-teal-50 p-3 dark:border-teal-800 dark:bg-teal-950/30">
        <p className="text-xs font-medium text-teal-800 dark:text-teal-200">
          Umbrella asset — will attach to {codes.length} venue{codes.length !== 1 ? "s" : ""}
        </p>
        <p className="mt-1 text-xs text-teal-700 dark:text-teal-300">
          {codes.join(", ") || "—"}
        </p>
        <p className="mt-1.5 text-xs text-teal-600 dark:text-teal-400">
          Confirm the copy here, then use &ldquo;Open Bulk Attach&rdquo; to select campaigns for each venue.
        </p>
      </div>

      <div className="space-y-3">
        <CopyFields
          primaryText={primaryText} setPrimaryText={setPrimaryText}
          headline={headline} setHeadline={setHeadline}
          ctaValue={ctaValue} setCtaValue={setCtaValue}
          destUrl={destUrl} setDestUrl={setDestUrl}
        />

        {error && <ErrorBox>{error}</ErrorBox>}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Confirm copy
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Shared modal primitives ──────────────────────────────────────────────────

function ModalShell({ title, subtitle, onClose, children }: {
  title: string; subtitle: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-heading text-lg tracking-wide">{title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AssetPreview({ row }: { row: AssetQueueRow }) {
  if (!row.asset_blob_url) return null;
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-border bg-muted">
      {/\.(mp4|mov|webm)$/i.test(row.asset_blob_url) ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={`/api/storage-proxy?path=${encodeURIComponent(row.asset_blob_url)}`} controls className="max-h-48 w-full object-contain" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/storage-proxy?path=${encodeURIComponent(row.asset_blob_url)}`} alt={row.asset_name ?? "Asset preview"} className="max-h-48 w-full object-contain" />
      )}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <p className="mt-0.5 text-sm">{children}</p>
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <input
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {children}
    </div>
  );
}

function CopyFields({ primaryText, setPrimaryText, headline, setHeadline, ctaValue, setCtaValue, destUrl, setDestUrl }: {
  primaryText: string; setPrimaryText: (v: string) => void;
  headline: string; setHeadline: (v: string) => void;
  ctaValue: string; setCtaValue: (v: string) => void;
  destUrl: string; setDestUrl: (v: string) => void;
}) {
  return (
    <>
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Primary text <span className="text-muted-foreground/60">(max 100 chars)</span></label>
        <textarea
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          rows={3} maxLength={100} value={primaryText} onChange={(e) => setPrimaryText(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Headline <span className="text-muted-foreground/60">(max 30 chars)</span></label>
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            maxLength={30} value={headline} onChange={(e) => setHeadline(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">CTA</label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={ctaValue} onChange={(e) => setCtaValue(e.target.value)}
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
          value={destUrl} onChange={(e) => setDestUrl(e.target.value)}
        />
      </div>
    </>
  );
}

// ─── Override URL form ────────────────────────────────────────────────────────

/**
 * Error codes where Dropbox folder listing has failed and the user can rescue
 * the row by pasting individual /scl/fi/ file URLs.
 * "config_missing" is NOT overrideable — it requires ops to set the env var.
 */
const OVERRIDEABLE_CODES = new Set([
  "network",
  "folder_too_large",
  "empty_folder",
  "not_found",
  "forbidden",
]);

function isOverrideable(errorMessage: string | null): boolean {
  if (!errorMessage) return false;
  return OVERRIDEABLE_CODES.has(errorMessage);
}

interface OverrideUrlsFormProps {
  clientId: string;
  queueId: string;
  onSuccess: () => void;
}

function OverrideUrlsForm({ clientId, queueId, onSuccess }: OverrideUrlsFormProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const urls = input.split(",").map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) {
      setError("Paste at least one Dropbox file URL.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/clients/${clientId}/asset-queue/${queueId}/override-urls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Override failed");
        return;
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-t border-amber-200 bg-amber-50/50 px-3 pb-3 pt-2 dark:border-amber-800 dark:bg-amber-950/20">
      <p className="mb-1.5 text-xs font-medium text-amber-800 dark:text-amber-200">
        Override: paste direct file URL(s)
      </p>
      <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
        Open the Dropbox folder in your browser, click each file, copy its individual share link
        (format: <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">dropbox.com/scl/fi/…</code>),
        then paste them here comma-separated.
      </p>
      <div className="flex items-start gap-2">
        <textarea
          className="min-h-[52px] flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="https://www.dropbox.com/scl/fi/..., https://www.dropbox.com/scl/fi/..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          Override &amp; prepare
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-destructive">
          <AlertCircle className="mr-1 inline-block h-3 w-3" />
          {error}
        </p>
      )}
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
  const router = useRouter();
  const [preparing, setPreparing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showUmbrellaReview, setShowUmbrellaReview] = useState(false);
  const [openingBulkAttach, setOpeningBulkAttach] = useState(false);

  const isUmbrella = !!(row.resolved_event_codes_multi && row.resolved_event_codes_multi.length > 0);
  const isCollapsed = row.status === "launched" || row.status === "skipped";

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

  /** For confirmed umbrella rows: resolve first code → event ID → navigate to bulk-attach. */
  async function handleOpenBulkAttach() {
    const codes = row.resolved_event_codes_multi ?? [];
    if (codes.length === 0) return;

    setOpeningBulkAttach(true);
    try {
      const anchorEventId = row.resolved_event_id;
      if (!anchorEventId) {
        // Fallback: look up via events API by first code
        const res = await fetch(`/api/events?q=${encodeURIComponent(codes[0])}&pageSize=1`);
        const data = await res.json();
        const event = data.events?.[0];
        if (!event) {
          alert(`Could not resolve event for code "${codes[0]}". Please open Bulk Attach manually.`);
          return;
        }
        const preselectCodes = codes.slice(0, BULK_ATTACH_CAP).join(",");
        router.push(`/events/${event.id}/bulk-attach?preselectCodes=${encodeURIComponent(preselectCodes)}`);
      } else {
        const preselectCodes = codes.slice(0, BULK_ATTACH_CAP).join(",");
        router.push(`/events/${anchorEventId}/bulk-attach?preselectCodes=${encodeURIComponent(preselectCodes)}`);
      }
    } finally {
      setOpeningBulkAttach(false);
    }
  }

  return (
    <>
      {showConfirm && !isUmbrella && (
        <ConfirmModal
          row={row}
          clientId={clientId}
          onClose={() => setShowConfirm(false)}
          onLaunched={() => { setShowConfirm(false); onUpdate(); }}
        />
      )}
      {showUmbrellaReview && (
        <UmbrellaReviewModal
          row={row}
          clientId={clientId}
          onClose={() => setShowUmbrellaReview(false)}
          onConfirmed={() => { setShowUmbrellaReview(false); onUpdate(); }}
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
              {isUmbrella
                ? ` → ${(row.resolved_event_codes_multi ?? []).length} venues`
                : row.resolved_event_code
                  ? ` → ${row.resolved_event_code}`
                  : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {(row.status === "matched" || row.status === "matched_umbrella") && (
              <button
                onClick={handlePrepare}
                disabled={preparing}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
              >
                {preparing && <Loader2 className="h-3 w-3 animate-spin" />}
                Prepare
              </button>
            )}
            {row.status === "pending" && !isUmbrella && (
              <button
                onClick={() => setShowConfirm(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Confirm &amp; Launch
              </button>
            )}
            {row.status === "pending" && isUmbrella && (
              <button
                onClick={() => setShowUmbrellaReview(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700"
              >
                Review &amp; Confirm
              </button>
            )}
            {row.status === "confirmed" && isUmbrella && (
              <button
                onClick={handleOpenBulkAttach}
                disabled={openingBulkAttach}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {openingBulkAttach
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <ExternalLink className="h-3 w-3" />}
                Open Bulk Attach
              </button>
            )}
            {(row.status === "matched" || row.status === "matched_umbrella" || row.status === "pending" || row.status === "error") && (
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
                href="https://www.facebook.com/adsmanager/manage/ads"
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
          <>
            <div className="border-t border-border px-3 pb-3 pt-2 text-xs text-destructive">
              <AlertCircle className="mr-1 inline-block h-3.5 w-3.5" />
              {row.error_message === "no_venue_mapping"
                ? `No venue mapping found for "${row.location}". Add one in Venue Mappings.`
                : row.error_message === "config_missing"
                  ? "Dropbox integration not configured — contact ops to set DROPBOX_ACCESS_TOKEN in Vercel env."
                  : row.error_message === "not_found"
                    ? "Dropbox folder not accessible — check the share link is still active in Joe's sheet. Use the override below to paste direct file links."
                    : row.error_message === "network"
                      ? "Dropbox folder listing failed (network error). Use the override below to paste direct file links."
                      : row.error_message === "folder_too_large"
                        ? "Folder exceeds the 500 MB limit. Use the override below to paste individual file links."
                        : row.error_message === "empty_folder"
                          ? "No media files found in the Dropbox folder. Use the override below to paste direct file links."
                          : row.error_message ?? "Unknown error"}
            </div>
            {isOverrideable(row.error_message) && (
              <OverrideUrlsForm
                clientId={clientId}
                queueId={row.id}
                onSuccess={onUpdate}
              />
            )}
          </>
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

const STATUS_ORDER: AssetQueueStatus[] = [
  "error", "matched_umbrella", "matched", "pending", "confirmed", "launched", "skipped",
];

export function AssetQueuePanel({ clientId, hasConfig: hasConfigProp }: AssetQueuePanelProps) {
  const [rows, setRows] = useState<AssetQueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
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
    (grouped.get("matched_umbrella")?.length ?? 0) +
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
          <Link href={`/clients/${clientId}/venue-mappings`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            Venue mappings
          </Link>
          <Link href={`/clients/${clientId}/asset-queue/config`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
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
                  {status === "matched_umbrella" && <Globe className="h-4 w-4 text-teal-500" />}
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
