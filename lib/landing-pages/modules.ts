import type { PageEventRow } from "./types.ts";

/**
 * lib/landing-pages/modules.ts
 *
 * Pure resolver between the `page_events.modules / visibility / customisation`
 * JSONB columns (migration 139) and the view-model seam (lib/landing-pages/
 * view.ts). No IO, no "@/" aliases — unit-tested directly under node:test.
 *
 * DESIGN: byte-identical fallback. The renderer's markup did not change in
 * PR 2 — only the DATA SOURCE for hero/youtube/grid/brand-social content
 * moved behind this resolver. When `modules` is empty (every page pre-139,
 * and any page the admin editor hasn't rewritten) the resolver returns the
 * exact same raw values the legacy columns fed the view before, so the
 * sanitising helpers in view.ts produce identical output. When `modules` is
 * populated (backfilled or authored), the enabled modules drive the content.
 *
 * `resolveModuleSources` returns RAW (unsanitised) values on purpose: the
 * single source of URL/id sanitisation stays in view.ts (safeUrlArray /
 * safeHttpUrl / parseYouTubeId), so the modules path and the legacy path are
 * cleaned by exactly the same code.
 */

export const MODULE_TYPES = [
  "hero_carousel",
  "youtube_embed",
  "image_grid",
  "brand_socials",
  "custom_text",
] as const;

export type ModuleType = (typeof MODULE_TYPES)[number];

export interface ModuleInstance {
  id: string;
  type: ModuleType;
  enabled: boolean;
  order: number;
  config: Record<string, unknown>;
}

const MODULE_TYPE_SET: ReadonlySet<string> = new Set(MODULE_TYPES);

function isModuleType(value: unknown): value is ModuleType {
  return typeof value === "string" && MODULE_TYPE_SET.has(value);
}

/**
 * Coerce the raw JSONB `modules` value into a normalised, ORDER-SORTED list
 * of valid module instances. Unknown types, non-objects, and entries missing
 * a valid `type` are dropped. `enabled` defaults true, `order` defaults to
 * the array index, `config` defaults to {}. Never throws.
 */
export function parseModules(raw: unknown): ModuleInstance[] {
  if (!Array.isArray(raw)) return [];
  const parsed: ModuleInstance[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) return;
    const obj = entry as Record<string, unknown>;
    if (!isModuleType(obj.type)) return;
    const order =
      typeof obj.order === "number" && Number.isFinite(obj.order)
        ? obj.order
        : index;
    parsed.push({
      id: typeof obj.id === "string" ? obj.id : `module-${index}`,
      type: obj.type,
      enabled: obj.enabled !== false,
      order,
      config:
        typeof obj.config === "object" && obj.config !== null
          ? (obj.config as Record<string, unknown>)
          : {},
    });
  });
  return parsed.sort((a, b) => a.order - b.order);
}

/**
 * Raw content sources for the renderer, chosen from `modules` when present
 * else the legacy columns. See the sanitisation note above — every field is
 * intentionally unsanitised.
 */
export interface ModuleSources {
  /** jsonb array of hero-carousel URLs (→ view safeUrlArray). */
  heroImagesRaw: unknown;
  /** YouTube URL string (→ view parseYouTubeId). */
  youtubeUrlRaw: string | null;
  /** jsonb array of image-grid URLs (→ view safeUrlArray). */
  gridImagesRaw: unknown;
  /** Instagram URL string (→ view safeHttpUrl). */
  brandInstagramRaw: string | null;
  /** TikTok URL string (→ view safeHttpUrl). */
  brandTiktokRaw: string | null;
}

