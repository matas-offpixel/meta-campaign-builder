import type { ModuleInstance } from "../landing-pages/modules.ts";

/**
 * lib/admin/page-modules-sync.ts
 *
 * Keeps `page_events.modules` in lock-step with the legacy presentation
 * columns the admin editor writes (hero_images / youtube_url / bottom_images
 * + content.brand_*). Migration 139 made `modules` the render source of
 * truth (lib/landing-pages/modules.ts reads it), so a save that only touched
 * the legacy columns would otherwise leave the rendered page stale.
 *
 * The editor's model stays column-based (upload/reorder/remove images, type a
 * YouTube URL, etc.); every mutating server action calls this to regenerate
 * the modules array from the resulting legacy values. It reproduces the exact
 * shape migration 139's backfill wrote, so a page that has never been edited
 * post-139 and one saved through the editor resolve identically.
 *
 * Pure (only a UUID factory is injected) → unit-tested under node:test.
 */

export interface LegacyModuleInputs {
  /** Clean hero-carousel URLs (already parseImageList'd). */
  heroImages: string[];
  /**
   * `content.artwork_url` — the admin-uploaded brand poster. Semantically
   * distinct from `heroImages` (atmosphere photos), but always pinned to
   * hero-carousel slide 1 when present: it's the one image every LP must
   * show first. Null when no artwork has been uploaded.
   */
  artworkUrl: string | null;
  /** Raw YouTube URL string, or null. */
  youtubeUrl: string | null;
  /** Clean bottom image-grid URLs. */
  bottomImages: string[];
  brandInstagramUrl: string | null;
  brandTiktokUrl: string | null;
}

function defaultId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Reconstruct the ordered modules array from the legacy columns, in the
 * fixed render order hero → youtube → grid → brand-socials. A section with
 * no content contributes no module (so the renderer hides it), matching the
 * migration backfill exactly.
 *
 * `artworkUrl`, when present, is always pinned to hero-carousel slide 1 —
 * deduped against `heroImages` so re-saving after the admin also manually
 * added the same artwork never double-renders it. When `artworkUrl` is null
 * this is byte-identical to the pre-fix behaviour (P0, 2026-07-17: artwork
 * was silently dropped on every admin save because this function had no
 * parameter for it — see docs/session-logs for the incident).
 */
export function rebuildModulesFromLegacy(
  input: LegacyModuleInputs,
  idFactory: () => string = defaultId,
): ModuleInstance[] {
  const modules: ModuleInstance[] = [];

  const heroImages = input.artworkUrl
    ? [input.artworkUrl, ...input.heroImages.filter((u) => u !== input.artworkUrl)]
    : input.heroImages;

  if (heroImages.length > 0) {
    modules.push({
      id: idFactory(),
      type: "hero_carousel",
      enabled: true,
      order: 0,
      config: { images: heroImages },
    });
  }

  if (input.youtubeUrl && input.youtubeUrl.trim().length > 0) {
    modules.push({
      id: idFactory(),
      type: "youtube_embed",
      enabled: true,
      order: 1,
      config: { url: input.youtubeUrl.trim() },
    });
  }

  if (input.bottomImages.length > 0) {
    modules.push({
      id: idFactory(),
      type: "image_grid",
      enabled: true,
      order: 2,
      config: { images: input.bottomImages },
    });
  }

  if (input.brandInstagramUrl || input.brandTiktokUrl) {
    modules.push({
      id: idFactory(),
      type: "brand_socials",
      enabled: true,
      order: 3,
      config: {
        instagram_url: input.brandInstagramUrl,
        tiktok_url: input.brandTiktokUrl,
      },
    });
  }

  return modules;
}
