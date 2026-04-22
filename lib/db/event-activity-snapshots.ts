import "server-only";

/**
 * lib/db/event-activity-snapshots.ts
 *
 * Thin wrapper around the event_activity_snapshots cache table.
 * The route layer owns TTL logic — these helpers are dumb read /
 * upsert primitives that just shuttle JSON in and out of Supabase.
 *
 * The unique constraint on (event_id, source) means upsert always
 * replaces wholesale, which matches our refresh semantics: each
 * source is fetched as one logical blob.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";

export type ActivitySource = "google_news" | "spotify_releases" | "weather";

export interface ActivitySnapshot<T = unknown> {
  payload: T;
  fetched_at: string;
}

interface ReadArgs {
  supabase: SupabaseClient<Database>;
  userId: string;
  eventId: string;
  source: ActivitySource;
}

interface UpsertArgs<T> extends ReadArgs {
  payload: T;
}

export async function readSnapshot<T = unknown>(
  args: ReadArgs,
): Promise<ActivitySnapshot<T> | null> {
  const { supabase, userId, eventId, source } = args;
  const { data, error } = await supabase
    .from("event_activity_snapshots")
    .select("payload_jsonb, fetched_at")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .eq("source", source)
    .maybeSingle();
  if (error) {
    // We intentionally swallow read errors: a missing cache row should
    // not block a live fetch. Caller treats null as "no cache".
    console.warn(
      `[event-activity-snapshots] read failed (event=${eventId}, source=${source}):`,
      error.message,
    );
    return null;
  }
  if (!data) return null;
  return {
    payload: data.payload_jsonb as unknown as T,
    fetched_at: data.fetched_at,
  };
}

export async function upsertSnapshot<T>(args: UpsertArgs<T>): Promise<void> {
  const { supabase, userId, eventId, source, payload } = args;
  const { error } = await supabase
    .from("event_activity_snapshots")
    .upsert(
      {
        user_id: userId,
        event_id: eventId,
        source,
        fetched_at: new Date().toISOString(),
        payload_jsonb: payload as unknown as Json,
      },
      { onConflict: "event_id,source" },
    );
  if (error) {
    // Best-effort cache write — log and move on. The route handler
    // still returns the live payload to the user.
    console.warn(
      `[event-activity-snapshots] upsert failed (event=${eventId}, source=${source}):`,
      error.message,
    );
  }
}
