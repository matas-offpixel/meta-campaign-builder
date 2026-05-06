"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";

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

function adsManagerEditUrl(adAccountId: string, adId: string): string {
  const act = withoutActPrefix(adAccountId);
  const qs = new URLSearchParams({ act, selected_ad_ids: adId });
  return `https://www.facebook.com/adsmanager/manage/ads/edit?${qs.toString()}`;
}

export function EnhancementFlagBanner({ clientId, eventIds }: Props) {
  const [data, setData] = useState<EnhancementFlagsApiPayload | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

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

  if (!data || data.total_open === 0) {
    return null;
  }

  const { total_open, standard_enhancements_count } = data;

  const summary =
    standard_enhancements_count > 0
      ? `${total_open} ads have unauthorized Meta enhancements (incl. ${standard_enhancements_count} with the standard-enhancements bundle).`
      : `${total_open} ads have unauthorized Meta enhancements.`;

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
              const blockedFeatureKeys = Object.keys(row.flagged_features).filter(
                (k) => getPolicyTier(k) === "BLOCKED",
              );
              if (blockedFeatureKeys.length === 0) {
                return null;
              }
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
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      severity {row.severity_score}
                    </span>
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
              One-click fix shipping in next release.
            </p>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
