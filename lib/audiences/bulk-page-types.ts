/**
 * Pure types, constants and converters for bulk PAGE-source audience creation
 * — the subtype × retention matrix builder. Mirrors bulk-types.ts (video views)
 * but covers ONLY page-sourced subtypes:
 *
 *   page_engagement_fb · page_engagement_ig
 *   page_followers_fb  · page_followers_ig
 *
 * No runtime dependencies on lib/meta/* so tests can import without pulling in
 * the MetaApiError TS parameter properties.
 */
import { buildAudienceName } from "./naming.ts";
import { MAX_PAGE_ENGAGEMENT_SOURCES } from "../meta/audience-payload.ts";
import type {
  AudienceSubtype,
  FunnelStage,
  MetaCustomAudienceInsert,
} from "../types/audience.ts";

// ── Subtypes (page-sourced only) ──────────────────────────────────────────────

/** Page-sourced subtypes covered by the matrix builder. Video / pixel are OUT. */
export const BULK_PAGE_SUBTYPES = [
  "page_engagement_fb",
  "page_engagement_ig",
  "page_followers_fb",
  "page_followers_ig",
] as const satisfies readonly AudienceSubtype[];

export type BulkPageSubtype = (typeof BULK_PAGE_SUBTYPES)[number];

export function isBulkPageSubtype(v: unknown): v is BulkPageSubtype {
  return (
    typeof v === "string" &&
    (BULK_PAGE_SUBTYPES as readonly string[]).includes(v)
  );
}

/** Compact label used in the matrix preview cells. */
export const BULK_PAGE_SUBTYPE_SHORT_LABELS: Record<BulkPageSubtype, string> = {
  page_engagement_fb: "FB engagement",
  page_engagement_ig: "IG engagement",
  page_followers_fb: "FB followers",
  page_followers_ig: "IG followers",
};

/** True for followers subtypes — Meta forces retention to 0 (always-live). */
export function isFollowersSubtype(subtype: BulkPageSubtype): boolean {
  return subtype === "page_followers_fb" || subtype === "page_followers_ig";
}

/** True for the IG-sourced subtypes — picker stores IG Business Account IDs. */
export function isIgSubtype(subtype: BulkPageSubtype): boolean {
  return subtype === "page_engagement_ig" || subtype === "page_followers_ig";
}

// ── Retention defaults ────────────────────────────────────────────────────────

/** Default retention checkboxes shown in the UI, matching FUNNEL_STAGE_PRESETS. */
export const DEFAULT_PAGE_RETENTIONS = [30, 60, 180, 365] as const;

/** Meta's hard cap for engagement-audience retention (days). */
export const META_MAX_RETENTION_DAYS = 365;

/** Clamp a free-form retention to Meta's [1, 365] day window. */
export function clampRetentionDays(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), META_MAX_RETENTION_DAYS);
}

/**
 * Map (subtype, retention) → FunnelStage so matrix-built rows land in the same
 * tabs as single-builder audiences. Mirrors FUNNEL_STAGE_PRESETS thresholds:
 *
 *   followers (any retention) → top_of_funnel  (always-live)
 *   engagement, retention ≥ 180 → top_of_funnel
 *   engagement, retention ≥ 60  → mid_funnel
 *   engagement, retention < 60  → bottom_funnel
 */
export function funnelStageForCell(
  subtype: BulkPageSubtype,
  retentionDays: number,
): FunnelStage {
  if (isFollowersSubtype(subtype)) return "top_of_funnel";
  if (retentionDays >= 180) return "top_of_funnel";
  if (retentionDays >= 60) return "mid_funnel";
  return "bottom_funnel";
}

// ── Source selection shape (subset of components/audiences/SourceSelection) ──

/**
 * Shared shape for the FB-page set or IG-account set selected once in Step 1.
 * The picker normalises FB-page IDs and IG-business-account IDs into the same
 * `pageIds` slot; the write path keys off `audienceSubtype` to wrap them in
 * the correct event_sources type.
 */
export interface BulkPageSourceSelection {
  pageIds: string[];
  /** Display summaries (id + name) used for naming + UI labels. */
  pageSummaries?: Array<{ id: string; name: string; slug?: string }>;
}

// ── Preview shapes ────────────────────────────────────────────────────────────

export interface BulkPagePreviewCell {
  subtype: BulkPageSubtype;
  retentionDays: number;
  funnelStage: FunnelStage;
  name: string;
  /** True when the cell will be split across multiple Meta audiences. */
  willSplit: boolean;
  /** Number of split parts (1 when the cell fits within one audience). */
  partCount: number;
}

export interface BulkPagePreviewSource {
  kind: "fb" | "ig";
  /** Full set of FB pages selected (used by FB subtypes). */
  fbPageIds: string[];
  fbSummaries: Array<{ id: string; name: string; slug?: string }>;
  /** Full set of IG business accounts selected (used by IG subtypes). */
  igAccountIds: string[];
  igSummaries: Array<{ id: string; name: string; slug?: string }>;
}

