/**
 * Pure types, constants, and converters for the LOOKALIKE audience builder.
 *
 * One lookalike per (seed × tier) pair — but per Matas's spec, a run picks a
 * SINGLE tier (1% / 2% / 3%), so the matrix is effectively N seeds × 1 tier
 * = N audiences. The seed Meta audience id, ratio, and country live inside
 * `source_meta` jsonb — no dedicated columns needed (migration 095 only
 * extends the audience_subtype CHECK).
 *
 * No runtime dependencies on lib/meta/* — safe to import in tests and the
 * preview route without pulling in MetaApiError TS parameter properties.
 *
 * Meta lookalike spec reference (verified 2026-05-20):
 *   POST /act_{id}/customaudiences
 *     name=...
 *     subtype=LOOKALIKE
 *     origin_audience_id=<seed Meta id>
 *     lookalike_spec={"type":"similarity","ratio":0.01,"country":"GB"}
 *   - ratio: 0.01-0.20, in 0.01 increments
 *   - subtype=LOOKALIKE IS required (documented exception vs engagement audiences)
 *   - Seed must already exist on Meta (have a meta_audience_id) AND have ≥100 members
 */
import type { FunnelStage, MetaCustomAudienceInsert } from "../types/audience.ts";

// ── Tier / ratio ──────────────────────────────────────────────────────────────

/** Tier presets exposed in the UI (single-select per Matas's spec). */
export const LOOKALIKE_TIERS = [1, 2, 3] as const;

export type LookalikeTier = (typeof LOOKALIKE_TIERS)[number];

export function isLookalikeTier(v: unknown): v is LookalikeTier {
  return typeof v === "number" && (LOOKALIKE_TIERS as readonly number[]).includes(v);
}

/** Convert a UI tier (1 / 2 / 3) to the Meta ratio float (0.01 / 0.02 / 0.03). */
export function tierToRatio(tier: LookalikeTier): number {
  return tier / 100;
}

// ── Country ───────────────────────────────────────────────────────────────────

/** Default lookalike country (per Matas's spec). */
export const DEFAULT_LOOKALIKE_COUNTRY = "GB";

/** A short, sensible default country list for the picker — keeps the UI snappy. */
export const LOOKALIKE_COUNTRY_OPTIONS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "IE", name: "Ireland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
];

/** Normalise/validate an ISO-2 country code. Defaults to GB. */
export function normaliseCountryCode(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_LOOKALIKE_COUNTRY;
  const s = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) return DEFAULT_LOOKALIKE_COUNTRY;
  return s;
}

// ── Seed shape ────────────────────────────────────────────────────────────────

/**
 * A seed candidate the form can choose from. Sourced from either:
 *  - the local meta_custom_audiences table (rows with status=ready + meta_audience_id), OR
 *  - the live Meta ad-account custom-audiences list (manually-uploaded seeds the
 *    tool didn't create, e.g. customer-file uploads, partner-shared lists).
 *
 * Merged + deduplicated by `metaAudienceId` at the form layer; the create path
 * only requires `metaAudienceId` and `name` (everything else is metadata for UI
 * display and audit trail).
 */
export interface LookalikeSeedCandidate {
  /** Meta-side audience id. Required — that's what we send as origin_audience_id. */
  metaAudienceId: string;
  /** Display name (from Meta or local row). */
  name: string;
  /** Origin: which list this came from. Forms the dedup key alongside metaAudienceId. */
  source: "db" | "meta";
  /** Local meta_custom_audiences.id when source === "db"; null otherwise. */
  localAudienceId?: string | null;
  /** Meta subtype string (UPPERCASE per Meta's listing API: ENGAGEMENT / WEBSITE / LOOKALIKE / …). */
  metaSubtype?: string | null;
  /** Our internal audience subtype when source === "db" (e.g. "video_views"). */
  audienceSubtype?: string | null;
  /** Funnel stage tag when source === "db". */
  funnelStage?: string | null;
  /** Meta's approximate audience size lower bound (when available). */
  approximateCount?: number | null;
}

// ── Preview shape ─────────────────────────────────────────────────────────────

export interface LookalikePreviewCell {
  /** Seed's Meta audience id — sent as origin_audience_id. */
  seedMetaAudienceId: string;
  /** Display name of the seed (for the preview panel and DB row). */
  seedName: string;
  /** Local audiences-table id of the seed (null when source === "meta"). */
  seedLocalAudienceId: string | null;
  /** Meta lookalike ratio (e.g. 0.01 for 1%). */
  ratio: number;
  /** Single-letter / ISO-2 country code (e.g. "GB"). */
  country: string;
  /** Full human-readable name (UI display and DB `name` field). */
  name: string;
}

export interface LookalikePreview {
  /** Bracketed prefix used inside cell names (e.g. "Innervisions"). */
  labelPrefix: string;
  tier: LookalikeTier;
  ratio: number;
  country: string;
  cells: LookalikePreviewCell[];
}

// ── Preview builder (pure) ────────────────────────────────────────────────────

export interface BuildLookalikePreviewOpts {
  clientSlug: string | null;
  clientName: string;
  /** Optional explicit label override (free-form, defaults to client slug/name). */
  labelOverride?: string | null;
  /** Selected seeds (deduplicated by metaAudienceId by the caller). */
  seeds: LookalikeSeedCandidate[];
  tier: LookalikeTier;
  country: string;
}

