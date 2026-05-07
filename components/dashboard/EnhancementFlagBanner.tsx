"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCheck,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EnhancementFlagsApiPayload } from "@/lib/db/creative-enhancement-flags";
import {
  getPolicyTier,
  HEAVY_WEIGHT_FEATURE_KEYS,
} from "@/lib/meta/enhancement-policy";
import { withoutActPrefix } from "@/lib/meta/ad-account-id";

interface Props {
  clientId: string;
  /** When set, only flags for these events (excludes unlinked rows). */
  eventIds?: readonly string[] | null;
}

type ScanState = "idle" | "scanning" | "done" | "error";

function adsManagerEditUrl(adAccountId: string, adId: string): string {
  const act = withoutActPrefix(adAccountId);
  const qs = new URLSearchParams({ act, selected_ad_ids: adId });
  return `https://www.facebook.com/adsmanager/manage/ads/edit?${qs.toString()}`;
}

function formatRelativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

export function EnhancementFlagBanner({ clientId, eventIds }: Props) {
  const [data, setData] = useState<EnhancementFlagsApiPayload | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [acknowledging, setAcknowledging] = useState<Set<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const lastAckRef = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (eventIds && eventIds.length > 0) {
        qs.set("eventIds", [...eventIds].join(","));
      }
      const suffix = qs.toString();
      const url =
        `/api/clients/${encodeURIComponent(clientId)}/enhancement-flags` +
        (suffix ? `?${suffix}` : "");
      const res = await fetch(url, { cache: "no-store", credentials: "include" });
      if (!res.ok) return;
      const json = (await res.json()) as EnhancementFlagsApiPayload;
      setData(json);
    } catch {
      setData(null);
    }
  }, [clientId, eventIds]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const handleRescan = useCallback(async () => {
    if (scanState === "scanning") return;
    setScanState("scanning");

    let secondsLeft = 60;
    setScanMsg(`Scanning… ~${secondsLeft}s remaining`);
    countdownRef.current = setInterval(() => {
      secondsLeft -= 5;
      if (secondsLeft > 0) {
        setScanMsg(`Scanning… ~${secondsLeft}s remaining`);
      }
    }, 5_000);

    try {
      const res = await fetch(
        `/api/internal/scan-enhancement-flags?clientId=${encodeURIComponent(clientId)}`,
        { method: "POST", credentials: "include" },
      );

      clearInterval(countdownRef.current!);
      countdownRef.current = null;

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const errMsg = typeof body.error === "string" ? body.error : res.statusText;
        const isRateLimit =
          errMsg.toLowerCase().includes("rate limit") ||
          errMsg.includes("80004");
        setScanState("error");
        setScanMsg(
          isRateLimit
            ? "Meta is rate-limiting this account. Retry in ~30 min."
            : `Scan failed: ${errMsg}`,
        );
        return;
      }

      const json = (await res.json()) as { total_flagged_ads?: number };
      const flagged = json.total_flagged_ads ?? 0;
      setScanState("done");
      setScanMsg(`Scan complete. ${flagged} ad${flagged !== 1 ? "s" : ""} flagged.`);
      await load();
    } catch (err) {
      clearInterval(countdownRef.current ?? undefined);
      countdownRef.current = null;
      setScanState("error");
      setScanMsg(err instanceof Error ? err.message : "Scan failed");
    }
  }, [clientId, load, scanState]);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const handleAcknowledge = useCallback(
    async (flagId: string) => {
      const now = Date.now();
      if (now - lastAckRef.current < 5_000) return;
      if (acknowledging.has(flagId) || acknowledged.has(flagId)) return;
      lastAckRef.current = now;

      setAcknowledging((prev) => new Set([...prev, flagId]));
      try {
        const res = await fetch(
          `/api/clients/${encodeURIComponent(clientId)}/enhancement-flags/${encodeURIComponent(flagId)}`,
          { method: "PATCH", credentials: "include" },
        );
        if (res.ok) {
          setAcknowledged((prev) => new Set([...prev, flagId]));
        }
      } finally {
        setAcknowledging((prev) => {
          const next = new Set(prev);
          next.delete(flagId);
          return next;
        });
      }
    },
    [clientId, acknowledging, acknowledged],
  );

  if (!data || data.total_open === 0) {
    return null;
  }

  const { total_open, standard_enhancements_count, last_scan_at } = data;

  const summary =
    standard_enhancements_count > 0
      ? `${total_open} ads have unauthorized Meta enhancements (incl. ${standard_enhancements_count} with the standard-enhancements bundle).`
      : `${total_open} ads have unauthorized Meta enhancements.`;

  const lastScanLabel = formatRelativeTime(last_scan_at);
  const scanning = scanState === "scanning";

  const sortedFlags = [...data.open_flags].sort(
    (a, b) =>
      b.severity_score - a.severity_score ||
      new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime(),
  );

  return (
    <>
      <div
        role="status"
        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
      >
        <div className="flex flex-wrap items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1 leading-snug">
            <span>{summary}</span>{" "}
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-50"
            >
              Review →
            </button>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              type="button"
              disabled={scanning}
              onClick={() => void handleRescan()}
              className="inline-flex items-center gap-1 rounded border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-900 transition-opacity hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-200"
            >
              {scanning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {scanning ? "Scanning…" : "Re-scan now"}
            </button>
            {lastScanLabel && !scanMsg ? (
              <span className="text-[10px] text-amber-700/70 dark:text-amber-300/60">
                Last scan: {lastScanLabel}
              </span>
            ) : null}
            {scanMsg ? (
              <span
                className={`text-[10px] ${
                  scanState === "error"
                    ? "text-red-700 dark:text-red-400"
                    : "text-amber-700/70 dark:text-amber-300/60"
                }`}
              >
                {scanMsg}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog open={modalOpen} onClose={() => setModalOpen(false)}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
          <DialogHeader onClose={() => setModalOpen(false)}>
            <DialogTitle>Unauthorized Meta enhancements</DialogTitle>
            <DialogDescription>
              Ads flagged for Advantage+ features that should stay opted out per
              agency policy. Severity reflects bundled / high-impact switches.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {sortedFlags.map((row) => {
              if (acknowledged.has(row.id)) return null;
              const blockedFeatureKeys = Object.keys(row.flagged_features).filter(
                (k) => getPolicyTier(k) === "BLOCKED",
              );
              if (blockedFeatureKeys.length === 0) {
                return null;
              }
              const isAcking = acknowledging.has(row.id);
              return (
                <div
                  key={row.id}
                  className="rounded-md border border-border bg-card p-3 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {row.ad_name?.trim() || `Ad ${row.ad_id}`}
                      </p>
                      {row.event_name ? (
                        <p className="text-xs text-muted-foreground">{row.event_name}</p>
                      ) : null}
                      <p className="font-mono text-[10px] text-muted-foreground">
                        Creative {row.creative_id}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        severity {row.severity_score}
                      </span>
                      <button
                        type="button"
                        disabled={isAcking}
                        onClick={() => void handleAcknowledge(row.id)}
                        title="Acknowledge — removes from list; scanner re-flags if enhancement stays active"
                        className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-green-500/40 hover:bg-green-500/10 hover:text-green-700 disabled:opacity-50 dark:hover:text-green-400"
                      >
                        {isAcking ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCheck className="h-3 w-3" />
                        )}
                        Acknowledge
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {blockedFeatureKeys.map((key) => {
                      const heavy = HEAVY_WEIGHT_FEATURE_KEYS.has(key);
                      return (
                        <span
                          key={key}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                            heavy
                              ? "border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-200"
                              : "border-border bg-muted/40 text-muted-foreground"
                          }`}
                        >
                          {key}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mt-2">
                    <a
                      href={adsManagerEditUrl(row.ad_account_id, row.ad_id)}
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
            })}
          </div>

          <DialogFooter>
            <p className="w-full text-center text-xs text-muted-foreground">
              Acknowledging removes the row — scanner re-flags if the enhancement stays active.
            </p>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
