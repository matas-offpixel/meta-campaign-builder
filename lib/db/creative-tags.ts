import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreativeTagInsert as LegacyCreativeTagInsert,
  CreativeTagRow as LegacyCreativeTagRow,
} from "../types/intelligence.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side helpers for the `creative_tags` table (migration 020).
//
// Tags are scoped to (user_id, meta_ad_id, tag_type, tag_value) — the unique
// constraint guarantees one tag per ad/type/value combo. Inserts conflict on
// that key, so callers should treat addTag as idempotent on a re-run.
// ─────────────────────────────────────────────────────────────────────────────

export type {
  LegacyCreativeTagInsert as CreativeTagInsert,
  LegacyCreativeTagRow as CreativeTagRow,
};

type DbClient = Pick<SupabaseClient, "from">;

async function createServerClient() {
  const { createClient } = await import("../supabase/server.ts");
  return createClient();
}

export async function listTagsForAd(
  userId: string,
  metaAdId: string,
): Promise<LegacyCreativeTagRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("creative_tags")
    .select("*")
    .eq("user_id", userId)
    .eq("meta_ad_id", metaAdId);
  if (error) {
    console.warn("[creative-tags listTagsForAd]", error.message);
    return [];
  }
  return (data ?? []) as LegacyCreativeTagRow[];
}

export async function listTagsForEvent(
  userId: string,
  eventId: string,
): Promise<LegacyCreativeTagRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("creative_tags")
    .select("*")
    .eq("user_id", userId)
    .eq("event_id", eventId);
  if (error) {
    console.warn("[creative-tags listTagsForEvent]", error.message);
    return [];
  }
  return (data ?? []) as LegacyCreativeTagRow[];
}

/**
 * Every tag for the user — used by the heatmap so the merge into
 * CreativeInsightRow is one round-trip per page load instead of N.
 */
export async function listAllTagsForUser(
  userId: string,
): Promise<LegacyCreativeTagRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("creative_tags")
    .select("*")
    .eq("user_id", userId);
  if (error) {
    console.warn("[creative-tags listAllTagsForUser]", error.message);
    return [];
  }
  return (data ?? []) as LegacyCreativeTagRow[];
}

export async function addTag(
  userId: string,
  input: Omit<LegacyCreativeTagInsert, "user_id">,
): Promise<LegacyCreativeTagRow> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("creative_tags")
    .insert({ ...input, user_id: userId })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("addTag returned no row");
  return data as LegacyCreativeTagRow;
}