function firstEnabledConfig(
  modules: ModuleInstance[],
  type: ModuleType,
): Record<string, unknown> | null {
  const found = modules.find((m) => m.type === type && m.enabled);
  return found ? found.config : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Resolve the renderer's content sources. When the page has no modules
 * (default/legacy), returns the legacy columns verbatim → byte-identical
 * output. When modules are present, the first ENABLED module of each type
 * supplies the content; a type with no enabled module contributes nothing
 * (empty/null), which the existing render conditionals treat as "hide".
 */
export function resolveModuleSources(
  pageEvent: Pick<
    PageEventRow,
    "modules" | "hero_images" | "youtube_url" | "bottom_images" | "content"
  >,
): ModuleSources {
  const modules = parseModules(pageEvent.modules);

  if (modules.length === 0) {
    const content = pageEvent.content ?? {};
    return {
      heroImagesRaw: pageEvent.hero_images,
      youtubeUrlRaw: pageEvent.youtube_url ?? null,
      gridImagesRaw: pageEvent.bottom_images,
      brandInstagramRaw: asStringOrNull(content.brand_instagram_url),
      brandTiktokRaw: asStringOrNull(content.brand_tiktok_url),
    };
  }

  const hero = firstEnabledConfig(modules, "hero_carousel");
  const youtube = firstEnabledConfig(modules, "youtube_embed");
  const grid = firstEnabledConfig(modules, "image_grid");
  const socials = firstEnabledConfig(modules, "brand_socials");

  return {
    heroImagesRaw: hero?.images ?? [],
    youtubeUrlRaw: asStringOrNull(youtube?.url),
    gridImagesRaw: grid?.images ?? [],
    brandInstagramRaw: asStringOrNull(socials?.instagram_url),
    brandTiktokRaw: asStringOrNull(socials?.tiktok_url),
  };
}

// ── Visibility ──────────────────────────────────────────────────────────────

/**
 * Per-page visibility toggles (migration 139 `visibility` column). Every
 * flag DEFAULTS TRUE so an unset/absent column renders exactly as it did
 * before 139 — the renderer ANDs these with its existing presence checks,
 * so `true` is a no-op. Only an explicit `false` hides a section.
 */
export interface ResolvedVisibility {
  showEventDate: boolean;
  showVenue: boolean;
  showDescription: boolean;
  showPresale: boolean;
  showCountdown: boolean;
}

function flag(bag: Record<string, unknown>, key: string): boolean {
  return bag[key] !== false;
}

export function resolveVisibility(
  pageEvent: Pick<PageEventRow, "visibility">,
): ResolvedVisibility {
  const bag =
    typeof pageEvent.visibility === "object" && pageEvent.visibility !== null
      ? (pageEvent.visibility as Record<string, unknown>)
      : {};
  return {
    showEventDate: flag(bag, "show_event_date"),
    showVenue: flag(bag, "show_venue"),
    showDescription: flag(bag, "show_description"),
    showPresale: flag(bag, "show_presale"),
    showCountdown: flag(bag, "show_countdown"),
  };
}

// ── Customisation ─────────────────────────────────────────────────────────

/**
 * Per-page visual overrides (migration 139 `customisation` column). Null =
 * "use the default", which for every field reproduces the pre-139 look
 * (accent-coloured button, white label, left-aligned description). Colours
 * are validated to `#rgb` / `#rrggbb` so a junk value can never inject
 * arbitrary CSS.
 */
export interface ResolvedCustomisation {
  /** null → CSS falls back to var(--accent). */
  primaryButtonBg: string | null;
  /** null → CSS falls back to #ffffff. */
  primaryButtonText: string | null;
  descriptionAlign: "left" | "center";
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function safeHexColor(value: unknown): string | null {
  return typeof value === "string" && HEX_COLOR_RE.test(value.trim())
    ? value.trim()
    : null;
}

export function resolveCustomisation(
  pageEvent: Pick<PageEventRow, "customisation">,
): ResolvedCustomisation {
  const bag =
    typeof pageEvent.customisation === "object" &&
    pageEvent.customisation !== null
      ? (pageEvent.customisation as Record<string, unknown>)
      : {};
  return {
    primaryButtonBg: safeHexColor(bag.primary_button_bg),
    primaryButtonText: safeHexColor(bag.primary_button_text),
    descriptionAlign: bag.description_align === "center" ? "center" : "left",
  };
}
