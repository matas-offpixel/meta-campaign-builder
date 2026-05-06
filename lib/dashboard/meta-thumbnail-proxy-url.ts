import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";

/**
 * Auth context for `/api/meta/thumbnail-proxy` — session cookie or share token.
 */
export type MetaThumbnailProxyAuth =
  | { kind: "session"; clientId: string }
  | { kind: "share"; shareToken: string; eventCode?: string };

/**
 * Builds a same-origin thumbnail URL that re-fetches fresh bytes from Meta
 * (cached 24h server-side). Returns null when proxying is impossible.
 */
export function buildMetaThumbnailProxyUrl(
  adId: string | null | undefined,
  auth: MetaThumbnailProxyAuth | null | undefined,
): string | null {
  if (!adId || !auth) return null;
  const qs = new URLSearchParams({ ad_id: adId });
  if (auth.kind === "session") {
    qs.set("client_id", auth.clientId);
  } else {
    qs.set("share_token", auth.shareToken);
    if (auth.eventCode) {
      qs.set("event_code", auth.eventCode);
    }
  }
  return `/api/meta/thumbnail-proxy?${qs.toString()}`;
}

/** Prefer proxy URL for card/modal display when we have an ad id + auth. */
export function resolveProxiedRepresentativeThumbnail(
  group: ConceptGroupRow,
  auth: MetaThumbnailProxyAuth | null | undefined,
): string | null {
  const proxy = buildMetaThumbnailProxyUrl(
    group.representative_thumbnail_ad_id,
    auth,
  );
  return proxy ?? group.representative_thumbnail ?? null;
}