export async function removeTag(id: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase.from("creative_tags").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function bulkAddTags(
  userId: string,
  tags: Array<Omit<LegacyCreativeTagInsert, "user_id">>,
): Promise<LegacyCreativeTagRow[]> {
  if (tags.length === 0) return [];
  const supabase = await createServerClient();
  const payload = tags.map((t) => ({ ...t, user_id: userId }));
  const { data, error } = await supabase
    .from("creative_tags")
    .insert(payload)
    .select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as LegacyCreativeTagRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Motion-replacement taxonomy helpers (migration 061).
//
// Migration 020 already used `creative_tags` for legacy per-Meta-ad tags. The
// Motion taxonomy rows are distinguished by non-null `dimension/value_key`
// columns, and legacy helpers above continue to read/write the old shape.
// ─────────────────────────────────────────────────────────────────────────────

export const CREATIVE_TAG_DIMENSIONS = [
  "asset_type",
  "visual_format",
  "messaging_angle",
  "intended_audience",
  "hook_tactic",
  "headline_tactic",
  "offer_type",
  "seasonality",
] as const;

export type CreativeTagDimension = (typeof CREATIVE_TAG_DIMENSIONS)[number];
export type CreativeTagSource = "motion_seed" | "curated" | "custom";
export type CreativeTagAssignmentSource = "manual" | "ai";
export type CreativeScoreAxis = "hook" | "watch" | "click" | "convert";

export interface MotionCreativeTagRow {
  id: string;
  user_id: string;
  dimension: CreativeTagDimension;
  value_key: string;
  value_label: string;
  description: string | null;
  source: CreativeTagSource;
  created_at: string;
  updated_at: string;
}

export interface CreativeTagAssignmentRow {
  id: string;
  user_id: string;
  event_id: string;
  creative_name: string;
  tag_id: string;
  source: CreativeTagAssignmentSource;
  confidence: number | null;
  model_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreativeScoreRow {
  id: string;
  user_id: string;
  event_id: string;
  creative_name: string;
  axis: CreativeScoreAxis;
  score: number;
  significance: boolean;
  fetched_at: string;
}

export interface UpsertCreativeTagAssignmentArgs {
  userId: string;
  eventId: string;
  creativeName: string;
  tagId: string;
  source: CreativeTagAssignmentSource;
  confidence?: number | null;
  modelVersion?: string | null;
}

export interface BulkUpsertCreativeTagAssignmentsResult {
  inserted: number;
  updated: number;
}

export interface UpsertCreativeScoreArgs {
  userId: string;
  eventId: string;
  creativeName: string;
  axis: CreativeScoreAxis;
  score: number;
  significance?: boolean;
  fetchedAt?: string;
}

interface MotionSeedTag {
  dimension: CreativeTagDimension;
  valueKey: string;
  valueLabel: string;
  description: string | null;
}

export interface ImportMotionSeedTagsResult {
  inserted: number;
  skipped: number;
}

const TAXONOMY_SELECT =
  "id,user_id,dimension,value_key,value_label,description,source,created_at,updated_at";
const ASSIGNMENT_SELECT =
  "id,user_id,event_id,creative_name,tag_id,source,confidence,model_version,created_at,updated_at";
const SCORE_SELECT =
  "id,user_id,event_id,creative_name,axis,score,significance,fetched_at";

const DIMENSION_ALIASES: Record<string, CreativeTagDimension> = {
  asset_type: "asset_type",
  "asset type": "asset_type",
  visual_format: "visual_format",
  "visual format": "visual_format",
  messaging_angle: "messaging_angle",
  "messaging angle": "messaging_angle",
  "messaging theme": "messaging_angle",
  intended_audience: "intended_audience",
  "intended audience": "intended_audience",
  hook_tactic: "hook_tactic",
  "hook tactic": "hook_tactic",
  headline_tactic: "headline_tactic",
  "headline tactic": "headline_tactic",
  offer_type: "offer_type",
  "offer type": "offer_type",
  seasonality: "seasonality",
};

export async function listCreativeTags(
  supabase: DbClient,
  dimension?: CreativeTagDimension,
): Promise<MotionCreativeTagRow[]> {
  let query = supabase
    .from("creative_tags")
    .select(TAXONOMY_SELECT)
    .not("dimension", "is", null)
    .order("dimension", { ascending: true })
    .order("value_label", { ascending: true });

  if (dimension) {
    query = query.eq("dimension", dimension);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as MotionCreativeTagRow[];
}

export async function upsertCreativeTagAssignment(
  supabase: DbClient,
  args: UpsertCreativeTagAssignmentArgs,
): Promise<CreativeTagAssignmentRow> {
  const { data, error } = await supabase
    .from("creative_tag_assignments")
    .upsert(
      {
        user_id: args.userId,
        event_id: args.eventId,
        creative_name: args.creativeName,
        tag_id: args.tagId,
        source: args.source,
        confidence: args.confidence ?? null,
        model_version: args.modelVersion ?? null,
      },
      { onConflict: "event_id,creative_name,tag_id" },
    )
    .select(ASSIGNMENT_SELECT)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("upsertCreativeTagAssignment returned no row");
  return data as CreativeTagAssignmentRow;
}

export async function bulkUpsertCreativeTagAssignments(
  supabase: DbClient,
  args: UpsertCreativeTagAssignmentArgs[],
): Promise<BulkUpsertCreativeTagAssignmentsResult> {
  const rows = dedupeAssignmentArgs(args);
  let inserted = 0;
  let updated = 0;

  for (let start = 0; start < rows.length; start += 200) {
    const chunk = rows.slice(start, start + 200);
    const existingKeys = await listExistingAssignmentKeys(supabase, chunk);
    inserted += chunk.length - existingKeys.size;
    updated += existingKeys.size;

    const payload = chunk.map((row) => ({
      user_id: row.userId,
      event_id: row.eventId,
      creative_name: row.creativeName,
      tag_id: row.tagId,
      source: row.source,
      confidence: row.confidence ?? null,
      model_version: row.modelVersion ?? null,
    }));

    const { error } = await supabase.from("creative_tag_assignments").upsert(
      payload,
      { onConflict: "event_id,creative_name,tag_id" },
    );

    if (error) throw new Error(error.message);
  }

  return { inserted, updated };
}

export async function listCreativeTagAssignments(
  supabase: DbClient,
  eventId: string,
  creativeName?: string,
): Promise<CreativeTagAssignmentRow[]> {
  let query = supabase
    .from("creative_tag_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("event_id", eventId)
    .order("creative_name", { ascending: true });

  if (creativeName) {
    query = query.eq("creative_name", creativeName);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CreativeTagAssignmentRow[];
}

export async function upsertCreativeScore(
  supabase: DbClient,
  args: UpsertCreativeScoreArgs,
): Promise<CreativeScoreRow> {
  const { data, error } = await supabase
    .from("creative_scores")
    .upsert(
      {
        user_id: args.userId,
        event_id: args.eventId,
        creative_name: args.creativeName,
        axis: args.axis,
        score: args.score,
        significance: args.significance ?? false,
        ...(args.fetchedAt ? { fetched_at: args.fetchedAt } : {}),
      },
      { onConflict: "event_id,creative_name,axis,fetched_at" },
    )
    .select(SCORE_SELECT)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("upsertCreativeScore returned no row");
  return data as CreativeScoreRow;
}

export async function importMotionSeedTags(
  supabase: DbClient,
  userId: string,
  glossaryJson: unknown,
): Promise<ImportMotionSeedTagsResult> {
  const extracted = extractMotionSeedTags(glossaryJson);
  const seen = new Set<string>();
  const seedTags: MotionSeedTag[] = [];
  let skipped = 0;

  for (const tag of extracted) {
    const key = seedKey(tag.dimension, tag.valueKey);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    seedTags.push(tag);
  }

  if (seedTags.length === 0) {
    return { inserted: 0, skipped };
  }

  const { data: existing, error: existingError } = await supabase
    .from("creative_tags")
    .select("dimension,value_key")
    .eq("user_id", userId)
    .not("dimension", "is", null);

  if (existingError) throw new Error(existingError.message);

  const existingKeys = new Set(
    ((existing ?? []) as Array<{ dimension: string; value_key: string }>).map(
      (row) => seedKey(row.dimension, row.value_key),
    ),
  );

  const newSeedTags = seedTags.filter((tag) => {
    const isExisting = existingKeys.has(seedKey(tag.dimension, tag.valueKey));
    if (isExisting) skipped += 1;
    return !isExisting;
  });

  if (newSeedTags.length === 0) {
    return { inserted: 0, skipped };
  }

  const rows = newSeedTags.map((tag) => ({
    user_id: userId,
    dimension: tag.dimension,
    value_key: tag.valueKey,
    value_label: tag.valueLabel,
    description: tag.description,
    source: "motion_seed" satisfies CreativeTagSource,
  }));

  const { error } = await supabase.from("creative_tags").upsert(rows, {
    onConflict: "user_id,dimension,value_key",
  });

  if (error) throw new Error(error.message);
  return { inserted: newSeedTags.length, skipped };
}

export function extractMotionSeedTags(glossaryJson: unknown): MotionSeedTag[] {
  const out: MotionSeedTag[] = [];
  collectSeedTags(glossaryJson, undefined, out);
  return out;
}

function collectSeedTags(
  value: unknown,
  inheritedDimension: CreativeTagDimension | undefined,
  out: MotionSeedTag[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSeedTags(item, inheritedDimension, out);
    }
    return;
  }

  if (!isRecord(value)) {
    const tag = seedTagFromValue(value, inheritedDimension);
    if (tag) out.push(tag);
    return;
  }

  const directDimension = normalizeDimension(readString(value, [
    "dimension",
    "category",
    "tag_type",
    "tagType",
  ]));
  const namedDimension = normalizeDimension(readString(value, ["name"]));
  if (namedDimension && Array.isArray(value.values)) {
    collectSeedTags(value.values, namedDimension, out);
    return;
  }

  const dimension = directDimension ?? inheritedDimension;
  const directTag = seedTagFromRecord(value, dimension);
  if (directTag) out.push(directTag);

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedDimension = normalizeDimension(key);
    if (nestedDimension) {
      collectSeedTags(nestedValue, nestedDimension, out);
    } else if (
      key === "data" ||
      key === "tags" ||
      key === "glossary" ||
      key === "values"
    ) {
      collectSeedTags(nestedValue, dimension, out);
    }
  }
}

function seedTagFromRecord(
  value: Record<string, unknown>,
  dimension: CreativeTagDimension | undefined,
): MotionSeedTag | null {
  if (!dimension) return null;
  const rawLabel =
    readString(value, ["value_label", "valueLabel", "label", "name", "value"]) ??
    readString(value, ["key", "value_key", "valueKey"]);
  if (!rawLabel) return null;

  const rawKey =
    readString(value, ["value_key", "valueKey", "key", "slug"]) ?? rawLabel;
  return {
    dimension,
    valueKey: normalizeValueKey(rawKey),
    valueLabel: rawLabel.trim(),
    description:
      readString(value, ["description", "definition", "notes"])?.trim() ??
      null,
  };
}

function seedTagFromValue(
  value: unknown,
  dimension: CreativeTagDimension | undefined,
): MotionSeedTag | null {
  if (!dimension || typeof value !== "string" || !value.trim()) return null;
  const label = value.trim();
  return {
    dimension,
    valueKey: normalizeValueKey(label),
    valueLabel: label,
    description: null,
  };
}

function normalizeDimension(value: unknown): CreativeTagDimension | undefined {
  if (typeof value !== "string") return undefined;
  return DIMENSION_ALIASES[value.trim().toLowerCase().replace(/-/g, "_")];
}

function normalizeValueKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function seedKey(dimension: string, valueKey: string): string {
  return `${dimension}:${valueKey}`;
}

function dedupeAssignmentArgs(
  args: UpsertCreativeTagAssignmentArgs[],
): UpsertCreativeTagAssignmentArgs[] {
  const byKey = new Map<string, UpsertCreativeTagAssignmentArgs>();
  for (const arg of args) {
    byKey.set(assignmentKey(arg.eventId, arg.creativeName, arg.tagId), arg);
  }
  return [...byKey.values()];
}

async function listExistingAssignmentKeys(
  supabase: DbClient,
  args: UpsertCreativeTagAssignmentArgs[],
): Promise<Set<string>> {
  if (args.length === 0) return new Set();

  const eventIds = [...new Set(args.map((arg) => arg.eventId))];
  const creativeNames = [...new Set(args.map((arg) => arg.creativeName))];
  const tagIds = [...new Set(args.map((arg) => arg.tagId))];
  const { data, error } = await supabase
    .from("creative_tag_assignments")
    .select("event_id,creative_name,tag_id")
    .in("event_id", eventIds)
    .in("creative_name", creativeNames)
    .in("tag_id", tagIds);

  if (error) throw new Error(error.message);

  const wanted = new Set(
    args.map((arg) => assignmentKey(arg.eventId, arg.creativeName, arg.tagId)),
  );
  return new Set(
    (
      (data ?? []) as Array<{
        event_id: string;
        creative_name: string;
        tag_id: string;
      }>
    )
      .map((row) => assignmentKey(row.event_id, row.creative_name, row.tag_id))
      .filter((key) => wanted.has(key)),
  );
}

function assignmentKey(
  eventId: string,
  creativeName: string,
  tagId: string,
): string {
  return `${eventId}\u0000${creativeName}\u0000${tagId}`;
}