/**
 * Compute the preview (one cell per seed). Pure: no DB or Meta calls.
 *
 * Defensive dedup by metaAudienceId — even if the caller sends duplicate
 * seed entries (e.g. the same audience came up in both DB and Meta lists),
 * the preview produces exactly one cell per audience. Same safety pattern
 * as the website-pixel matrix dedup (PR #432).
 */
export function buildLookalikePreview(
  opts: BuildLookalikePreviewOpts,
): LookalikePreview {
  const labelPrefix = resolveLookalikeLabelPrefix(opts);
  const ratio = tierToRatio(opts.tier);
  const country = normaliseCountryCode(opts.country);
  const cells: LookalikePreviewCell[] = [];
  const seen = new Set<string>();

  for (const seed of opts.seeds) {
    if (!seed.metaAudienceId || seen.has(seed.metaAudienceId)) continue;
    seen.add(seed.metaAudienceId);
    const name = buildLookalikeCellName({
      labelPrefix,
      seedName: seed.name,
      tier: opts.tier,
      country,
    });
    cells.push({
      seedMetaAudienceId: seed.metaAudienceId,
      seedName: seed.name,
      seedLocalAudienceId: seed.source === "db" ? (seed.localAudienceId ?? null) : null,
      ratio,
      country,
      name,
    });
  }

  return { labelPrefix, tier: opts.tier, ratio, country, cells };
}

/**
 * Build a human-readable (non-sanitised) cell name.
 *
 * Pattern: "[prefix] <seed-name> LAL <tier>% <country>"
 * Example: "[innervisions] Innervisions 95% VV 60d LAL 1% GB"
 *
 * The unsanitised name can exceed Meta's 50-char limit when the seed name is
 * long. We compose the full name and let `sanitizeAudienceName` truncate at
 * POST time — BUT to keep "LAL X% CC" intact (the most identifying suffix),
 * we cap the seed-name portion here so the suffix always survives.
 *
 * 50-char budget breakdown (pre-sanitise):
 *   "[xxxx] " + seed + " LAL N% CC"      target sanitised ≤ 50 chars
 * Sanitised strips spaces/brackets/etc into underscores AND truncates to 50.
 * We pre-truncate the seed portion to roughly leave room.
 */
export function buildLookalikeCellName(opts: {
  labelPrefix: string;
  seedName: string;
  tier: LookalikeTier;
  country: string;
}): string {
  // Sanitised budget = 50 chars. Suffix " LAL N% CC" sanitises to "LAL_N_CC"
  // (~8 chars for 1-digit tier). Prefix sanitises to "<prefix>_" (~ prefixLen).
  // Reserve ~20 chars for suffix + prefix + glue and cap the raw seed at 60
  // chars (well above the residual budget) — the sanitiser will collapse and
  // truncate further, but we never DROP the suffix entirely.
  const SEED_MAX_RAW = 60;
  const seed = opts.seedName.trim().slice(0, SEED_MAX_RAW);
  const suffix = `LAL ${opts.tier}% ${opts.country}`;
  return `[${opts.labelPrefix}] ${seed} ${suffix}`;
}

function resolveLookalikeLabelPrefix(opts: BuildLookalikePreviewOpts): string {
  const override = opts.labelOverride?.trim();
  if (override) return override;
  const slug = opts.clientSlug?.trim();
  if (slug) return slug;
  return opts.clientName.trim();
}

// ── Preview → DB insert conversion ───────────────────────────────────────────

export interface LookalikeInsertOpts {
  userId: string;
  clientId: string;
  metaAdAccountId: string;
}

/**
 * Convert a preview into MetaCustomAudienceInsert[] — one per cell.
 *
 *   - audienceSubtype = "lookalike"
 *   - sourceId = origin (seed) Meta audience id (used by audit/UI; the payload
 *     reads from sourceMeta.originAudienceId so both stay in sync)
 *   - sourceMeta carries originAudienceId, ratio, country, seedName + provenance
 *   - retentionDays = 1 sentinel: lookalikes auto-refresh from the seed and
 *     Meta ignores retention; the CHECK constraint requires > 0 so we store 1
 *   - funnelStage = "top_of_funnel" — lookalikes are prospecting audiences
 */
export function lookalikePreviewToInserts(
  preview: LookalikePreview,
  opts: LookalikeInsertOpts,
): MetaCustomAudienceInsert[] {
  return preview.cells.map((cell) => ({
    userId: opts.userId,
    clientId: opts.clientId,
    eventId: null,
    name: cell.name,
    funnelStage: "top_of_funnel" satisfies FunnelStage,
    audienceSubtype: "lookalike" as const,
    retentionDays: 1,
    sourceId: cell.seedMetaAudienceId,
    sourceMeta: {
      subtype: "lookalike" as const,
      originAudienceId: cell.seedMetaAudienceId,
      ratio: cell.ratio,
      country: cell.country,
      seedName: cell.seedName,
      seedLocalAudienceId: cell.seedLocalAudienceId,
      type: "similarity" as const,
    },
    metaAdAccountId: opts.metaAdAccountId,
  }));
}
