import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { graphGetWithToken, getLastKnownMetaAppUsage } from "@/lib/meta/client";
import { appUsageBadgePercent } from "@/lib/meta/app-usage";
import { fetchCampaignAdSetInsights, type OptimisationGraphFetcher } from "@/lib/optimisation/insights-fetch";
import { runOptimisationTick, type OptimisationTickSummary } from "@/lib/optimisation/tick-runner";
import {
  hasRecentDecisionForAdSet,
  insertAutomationDecision,
  loadOptedInCampaignsForAutomation,
} from "@/lib/db/campaign-automation-decisions";

/**
 * GET /api/cron/optimisation-tick
 *
 * Task #120, PR A — the Step 6 "Optimisation Strategy" automation loop, in
 * SHADOW MODE ONLY. Every 4h (`vercel.json`), evaluates every ad set in every
 * `status = 'published' AND optimisation_automation_enabled = true` campaign
 * against its own rules/guardrails, and writes what the automation WOULD do
 * to `campaign_automation_decisions`. Zero Meta write calls — this route
 * only ever calls `graphGetWithToken` (a GET). PR B is the follow-up that
 * starts actually applying `scale_up`/`scale_down`/`pause`.
 *
 * All decision logic (rule matching, guardrail clamping, dormant/recent-touch
 * skips) lives in `lib/optimisation/evaluate.ts` + the pure orchestrator
 * `lib/optimisation/tick-runner.ts`, unit-tested in isolation. This route is
 * intentionally thin: auth → killswitch → quota check → wire the pure runner
 * to the real Supabase client + Meta token, same split as
 * `refresh-active-creatives` (`refreshActiveCreativesForEvent`) and
 * `cron-health-check` (`runCronHealthCheck`).
 *
 * Killswitch: `ENABLE_OPTIMISATION_AUTOMATION` must be exactly `"1"`. Unset
 * (the default) or any other value disables the whole route — it still
 * responds 200 with `skippedReason: "killswitch"` rather than a cron
 * failure, so Vercel's cron monitor doesn't flag a disabled feature as
 * broken.
 *
 * Quota check: reads `getLastKnownMetaAppUsage()` — the in-memory
 * `X-App-Usage` snapshot `lib/meta/client.ts` already maintains for the
 * `/business-managers` quota indicator (task #100). Best-effort only: on a
 * cold Lambda start (the common case for a 4h-interval cron) there is no
 * prior snapshot yet and this check is a no-op — the tick proceeds and the
 * FIRST real Graph call of the run will itself populate the snapshot for
 * next time. This is the same "no in-memory history yet" caveat the
 * indicator already documents; there is no cross-invocation store to read a
 * true pre-flight number from, and standing one up (e.g. a Redis/Supabase
 * cache of the last snapshot) is exactly the "add it as a task follow-up"
 * called for in the PR A brief when a real prerequisite isn't shipped yet.
 * Throttle threshold: 70% of any usage dimension (call_count/total_time/
 * total_cputime) — matches the brief's "if any bucket > 70%" instruction.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>` — identical
 * helper to every other cron in this repo.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const QUOTA_THROTTLE_PERCENT = 70;

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

function isAutomationEnabled(): boolean {
  return process.env.ENABLE_OPTIMISATION_AUTOMATION === "1";
}

/**
 * Best-effort quota check against the in-memory `X-App-Usage` snapshot.
 * Returns `false` (never throttle) when no snapshot exists yet — see the
 * route doc comment above for why that's the correct default, not a gap
 * being silently swallowed.
 */
function isQuotaThrottled(): boolean {
  const last = getLastKnownMetaAppUsage();
  if (!last) {
    console.log("[optimisation-tick] no X-App-Usage snapshot yet on this instance — quota check skipped");
    return false;
  }
  const pct = appUsageBadgePercent(last.snapshot);
  const throttled = pct > QUOTA_THROTTLE_PERCENT;
  console.log(
    `[optimisation-tick] last known app usage=${pct.toFixed(1)}% (captured_at=${last.capturedAt}) throttled=${throttled}`,
  );
  return throttled;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const enabled = isAutomationEnabled();
  const quotaThrottled = enabled ? isQuotaThrottled() : false;

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" },
      { status: 500 },
    );
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (enabled && !quotaThrottled && !token) {
    return NextResponse.json(
      { ok: false, error: "META_ACCESS_TOKEN is not configured" },
      { status: 500 },
    );
  }

  let summary: OptimisationTickSummary;
  try {
    summary = await runOptimisationTick(enabled, quotaThrottled, {
      loadOptedInCampaigns: () => loadOptedInCampaignsForAutomation(supabase),
      hasRecentDecision: (adsetId, sinceISO) => hasRecentDecisionForAdSet(supabase, adsetId, sinceISO),
      insertDecision: (row) => insertAutomationDecision(supabase, row),
      fetchInsights: (campaignId, window) =>
        fetchCampaignAdSetInsights(
          graphGetWithToken as OptimisationGraphFetcher,
          campaignId,
          token as string,
          window,
        ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[optimisation-tick] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json(summary, { status: summary.ok ? 200 : 207 });
}
