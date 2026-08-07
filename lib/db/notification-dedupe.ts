/**
 * lib/db/notification-dedupe.ts
 *
 * Supabase glue for `notification_dedupe_state` (migration 152, task #121
 * Phase 1). Kept separate from the pure `lib/notify/slack.ts` core so that
 * module stays `node --test`-friendly — this is the thin, untested-by-design
 * adapter `lib/notify/slack-deps.ts` wires the real Supabase client into,
 * same split as `lib/db/campaign-automation-decisions.ts`.
 *
 * `notification_dedupe_state` is new as of migration 152 and may not yet be
 * in the generated Supabase types on a fresh checkout — same
 * `as unknown as any` cast used by every other freshly-migrated-table
 * writer in this codebase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DedupeCheckResult } from "@/lib/notify/slack";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

function anySb(supabase: SupabaseClient): AnySupabase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as unknown as any;
}

interface DedupeStateRow {
  last_fired_at: string;
  muted: boolean;
}

/**
 * No row yet → never fired, don't skip. `muted` always wins over the time
 * window. Otherwise skip only while `now - last_fired_at < windowMs`.
 */
export async function checkNotificationDedupe(
  supabase: SupabaseClient,
  dedupeKey: string,
  windowMs: number,
  now: Date,
): Promise<DedupeCheckResult> {
  const sb = anySb(supabase);
  const { data, error } = await sb
    .from("notification_dedupe_state")
    .select("last_fired_at, muted")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();

  if (error) {
    throw new Error(`checkNotificationDedupe: query failed: ${error.message}`);
  }

  const row = data as DedupeStateRow | null;
  if (!row) return { shouldSkip: false };
  if (row.muted) return { shouldSkip: true, reason: "muted" };

  const elapsedMs = now.getTime() - new Date(row.last_fired_at).getTime();
  if (elapsedMs < windowMs) return { shouldSkip: true, reason: "deduped" };
  return { shouldSkip: false };
}

/**
 * Upserts the dedupe row: stamps `last_fired_at` to now, increments
 * `fire_count`, and overwrites `data` with the latest payload for
 * debugging. Reads the current `fire_count` first — an acceptable
 * read-then-write race for a notification service (worst case:
 * `fire_count` under-counts by one on a concurrent double-fire, which
 * cannot happen in practice since this cron runs single-instance hourly).
 */
export async function recordNotificationFire(
  supabase: SupabaseClient,
  dedupeKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const sb = anySb(supabase);
  const { data: existing, error: selectError } = await sb
    .from("notification_dedupe_state")
    .select("fire_count")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();

  if (selectError) {
    throw new Error(`recordNotificationFire: select failed: ${selectError.message}`);
  }

  const nextFireCount = ((existing as { fire_count: number } | null)?.fire_count ?? 0) + 1;

  const { error } = await sb.from("notification_dedupe_state").upsert({
    dedupe_key: dedupeKey,
    last_fired_at: new Date().toISOString(),
    fire_count: nextFireCount,
    data: payload,
  });

  if (error) {
    throw new Error(`recordNotificationFire: upsert failed: ${error.message}`);
  }
}
