/**
 * Pure types, constants, and converters for the bulk WEBSITE PIXEL audience
 * matrix builder. Mirrors bulk-page-types.ts but covers the `website_pixel`
 * subtype exclusively.
 *
 * No runtime dependencies on lib/meta/* — safe to import in tests and the
 * preview route without pulling in MetaApiError TS parameter properties.
 *
 * Matrix shape: pixelEvents × retentions → one cell each.
 *
 * Key design decisions (no migration needed):
 *   - `sourceId` on the DB insert carries the pixel ID (numeric string).
 *   - `sourceMeta.subtype = "website_pixel"` — audience-payload.ts keys on this.
 *   - `sourceMeta.urlContains = string[]` — empty array = whole-pixel (PageView
 *     fallback in audience-payload.ts else branch).
 *   - `sourceMeta.pixelEvent` — pixel event name sent into the Meta rule.
 *   - No 5-source splitting — CHUNKABLE_SUBTYPES in audience-write.ts does NOT
 *     include "website_pixel", so createMetaCustomAudience takes the direct
 *     write path every time.
 */
import type { FunnelStage, MetaCustomAudienceInsert } from "../types/audience.ts";

// ── Pixel events ──────────────────────────────────────────────────────────────

/**
 * Pixel events supported by the matrix builder. Structured as an extensible
 * array so ViewContent / InitiateCheckout / Purchase can be added later without
 * UI rebuild — the matrix just grows an extra row per new event.
 */
export const BULK_WEBSITE_PIXEL_EVENTS = ["PageView"] as const;
// Future: "ViewContent", "InitiateCheckout", "Purchase"

export type BulkWebsitePixelEvent = (typeof BULK_WEBSITE_PIXEL_EVENTS)[number];

export function isBulkWebsitePixelEvent(v: unknown): v is BulkWebsitePixelEvent {
  return (
    typeof v === "string" &&
    (BULK_WEBSITE_PIXEL_EVENTS as readonly string[]).includes(v)
  );
}

/** Human-readable label for UI display. */
export const BULK_WEBSITE_EVENT_LABELS: Record<BulkWebsitePixelEvent, string> = {
  PageView: "PageView (all visitors)",
};

// ── URL scope mode ────────────────────────────────────────────────────────────

/** "whole_pixel" = all visitors (no URL filter); "url_keyword" = URL contains filter. */
export type BulkWebsiteUrlMode = "whole_pixel" | "url_keyword";

// ── Retention defaults ────────────────────────────────────────────────────────

/**
 * Default retention checkboxes for website-pixel audiences. All values must be
 * ≤ META_MAX_WEBSITE_RETENTION_DAYS (180). 365 is intentionally absent —
 * it would clamp to 180 and produce a duplicate cell alongside the 180d option.
 */
export const DEFAULT_WEBSITE_RETENTIONS = [30, 60, 90, 180] as const;

/** Meta's hard cap for website-pixel audience retention (days). */
export const META_MAX_WEBSITE_RETENTION_DAYS = 180;

/** Clamp a free-form retention to Meta's [1, 180] day window for pixel audiences. */
export function clampWebsiteRetentionDays(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), META_MAX_WEBSITE_RETENTION_DAYS);
}

/**
 * Map retention → FunnelStage for website pixel audiences.
 * Mirrors the page-audience thresholds:
 *   ≥ 180 → top_of_funnel
 *   ≥  60 → mid_funnel
 *   <  60 → bottom_funnel
 */
export function funnelStageForWebsiteCell(retentionDays: number): FunnelStage {
  if (retentionDays >= 180) return "top_of_funnel";
  if (retentionDays >= 60) return "mid_funnel";
  return "bottom_funnel";
}

// ── Preview shapes ────────────────────────────────────────────────────────────

export interface BulkWebsitePreviewCell {
  pixelEvent: BulkWebsitePixelEvent;
  retentionDays: number;
  funnelStage: FunnelStage;
  /** Full human-readable name (UI display and DB `name` field). */
  name: string;
  /**
   * Resolved URL keyword (trimmed, single string, empty = whole pixel).
   * Stored for display in the preview panel ("WHERE url contains '…'").
   */
  urlKeyword: string;
}

export interface BulkWebsitePreview {
  /** Bracketed prefix used inside cell names, e.g. "Junction2". */
  labelPrefix: string;
  pixelId: string;
  /** Resolved URL keyword (same as on each cell, for panel display). */
  urlKeyword: string;
  cells: BulkWebsitePreviewCell[];
}

// ── Preview builder (pure) ────────────────────────────────────────────────────

