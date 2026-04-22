import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  listWarmPairs,
  upsertCreativeSnapshots,
} from "@/lib/db/creative-insight-snapshots";
import { fetchCreativeInsights } from "@/lib/meta/creative-insights";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import type { CreativeDatePreset } from "@/lib/types/intelligence";

/**
 * GET /api/cron/refresh-creative-insights
 *
 * Vercel Cron entry point. Pre-warms `creative_insight_snapshots`
 * every 2h for the warm-set of `(user_id, ad_account_id)` pairs
 * that have viewed the heatmap at least once. The /intelligence/
 * creatives read route serves from this cache; the live Meta fetch
 * (which can take ~5 min on a 1k-ad account) only runs on explicit
 * `?refresh=1` from the user.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`. Same
 * shape as `/api/cron/sync-ticketing`. 401 on mismatch so a leaked
 * URL alone isn't enough to trigger.
 *
 * Per-pair errors are isolated — one bad ad account must never kill
 * the batch. Soft 55s timeout (Vercel Hobby caps the function at
 * 60s; we leave a small budget so the JSON response actually
 * flushes). If we hit it, we stop iterating new pairs and report
 * what completed.
 */

const SOFT_TIMEOUT_MS = 55_000;

/**
 * Date presets we pre-warm on cron. Capped at two windows so we don't
 * 7× the Meta load — `today` and `maximum` are still available via
 * manual "Refresh from Meta" but aren't worth the cron budget.
 */
const PREWARM_PRESETS: CreativeDatePreset[] = ["last_7d", "last_30d"];

interface PairResult {
  userId: string;
  adAccountId: string;
  presetsRun: number;
  snapshotsWritten: number;
  skipped?: "no_token" | "timeout";
  errors: { preset: CreativeDatePreset; message: string }[];
}

interface RefreshResponse {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  usersProcessed: number;
  accountsProcessed: number;
  snapshotsWritten: number;
  results: PairResult[];
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const pairs = await listWarmPairs(supabase);
  if (pairs.length === 0) {
    const finishedAt = new Date().toISOString();
    const empty: RefreshResponse = {
      ok: true,
      startedAt,
      finishedAt,
      usersProcessed: 0,
      accountsProcessed: 0,
      snapshotsWritten: 0,
      results: [],
    };
    return NextResponse.json(empty);
  }

  const results: PairResult[] = [];
  const seenUsers = new Set<string>();
  let totalSnapshotsWritten = 0;
  let timedOut = false;

  for (const pair of pairs) {
    if (timedOut) {
      results.push({
        userId: pair.userId,
        adAccountId: pair.adAccountId,
        presetsRun: 0,
        snapshotsWritten: 0,
        skipped: "timeout",
        errors: [],
      });
      continue;
    }

    seenUsers.add(pair.userId);

    // Resolve the Meta token once per pair (the token is per-user but
    // pulling it inside the loop keeps the failure mode local — a user
    // who's revoked their token doesn't poison the whole batch).
    let token: string;
    try {
      const resolved = await resolveServerMetaToken(supabase, pair.userId);
      token = resolved.token;
    } catch {
      results.push({
        userId: pair.userId,
        adAccountId: pair.adAccountId,
        presetsRun: 0,
        snapshotsWritten: 0,
        skipped: "no_token",
        errors: [],
      });
      continue;
    }

    const errors: PairResult["errors"] = [];
    let presetsRun = 0;
    let snapshotsWritten = 0;

    for (const preset of PREWARM_PRESETS) {
      if (Date.now() - startMs > SOFT_TIMEOUT_MS) {
        timedOut = true;
        break;
      }
      try {
        const rows = await fetchCreativeInsights(pair.adAccountId, token, {
          datePreset: preset,
        });
        const { written } = await upsertCreativeSnapshots({
          supabase,
          userId: pair.userId,
          adAccountId: pair.adAccountId,
          datePreset: preset,
          rows,
        });
        presetsRun += 1;
        snapshotsWritten += written;
        totalSnapshotsWritten += written;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ preset, message });
      }
    }

    results.push({
      userId: pair.userId,
      adAccountId: pair.adAccountId,
      presetsRun,
      snapshotsWritten,
      errors,
    });
  }

  const finishedAt = new Date().toISOString();
  const allOk =
    !timedOut && results.every((r) => r.errors.length === 0 && !r.skipped);

  const response: RefreshResponse = {
    ok: allOk,
    startedAt,
    finishedAt,
    usersProcessed: seenUsers.size,
    accountsProcessed: results.filter(
      (r) => r.presetsRun > 0 || r.skipped == null,
    ).length,
    snapshotsWritten: totalSnapshotsWritten,
    results,
  };

  return NextResponse.json(response, { status: allOk ? 200 : 207 });
}
