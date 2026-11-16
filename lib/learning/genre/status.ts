/**
 * The learning-refresh report's genre status lines (GK3, frame G4), read
 * from the latest learning-refresh cron run (`cron_runs.detail.genre`,
 * written by `learningRefreshRunLog`).
 *
 * Operator-only: a user not in OPERATOR_USER_IDS gets null and no read is
 * made. cron_runs is service-role only (migration 195), so the caller passes
 * a service-role client, and this check is the gate.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isOperator } from "../../auth/operator-allowlist.ts";
import { genreStatusLinesFromDetail } from "./status-lines.ts";

type Db = Pick<SupabaseClient, "from">;

export async function loadGenreStatusLines(db: Db | (() => Db), userId: string | null | undefined): Promise<string[] | null> {
  if (!userId || !isOperator(userId)) return null;
  const client = typeof db === "function" ? db() : db;
  const { data, error } = await client
    .from("cron_runs")
    .select("detail, started_at")
    .eq("cron_name", "learning-refresh")
    .order("started_at", { ascending: false })
    .range(0, 0);
  if (error) {
    console.warn("[loadGenreStatusLines] read failed:", error.message);
    return [];
  }
  const latest = (data ?? [])[0] as { detail?: unknown } | undefined;
  return genreStatusLinesFromDetail(latest?.detail ?? null);
}
