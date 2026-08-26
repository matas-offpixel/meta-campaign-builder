"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { BackfillOutcomeRow } from "@/lib/plan/asset-backfill";
import {
  GOOGLE_NO_ASSETS_COPY,
  TIKTOK_LAUNCHED_UNROUTE_NOTE,
  type RoutingMatrixRow,
} from "@/lib/plan/asset-routing";
import {
  diffNewAssetIds,
  planSeenAssetsStorageKey,
} from "@/lib/plan/live-mirror";

export function AssetRoutingMatrix({
  planId,
  hasMetaDraft,
}: {
  planId: string;
  hasMetaDraft: boolean;
}) {
  const [rows, setRows] = useState<RoutingMatrixRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unregisteredCount, setUnregisteredCount] = useState(0);
  const [backfillRows, setBackfillRows] = useState<BackfillOutcomeRow[]>([]);
  const [backfilling, setBackfilling] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const markNewAssets = useCallback((nextRows: RoutingMatrixRow[]) => {
    if (typeof window === "undefined") return;
    const key = planSeenAssetsStorageKey(planId);
    let seen: string[] | null = null;
    try {
      const raw = window.sessionStorage.getItem(key);
      seen = raw ? (JSON.parse(raw) as string[]) : null;
      if (!Array.isArray(seen)) seen = null;
    } catch {
      seen = null;
    }
    const diff = diffNewAssetIds(
      nextRows.map((row) => row.asset.id),
      seen,
    );
    setNewIds(new Set(diff.newIds));
    window.sessionStorage.setItem(key, JSON.stringify(diff.nextSeen));
  }, [planId]);

  const refresh = useCallback(async () => {
    if (!hasMetaDraft) {
      setRows([]);
      setNote("Build the Meta campaign and upload assets first.");
      setUnregisteredCount(0);
      return;
    }
    const res = await fetch(`/api/plan/${encodeURIComponent(planId)}/asset-routes`);
    const json = (await res.json()) as {
      ok?: boolean;
      rows?: RoutingMatrixRow[];
      note?: string | null;
      launched?: boolean;
      unregisteredCount?: number;
      error?: string;
    };
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Could not load routing matrix");
      return;
    }
    const nextRows = json.rows ?? [];
    setRows(nextRows);
    setNote(json.note ?? null);
    setLaunched(json.launched === true);
    setUnregisteredCount(json.unregisteredCount ?? 0);
    setError(null);
    markNewAssets(nextRows);
  }, [hasMetaDraft, markNewAssets, planId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onFocus() {
      void refresh();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") void refresh();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  async function setEnabled(assetId: string, enabled: boolean) {
    setBusyId(assetId);
    setError(null);
    try {
      const res = await fetch(`/api/plan/${encodeURIComponent(planId)}/asset-routes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, enabled }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        rows?: RoutingMatrixRow[];
        note?: string | null;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not update routing");
        return;
      }
      setRows(json.rows ?? []);
      setNote(json.note ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update routing");
    } finally {
      setBusyId(null);
    }
  }

  async function retry(assetId: string) {
    setBusyId(assetId);
    setError(null);
    try {
      const res = await fetch(`/api/plan/${encodeURIComponent(planId)}/asset-routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        rows?: RoutingMatrixRow[];
        note?: string | null;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Retry failed");
        return;
      }
      setRows(json.rows ?? []);
      setNote(json.note ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusyId(null);
    }
  }

  async function registerExisting() {
    setBackfilling(true);
    setError(null);
    try {
      const res = await fetch(`/api/plan/${encodeURIComponent(planId)}/asset-backfill`, {
        method: "POST",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        rows?: BackfillOutcomeRow[];
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not register existing assets");
        return;
      }
      setBackfillRows(json.rows ?? []);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register existing assets");
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-heading text-lg tracking-wide">Asset routing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One upload on Meta, selective fan-out. This matrix only routes — it
          does not upload or retarget.
        </p>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {unregisteredCount > 0 ? (
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={backfilling}
            onClick={() => void registerExisting()}
          >
            Register {unregisteredCount} existing asset{unregisteredCount === 1 ? "" : "s"}
          </Button>
        </div>
      ) : null}
      {backfillRows.some((row) => row.status === "cannot_register") ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {backfillRows
            .filter((row) => row.status === "cannot_register")
            .map((row) => (
              <li key={row.platformId}>
                {row.filename}: {row.reason}
              </li>
            ))}
        </ul>
      ) : null}
      {launched ? (
        <p className="text-xs text-muted-foreground">{TIKTOK_LAUNCHED_UNROUTE_NOTE}</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Asset</th>
                <th className="px-3 py-2 font-medium">Meta</th>
                <th className="px-3 py-2 font-medium">TikTok</th>
                <th className="px-3 py-2 font-medium">Google</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.asset.id} className="border-t border-border">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      {row.asset.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.asset.thumbnailUrl}
                          alt=""
                          className="h-12 w-12 rounded object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded bg-muted" />
                      )}
                      <div>
                        <p className="font-medium">
                          {row.asset.filename}
                          {newIds.has(row.asset.id) ? (
                            <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                              new
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.asset.mediaKind} · {row.asset.aspectRatio}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    Already on Meta
                  </td>
                  <td className="px-3 py-3">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={row.tiktok.enabled}
                        disabled={row.tiktok.disabled || busyId === row.asset.id}
                        onChange={(e) => void setEnabled(row.asset.id, e.target.checked)}
                      />
                      {row.tiktok.disabled
                        ? row.tiktok.disabledReason
                        : row.tiktok.enabled
                          ? "Route to TikTok"
                          : "Off"}
                    </label>
                    {row.tiktok.uploadStatus === "failed" && row.tiktok.uploadError ? (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-destructive">{row.tiktok.uploadError}</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === row.asset.id}
                          onClick={() => void retry(row.asset.id)}
                        >
                          Retry
                        </Button>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {GOOGLE_NO_ASSETS_COPY}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