export interface BulkPagePreview {
  /** Computed audience-name prefix shown in cell names (e.g. "[innervisions]"). */
  labelPrefix: string;
  fbSourceCount: number;
  igSourceCount: number;
  /** True when ANY selected subtype's source set exceeds Meta's 5-source cap. */
  anySplit: boolean;
  cells: BulkPagePreviewCell[];
}

// ── Preview builder (pure) ────────────────────────────────────────────────────

export interface BuildPagePreviewOpts {
  /** Client slug used for default naming when no custom label is provided. */
  clientSlug: string | null;
  clientName: string;
  /** Optional explicit label override (free-form text, e.g. "Innervisions"). */
  labelOverride?: string | null;
  subtypes: BulkPageSubtype[];
  retentions: number[];
  fbPageIds: string[];
  fbSummaries: Array<{ id: string; name: string; slug?: string }>;
  igAccountIds: string[];
  igSummaries: Array<{ id: string; name: string; slug?: string }>;
}

/**
 * Compute the (subtype × retention) matrix preview from a single source
 * selection. Pure: no DB, no Meta calls. Splits are derived from the cap.
 */
export function buildPagePreview(opts: BuildPagePreviewOpts): BulkPagePreview {
  const labelPrefix = resolveLabelPrefix(opts);
  const cells: BulkPagePreviewCell[] = [];
  let anySplit = false;

  // Stable order: subtype first (FB → IG → followers) then retention ascending.
  for (const subtype of opts.subtypes) {
    const sourceIds = sourceIdsForSubtype(subtype, opts);
    const partCount = Math.max(
      1,
      Math.ceil(sourceIds.length / MAX_PAGE_ENGAGEMENT_SOURCES),
    );
    const willSplit = partCount > 1;
    if (willSplit) anySplit = true;

    const effectiveRetentions = isFollowersSubtype(subtype)
      ? // Followers ignore retention on Meta, but we still keep one cell per
        // requested retention so the preview reflects what the user asked for —
        // every cell will be sanitised to the matching name and have its
        // retention encoded as 0 by the payload builder.
        opts.retentions
      : opts.retentions;

    for (const retentionDays of effectiveRetentions) {
      const clamped = clampRetentionDays(retentionDays);
      const funnelStage = funnelStageForCell(subtype, clamped);
      const name = buildAudienceName({
        scope: "client",
        client: { slug: labelPrefix, name: opts.clientName },
        event: null,
        subtype,
        retentionDays: clamped,
      });
      cells.push({
        subtype,
        retentionDays: clamped,
        funnelStage,
        name,
        willSplit,
        partCount,
      });
    }
  }

  return {
    labelPrefix,
    fbSourceCount: opts.fbPageIds.length,
    igSourceCount: opts.igAccountIds.length,
    anySplit,
    cells,
  };
}

function sourceIdsForSubtype(
  subtype: BulkPageSubtype,
  opts: BuildPagePreviewOpts,
): string[] {
  return isIgSubtype(subtype) ? opts.igAccountIds : opts.fbPageIds;
}

function summariesForSubtype(
  subtype: BulkPageSubtype,
  opts: BuildPagePreviewOpts,
): Array<{ id: string; name: string; slug?: string }> {
  return isIgSubtype(subtype) ? opts.igSummaries : opts.fbSummaries;
}

/**
 * Resolve the bracketed prefix used inside cell names.
 *
 *   1. explicit override (sanitised, non-empty)         → use as-is
 *   2. client slug                                      → fallback
 *   3. client name                                      → final fallback
 */
function resolveLabelPrefix(opts: BuildPagePreviewOpts): string {
  const override = opts.labelOverride?.trim();
  if (override) return override;
  const slug = opts.clientSlug?.trim();
  if (slug) return slug;
  return opts.clientName.trim();
}

// ── Preview → DB insert conversion ───────────────────────────────────────────

export interface BulkPageInsertOpts {
  userId: string;
  clientId: string;
  metaAdAccountId: string;
}

/**
 * Convert a non-empty preview into `MetaCustomAudienceInsert[]` rows — one per
 * cell. Each cell goes through `createMetaCustomAudience` later; the existing
 * write path auto-splits per cell when its source set > MAX_PAGE_ENGAGEMENT_SOURCES
 * (so sibling rows are created by `writeSplitPageEngagement`, NOT here).
 */
export function pagePreviewToInserts(
  preview: BulkPagePreview,
  source: BuildPagePreviewOpts,
  opts: BulkPageInsertOpts,
): MetaCustomAudienceInsert[] {
  return preview.cells.map((cell) => {
    const sourceIds = sourceIdsForSubtype(cell.subtype, source);
    const summaries = summariesForSubtype(cell.subtype, source);
    const primary = summaries[0];
    return {
      userId: opts.userId,
      clientId: opts.clientId,
      eventId: null,
      name: cell.name,
      funnelStage: cell.funnelStage,
      audienceSubtype: cell.subtype,
      retentionDays: cell.retentionDays,
      sourceId: sourceIds.join(","),
      sourceMeta: {
        subtype: cell.subtype,
        pageSlug: primary?.slug,
        pageName: primary?.name,
        pageIds: sourceIds.length > 0 ? sourceIds : undefined,
      },
      metaAdAccountId: opts.metaAdAccountId,
    };
  });
}
