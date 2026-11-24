/**
 * lib/mcp/rate-limit.ts
 *
 * Per-grant budget: 60 calls a minute, 600 an hour. Every call is an
 * mcp_actions row, so the counts come from there and hold across Fluid
 * instances. With the table missing (local runs before 268 is applied) it
 * falls back to an in-process window.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { RATE_LIMIT_PER_HOUR, RATE_LIMIT_PER_MINUTE } from "./config.ts";
import { isMissingTable } from "./action-log.ts";

type Db = Pick<SupabaseClient, "from">;

export type RateDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

const memory = new Map<string, number[]>();

export function memoryRateCheck(grantId: string, nowMs: number, limits = { minute: RATE_LIMIT_PER_MINUTE, hour: RATE_LIMIT_PER_HOUR }): RateDecision {
  const hits = (memory.get(grantId) ?? []).filter((t) => t > nowMs - 3_600_000);
  const lastMinute = hits.filter((t) => t > nowMs - 60_000).length;
  if (lastMinute >= limits.minute) return { ok: false, retryAfterSeconds: 60 };
  if (hits.length >= limits.hour) return { ok: false, retryAfterSeconds: 3600 };
  hits.push(nowMs);
  memory.set(grantId, hits);
  return { ok: true };
}

export function resetMemoryRateLimit(): void {
  memory.clear();
}

async function countSince(db: Db, grantId: string, sinceIso: string): Promise<{ n: number | null; missing: boolean }> {
  const res = await db
    .from("mcp_actions")
    .select("id", { count: "exact", head: true })
    .eq("grant_id", grantId)
    .gte("created_at", sinceIso);
  if (res.error) return { n: null, missing: isMissingTable(res.error.message) };
  return { n: res.count ?? 0, missing: false };
}

/**
 * One tools/call costs one unit. Protocol messages (initialize, tools/list)
 * are not logged, so they don't count against the table; the in-process
 * window covers them too.
 */
export async function checkRateLimit(db: Db | null, grantId: string, now = new Date()): Promise<RateDecision> {
  const nowMs = now.getTime();
  const local = memoryRateCheck(grantId, nowMs);
  if (!local.ok || !db) return local;
  const minute = await countSince(db, grantId, new Date(nowMs - 60_000).toISOString());
  if (minute.missing || minute.n === null) return local;
  if (minute.n >= RATE_LIMIT_PER_MINUTE) return { ok: false, retryAfterSeconds: 60 };
  const hour = await countSince(db, grantId, new Date(nowMs - 3_600_000).toISOString());
  if (hour.n !== null && hour.n >= RATE_LIMIT_PER_HOUR) return { ok: false, retryAfterSeconds: 3600 };
  return { ok: true };
}
