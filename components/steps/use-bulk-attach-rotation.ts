"use client";

import { useEffect, useState } from "react";

import type { AdSetGuardResponse } from "@/app/api/meta/bulk-attach-ads/adset-guard/route";
import type { AdCreativeDraft } from "@/lib/types";
import { bulkAttachRotationMessage, type LiveAdSetState } from "@/lib/meta/rotation-adset";
import { creativeTriggersVariationRotation } from "@/lib/meta/creative";

const CHECKING = "Checking whether these ad sets can take an ad with several variations…";
const UNCHECKED = "Couldn't check whether these ad sets are dynamic.";

/**
 * Bulk-attach sends every creative to every selected ad set, and those ad
 * sets already exist. Several creatives plus a rotation creative is a share
 * and needs no read. One rotation creative is allowed only when every target
 * is already dynamic and has no ads.
 */
export function useBulkAttachRotationBlock(
  creatives: AdCreativeDraft[],
  adSetIds: string[],
): { text: string | null; blocked: boolean } {
  const lone =
    creatives.length === 1 && creatives.some((c) => creativeTriggersVariationRotation(c));
  const key = adSetIds.slice().sort().join(",");
  const [guard, setGuard] = useState<{
    key: string;
    loading: boolean;
    failed: boolean;
    rows: Array<LiveAdSetState & { id: string }>;
  }>({ key: "", loading: false, failed: false, rows: [] });

  useEffect(() => {
    if (!lone || !key) return;
    let cancel = false;
    fetch(`/api/meta/bulk-attach-ads/adset-guard?adSetIds=${encodeURIComponent(key)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as AdSetGuardResponse;
      })
      .then((data) => {
        if (cancel) return;
        setGuard({
          key,
          loading: false,
          failed: Boolean(data.degraded),
          rows: (data.adSets ?? []).map((row) => ({
            id: row.id,
            isDynamicCreative: row.isDynamicCreative,
            adCount: row.adCount,
          })),
        });
      })
      .catch(() => {
        if (!cancel) setGuard({ key, loading: false, failed: true, rows: [] });
      });
    return () => {
      cancel = true;
    };
  }, [lone, key]);

  const share = bulkAttachRotationMessage(creatives, adSetIds, null);
  if (share) return { text: share, blocked: true };
  if (!lone) return { text: null, blocked: false };
  if (!key) return { text: null, blocked: false };
  if (guard.key !== key || guard.loading) return { text: CHECKING, blocked: true };
  if (guard.failed) return { text: UNCHECKED, blocked: true };
  const live = new Map(guard.rows.map((row) => [row.id, row]));
  const text = bulkAttachRotationMessage(creatives, adSetIds, live);
  return { text, blocked: Boolean(text) };
}
