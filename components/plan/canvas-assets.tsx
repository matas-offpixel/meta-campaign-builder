"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AssetStrip } from "@/components/viz/asset-strip";
import { InfoTip } from "@/components/viz/info-tip";
import { assetStripFromMatrix } from "@/lib/plan/canvas-inputs";
import { TIKTOK_LAUNCHED_UNROUTE_NOTE, type RoutingMatrixRow } from "@/lib/plan/asset-routing";
import type { VizPlatform } from "@/lib/viz/tokens";

/**
 * Zone F — what creative exists and where it goes. One line, from the
 * same `asset-routes` endpoint the matrix used. Upload still happens on
 * Meta, so `+` opens the Meta draft rather than a file picker (the plan
 * page has never accepted an upload and still does not).
 */
export function CanvasAssets({
  planId,
  hasMetaDraft,
  onUpload,
  onUnregistered,
}: {
  planId: string;
  hasMetaDraft: boolean;
  onUpload: () => void;
  onUnregistered: (count: number) => void;
}) {
  const [rows, setRows] = useState<RoutingMatrixRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!hasMetaDraft) {
      setRows([]);
      onUnregistered(0);
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
      setError(json.error ?? null);
      return;
    }
    setRows(json.rows ?? []);
    setNote(json.note ?? null);
    setLaunched(json.launched === true);
    setError(null);
    onUnregistered(json.unregisteredCount ?? 0);
  }, [hasMetaDraft, onUnregistered, planId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch lifecycle when the Meta draft appears
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

  const view = useMemo(() => assetStripFromMatrix(rows), [rows]);

  async function toggle(assetId: string, platform: VizPlatform) {
    if (platform !== "tiktok") return;
    const enabled = !(view.routing[assetId] ?? []).includes("tiktok");
    setError(null);
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
      setError(json.error ?? null);
      return;
    }
    setRows(json.rows ?? []);
    setNote(json.note ?? null);
  }

  return (
    <section aria-label="assets" className="flex min-h-[72px] flex-wrap items-center gap-2">
      <AssetStrip
        assets={view.assets}
        routing={view.routing}
        disabledReasons={view.disabledReasons}
        onUpload={onUpload}
        onToggle={(assetId, platform) => void toggle(assetId, platform)}
      />
      {launched ? <InfoTip label={TIKTOK_LAUNCHED_UNROUTE_NOTE} /> : null}
      {note ? <InfoTip label={note} /> : null}
      {error ? <InfoTip label={error} /> : null}
    </section>
  );
}
