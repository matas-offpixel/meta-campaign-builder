import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";

/**
 * Auth context for `/api/meta/thumbnail-proxy` — session cookie or share token.
 */
export type MetaThumbnailProxyAuth =
  | { kind: "session"; clientId: string }
  | { kind: "share"; shareToken: string; eventCode?: string };

/**
 * Builds a same-origin thumbnail URL through `/api/proxy/creative-thumbnail`
 * (Supabase Storage cache + Meta fallback). Returns null when proxying is impossible.
 *
 * `fallbackLabel` is passed as `fallback_label` so the proxy can render a
 * branded SVG when Graph/CDN returns nothing — avoids broken `<img>` flashes.
 */
export function buildMetaThumbnailProxyUrl(
  adId: string | null | undefined,
  auth: MetaThumbnailProxyAuth | null | undefined,
  fallbackLabel?: string | null,
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
  if (fallbackLabel?.trim()) {
    qs.set("fallback_label", fallbackLabel.trim().slice(0, 120));
  }
  return `/api/proxy/creative-thumbnail?${qs.toString()}`;
}

/** Prefer proxy URL for card/modal display when we have an ad id + auth. */
export function resolveProxiedRepresentativeThumbnail(
  group: ConceptGroupRow,
  auth: MetaThumbnailProxyAuth | null | undefined,
): string | null {
  const proxy = buildMetaThumbnailProxyUrl(
    group.representative_thumbnail_ad_id,
    auth,
    group.display_name ?? null,
  );
  return proxy ?? group.representative_thumbnail ?? null;
}
