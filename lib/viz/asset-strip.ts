/**
 * AssetStrip view. Google is never a toggle — always the not-instrumented
 * dash. TikTok image-disabled copy is the launcher reason from
 * lib/plan/asset-routing.ts (asserted equal in tests; not imported here
 * so the leaf module stays off that draft graph).
 */

import type { VizPlatform } from "./tokens.ts";

export const TIKTOK_IMAGE_DISABLED_REASON =
  "TikTok image ads not supported by the launcher yet";

export type AssetStripItem = {
  id: string;
  label: string;
  aspect: string;
  thumbUrl?: string | null;
  mediaKind?: "image" | "video";
};

export type AssetStripState = "empty" | "routed" | "unrouted";

export function googleRoutingMark(): "—" {
  return "—";
}

export function isPlatformLit(
  routing: VizPlatform[] | undefined,
  platform: VizPlatform,
): boolean {
  if (platform === "google") return false;
  return Boolean(routing?.includes(platform));
}

export function tiktokDisabledReason(
  asset: AssetStripItem,
  disabledReasons?: Partial<Record<VizPlatform, string>>,
): string | undefined {
  if (disabledReasons?.tiktok) return disabledReasons.tiktok;
  if (asset.mediaKind === "image") return TIKTOK_IMAGE_DISABLED_REASON;
  return undefined;
}

export function assetIsUnrouted(
  asset: AssetStripItem,
  routing: VizPlatform[] | undefined,
): boolean {
  const lit = (routing ?? []).filter((platform) => platform !== "google");
  return lit.length === 0;
}

export function assetStripState(
  assets: AssetStripItem[],
  routing: Record<string, VizPlatform[]>,
): AssetStripState {
  if (assets.length === 0) return "empty";
  if (assets.some((asset) => assetIsUnrouted(asset, routing[asset.id]))) return "unrouted";
  return "routed";
}

export function routingToggleNext(
  current: VizPlatform[] | undefined,
  platform: VizPlatform,
  enabled: boolean,
): VizPlatform[] {
  if (platform === "google") return current ?? [];
  const without = (current ?? []).filter((item) => item !== platform);
  return enabled ? [...without, platform] : without;
}
