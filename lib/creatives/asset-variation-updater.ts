/**
 * Pure reducer helpers for updating AssetVariation state without stale closures.
 *
 * The `AssetVariationCard` in `components/steps/creatives.tsx` allows multiple
 * `AssetSlot` children to upload in parallel. Because each slot's upload
 * callback closes over the component's render-time `slots` snapshot, parallel
 * completions would clobber each other: whichever resolved second would
 * re-write the whole assets array from its stale snapshot, rolling back the
 * first slot's "uploaded" status.
 *
 * The fix: `updateAsset` inside the card now calls `onUpdate` with a
 * *function* `(prev: AssetVariation) => Partial<AssetVariation>` rather than a
 * static patch object. `updateAssetVariation` in the parent applies that
 * function to the **current** variation (read from `creativesRef.current`),
 * ensuring each write sees the freshest state no matter how many are in flight.
 *
 * These exported helpers are the pure core of that logic, unit-tested in
 * `lib/creatives/__tests__/asset-variation-updater.test.ts`.
 */

import type { AdCreativeDraft, AssetVariation } from "@/lib/types";

/**
 * A variation updater is either a plain patch object or a function that
 * receives the *current* variation and returns a patch. Use the function form
 * whenever the new state depends on the existing value (e.g. updating a single
 * asset inside the assets array), so parallel calls don't race on stale data.
 */
export type AssetVariationUpdater =
  | ((prev: AssetVariation) => Partial<AssetVariation>)
  | Partial<AssetVariation>;

/**
 * Apply a variation updater to one specific variation inside the creatives
 * array. Returns a new creatives array; all other creatives and variations are
 * returned by reference (no unnecessary object allocation).
 *
 * @param creatives - The current full creatives array (use `creativesRef.current`
 *   in the component, not the closure-captured `creatives` prop).
 * @param adId  - ID of the `AdCreativeDraft` to update.
 * @param varId - ID of the `AssetVariation` inside that draft to update.
 * @param updater - Plain patch or function that maps prev → patch.
 */
export function applyVariationUpdate(
  creatives: AdCreativeDraft[],
  adId: string,
  varId: string,
  updater: AssetVariationUpdater,
): AdCreativeDraft[] {
  return creatives.map((c) => {
    if (c.id !== adId) return c;
    return {
      ...c,
      assetVariations: (c.assetVariations ?? []).map((v) => {
        if (v.id !== varId) return v;
        const patch =
          typeof updater === "function" ? updater(v) : updater;
        return { ...v, ...patch };
      }),
    };
  });
}
