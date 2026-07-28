"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SLUG_BY_KIND, type BMAssetKind } from "@/lib/bm/asset-kinds";
import type { BMAssetView } from "@/lib/db/bm-assets";

/**
 * Per-asset detail for one Business Manager and one asset kind, loaded on demand
 * when an operator expands a row. Kept out of the server payload because a BM
 * can hold hundreds of assets across four kinds and the dashboard only ever
 * shows one expanded row at a time.
 */

interface Props {
  businessId: string;
  kind: BMAssetKind;
  /** Grants one asset then refreshes both this list and the parent counts. */
  onGrant: (assetId: string, url: string) => Promise<boolean>;
  busyKey: string | null;
  disabled: boolean;
}

export function BMAssetList({ businessId, kind, onGrant, busyKey, disabled }: Props) {
  const [assets, setAssets] = useState<BMAssetView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const slug = SLUG_BY_KIND[kind];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/business-managers/${businessId}/assets/${slug}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; assets?: BMAssetView[] }
        | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? `Could not load assets (${res.status})`);
        setAssets(null);
        return;
      }
      setAssets(body.assets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setAssets(null);
    } finally {
      setLoading(false);
    }
  }, [businessId, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && assets === null) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p>;
  }
  if (error) {
    return (
      <div className="px-4 py-3 text-xs text-red-700">
        {error}{" "}
        <button type="button" className="underline" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }
  if (!assets || assets.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Nothing found. Run <span className="font-medium">Sync now</span> to enumerate this
        Business Manager.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {assets.map((asset) => {
        const key = `grant:${businessId}:${asset.asset_id}`;
        return (
          <li key={asset.asset_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm">
                {asset.name ?? asset.asset_id}
                {asset.inactive ? (
                  <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    inactive
                  </span>
                ) : null}
                {!asset.is_owned_by_bm ? (
                  <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    shared in
                  </span>
                ) : null}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {asset.asset_id}
                {asset.subtitle ? ` · ${asset.subtitle}` : ""}
              </p>
              {asset.user_has_access && asset.user_tasks.length > 0 ? (
                <p className="truncate text-[11px] text-muted-foreground">
                  tasks: {asset.user_tasks.join(", ")}
                </p>
              ) : null}
            </div>
            {asset.user_has_access ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                <ShieldCheck className="h-3.5 w-3.5" /> Access
              </span>
            ) : (
              <Button
                size="sm"
                onClick={async () => {
                  const ok = await onGrant(
                    key,
                    `/api/business-managers/${businessId}/assets/${slug}/${encodeURIComponent(asset.asset_id)}/grant`,
                  );
                  if (ok) await load();
                }}
                disabled={busyKey === key || disabled}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                {busyKey === key ? "Granting…" : "Grant me access"}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
