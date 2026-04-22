import { NextResponse, type NextRequest } from "next/server";

import { MetaApiError } from "@/lib/meta/client";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  listEligibleAccountPairs,
  upsertCreativeSnapshots,
} from "@/lib/db/creative-insight-snapshots";
import { fetchCreativeInsights } from "@/lib/meta/creative-insights";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import type { CreativeDatePreset } from "@/lib/types/intelligence";

/**
 * GET /api/cron/refresh-creative-insights
 *
 * Vercel Cron entry point. Pre-warms `creative_insight_snapshots`
 * for EVERY `(user_id, ad_account_id)` pair derived from
 * `clients.meta_ad_account_id` — not just the subset that already
 * has snapshot rows. The previous warm-set source meant a brand-new
 * client never got cached until somebody manually clicked Refresh,
 * which is how 4TheFans ate a Meta rate-limit on its first heatmap
 * visit. The /intelligence/creatives read route serves from this
 * cache; the live Meta fetch (which can take ~5 min on a 1k-ad
 * account) only runs on explicit `?refresh=1` from the user.
 *
 * Cadence: configured in `vercel.json`. The schedule itself isn't
 * touched by this route.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`. Same
 * shape as `/api/cron/sync-ticketing`. 401 on mismatch so a leaked
 * URL alone isn't enough to trigger.
 *
 * Per-account isolation:
 *   - Each pair runs inside its own try/catch so one rate-limited
 *     account can't abort the rest of the batch.
 *   - We sleep 30s between accounts to avoid self-inflicting a
 *     Meta rate limit when the warm-set has dozens of accounts.
 *   - We log per-account outcome (success / rate-limited /
 *     other-error) so Vercel logs surface which accounts are
 *     consistently failing.
 *
 * Soft timeout: stops iterating new pairs near the end of the
 * function budget so the JSON response can still flush. The next
 * cron tick picks up where this one left off.
 */

/**
 * Vercel function timeout. 300s lets us process roughly nine
 * accounts per run with the 30s inter-account spacing below.
 * Requires Pro plan; if you're on Hobby, drop this to 60 and
 * accept that one cron tick will only cover a single account.
 */
export const maxDuration = 300;

/**
 * Stop scheduling NEW accounts ~10s before the function timeout
 * fires so the response payload (which the user reads from Vercel
 * logs) actually flushes. Tuned against `maxDuration` above.
 */
const SOFT_TIMEOUT_MS = 290_000;

/**
 * Pause between consecutive account fetches to avoid
 * self-inflicting a Meta rate limit on a single cron run. 30s
 * matches Meta's documented rate-limit window for the ad-insights
 * endpoint.
 */
const INTER_ACCOUNT_DELAY_MS = 30_000;

/**
 * Same code-set the route + meta client treat as transient/retryable
 * so we can label per-account failures correctly in the logs.
 * Duplicated rather than imported because both call sites already
 * own their own copies and changing the live route's mapping is out
 * of scope for this PR.
 */
const RATE_LIMIT_CODES = new Set<number>([1, 2, 4, 17, 32, 341, 613]);

type AccountOutcome = "ok" | "rate_limited" | "other_error" | "no_token" | "timeout";

function classifyError(err: unknown): "rate_limited" | "other_error" {
  if (err instanceof MetaApiError && err.code != null && RATE_LIMIT_CODES.has(err.code)) {
    return "rate_limited";
  }
  return "other_error";
}

function logAccount(
  pair: { userId: string; adAccountId: string },
  outcome: AccountOutcome,
  detail: string,
): void {
  // Single-line, prefix-stable log so a Vercel logs filter for
  // "[cron refresh-creative-insights]" surfaces the per-account
  // table. `outcome` and `account` are first so they sort cleanly
  // when grepping.
  console.log(
    `[cron refresh-creative-insights] outcome=${outcome} account=${pair.adAccountId} user=${pair.userId} ${detail}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  const pairs = await listEligibleAccountPairs(supabase);
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

  console.log(
    `[cron refresh-creative-insights] starting pairs=${pairs.length}`,
  );

  const results: PairResult[] = [];
  const seenUsers = new Set<string>();
  let totalSnapshotsWritten = 0;
  let timedOut = false;
  let firstAccountStarted = false;

  for (const pair of pairs) {
    if (timedOut) {
      logAccount(pair, "timeout", "skipped (cron budget exhausted)");
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

    // Inter-account 30s spacing. Skip the wait before the first
    // account so an idle cron doesn't sit on its hands. Done before
    // the per-account try/catch so a sleep can't hide inside an
    // error path that's supposed to be local-only.
    if (firstAccountStarted) {
      if (Date.now() - startMs + INTER_ACCOUNT_DELAY_MS > SOFT_TIMEOUT_MS) {
        timedOut = true;
        logAccount(pair, "timeout", "skipped before inter-account sleep");
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
      await sleep(INTER_ACCOUNT_DELAY_MS);
    }
    firstAccountStarted = true;

    seenUsers.add(pair.userId);

    // Per-account try/catch — anything thrown inside this block must
    // not abort the surrounding pairs loop. Token resolution failure
    // and per-preset Meta failures are both contained here.
    try {
      let token: string;
      try {
        const resolved = await resolveServerMetaToken(supabase, pair.userId);
        token = resolved.token;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logAccount(pair, "no_token", message);
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
      let rateLimitedThisAccount = false;

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
          if (classifyError(err) === "rate_limited") {
            rateLimitedThisAccount = true;
            // Don't burn the second preset against an account Meta is
            // already throttling — bail to the next account, which the
            // 30s sleep will give Meta room to recover from.
            break;
          }
        }
      }

      const outcome: AccountOutcome =
        errors.length === 0
          ? "ok"
          : rateLimitedThisAccount
            ? "rate_limited"
            : "other_error";
      const detail =
        outcome === "ok"
          ? `presetsRun=${presetsRun} snapshotsWritten=${snapshotsWritten}`
          : `presetsRun=${presetsRun} snapshotsWritten=${snapshotsWritten} errors=${errors
              .map((e) => `${e.preset}:${e.message}`)
              .join(" | ")}`;
      logAccount(pair, outcome, detail);

      results.push({
        userId: pair.userId,
        adAccountId: pair.adAccountId,
        presetsRun,
        snapshotsWritten,
        errors,
      });
    } catch (err) {
      // Defensive: anything escaping the inner try (shouldn't happen,
      // but the whole point of this PR is that one bad account can't
      // poison the rest) gets caught and logged here.
      const message = err instanceof Error ? err.message : String(err);
      logAccount(pair, "other_error", `unhandled: ${message}`);
      results.push({
        userId: pair.userId,
        adAccountId: pair.adAccountId,
        presetsRun: 0,
        snapshotsWritten: 0,
        errors: [{ preset: PREWARM_PRESETS[0], message }],
      });
    }
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