export interface BuildWebsitePreviewOpts {
  clientSlug: string | null;
  clientName: string;
  /** Optional explicit label override (free-form, defaults to client slug/name). */
  labelOverride?: string | null;
  pixelId: string;
  pixelEvents: BulkWebsitePixelEvent[];
  /**
   * Raw URL keyword input from the form. Trimmed; empty string = whole-pixel
   * mode (no URL filter, audience-payload.ts uses the PageView event filter).
   */
  urlKeyword: string;
  retentions: number[];
}

/**
 * Compute the (pixelEvents × retentions) matrix preview. Pure: no DB or
 * Meta calls.
 *
 * Cell order: events first (stable order = BULK_WEBSITE_PIXEL_EVENTS), then
 * retention ascending — matches the UI grid row-major layout.
 *
 * Duplicate-prevention: after clamping, cells are deduplicated by
 * (pixelEvent, clampedRetentionDays). This ensures that two inputs which
 * clamp to the same value (e.g. 180 and 365 both → 180) yield ONE cell, not
 * two identical Meta audiences. The UI already restricts selectable retentions
 * to ≤180, so duplicates should not occur in normal use; the dedupe is a
 * defensive safety net for any out-of-bounds values that reach the builder.
 */
export function buildWebsitePreview(
  opts: BuildWebsitePreviewOpts,
): BulkWebsitePreview {
  const labelPrefix = resolveWebsiteLabelPrefix(opts);
  const urlKeyword = opts.urlKeyword.trim();
  const cells: BulkWebsitePreviewCell[] = [];
  const seen = new Set<string>();

  for (const pixelEvent of opts.pixelEvents) {
    for (const rawRetention of opts.retentions) {
      const retentionDays = clampWebsiteRetentionDays(rawRetention);
      const key = `${pixelEvent}:${retentionDays}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const funnelStage = funnelStageForWebsiteCell(retentionDays);
      const name = buildWebsiteCellName(labelPrefix, pixelEvent, urlKeyword, retentionDays);
      cells.push({ pixelEvent, retentionDays, funnelStage, name, urlKeyword });
    }
  }

  return { labelPrefix, pixelId: opts.pixelId, urlKeyword, cells };
}

/**
 * Produce a human-readable (non-sanitized) audience name for a single cell.
 *
 * Pattern: "[prefix] <event> <urlKeyword?> <retention>d"
 * Examples:
 *   "[junction2] PageView glasgow-o2 30d"
 *   "[innervisions] PageView 180d"
 *
 * sanitizeAudienceName in audience-payload.ts sanitises at POST time (replaces
 * spaces/hyphens/brackets with underscores, truncates to 50 chars).
 */
function buildWebsiteCellName(
  labelPrefix: string,
  pixelEvent: BulkWebsitePixelEvent,
  urlKeyword: string,
  retentionDays: number,
): string {
  const keyword = urlKeyword.trim();
  const parts = [`[${labelPrefix}]`, pixelEvent];
  if (keyword) parts.push(keyword);
  parts.push(`${retentionDays}d`);
  return parts.join(" ");
}

function resolveWebsiteLabelPrefix(opts: BuildWebsitePreviewOpts): string {
  const override = opts.labelOverride?.trim();
  if (override) return override;
  const slug = opts.clientSlug?.trim();
  if (slug) return slug;
  return opts.clientName.trim();
}

// ── Preview → DB insert conversion ───────────────────────────────────────────

export interface BulkWebsiteInsertOpts {
  userId: string;
  clientId: string;
  metaAdAccountId: string;
}

/**
 * Convert a preview into `MetaCustomAudienceInsert[]` — one per cell.
 *
 * `sourceId` = pixel ID (used by audience-payload.ts as the event_sources.id).
 * `sourceMeta.urlContains` = [urlKeyword] when a keyword is set, otherwise []
 * (audience-payload.ts's else branch fires the PageView-filter path).
 * No splitting logic here — pixel audiences are single-source by definition
 * and CHUNKABLE_SUBTYPES does not include "website_pixel".
 */
export function websitePreviewToInserts(
  preview: BulkWebsitePreview,
  opts: BulkWebsiteInsertOpts,
): MetaCustomAudienceInsert[] {
  return preview.cells.map((cell) => ({
    userId: opts.userId,
    clientId: opts.clientId,
    eventId: null,
    name: cell.name,
    funnelStage: cell.funnelStage,
    audienceSubtype: "website_pixel" as const,
    retentionDays: cell.retentionDays,
    sourceId: preview.pixelId,
    sourceMeta: {
      subtype: "website_pixel" as const,
      urlContains: cell.urlKeyword ? [cell.urlKeyword] : [],
      pixelEvent: cell.pixelEvent,
    },
    metaAdAccountId: opts.metaAdAccountId,
  }));
}
