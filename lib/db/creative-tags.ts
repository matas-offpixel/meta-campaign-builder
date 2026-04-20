import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  CreativeTagInsert,
  CreativeTagRow,
} from "@/lib/types/intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side helpers for the `creative_tags` table (migration 020).
//
// Tags are scoped to (user_id, meta_ad_id, tag_type, tag_value) — the unique
// constraint guarantees one tag per ad/type/value combo. Inserts conflict on
// that key, so callers should treat addTag as idempotent on a re-run.
//
// TODO(post-020): drop the `as never` casts once types regenerate.
// ─────────────────────────────────────────────────────────────────────────────

export type { CreativeTagRow, CreativeTagInsert };

export async function listTagsForAd(
  userId: string,
  metaAdId: string,
): Promise<CreativeTagRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("creative_tags" as never)
    .select("*")
    .eq("user_id", userId)
    .eq("meta_ad_id", metaAdId);
  if (error) {
    console.warn("[creative-tags listTagsForAd]", error.message);
    return [];
  }
  return ((data as unknown as CreativeTagRow[]) ?? []) as CreativeTagRow[];
}

export async function listTagsForEvent(
  userId: string,
  eventId: string,
): Promise<CreativeTagRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("creative_tags" as never)
    .select("*")
    .eq("user_id", userId)
    .eq("event_id", eventId);
  if (error) {
    console.warn("[creative-tags listTagsForEvent]", error.message);
    return [];
  }
  return ((data as unknown as CreativeTagRow[]) ?? []) as CreativeTagRow[];
}

/**
 * Every tag for the user — used by the heatmap so the merge into
 * CreativeInsightRow is one round-trip per page load instead of N.
 */
export async function listAllTagsForUser(
  userId: string,
): Promise<CreativeTagRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("creative_tags" as never)
    .select("*")
    .eq("user_id", userId);
  if (error) {
    console.warn("[creative-tags listAllTagsForUser]", error.message);
    return [];
  }
  return ((data as unknown as CreativeTagRow[]) ?? []) as CreativeTagRow[];
}

export async function addTag(
  userId: string,
  input: Omit<CreativeTagInsert, "user_id">,
): Promise<CreativeTagRow> {
  const supabase = await createClient();
  const payload = { ...input, user_id: userId } as unknown as Record<string, unknown>;
  const { data, error } = await supabase
    .from("creative_tags" as never)
    .insert(payload as never)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("addTag returned no row");
  return data as unknown as CreativeTagRow;
}

export async function removeTag(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("creative_tags" as never)
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function bulkAddTags(
  userId: string,
  tags: Array<Omit<CreativeTagInsert, "user_id">>,
): Promise<CreativeTagRow[]> {
  if (tags.length === 0) return [];
  const supabase = await createClient();
  const payload = tags.map((t) => ({ ...t, user_id: userId }));
  const { data, error } = await supabase
    .from("creative_tags" as never)
    .insert(payload as never)
    .select("*");
  if (error) throw new Error(error.message);
  return ((data as unknown as CreativeTagRow[]) ?? []) as CreativeTagRow[];
}
