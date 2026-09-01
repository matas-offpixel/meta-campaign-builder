import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { graphGetWithToken, graphPostWithToken, getLastKnownMetaAppUsage } from "@/lib/meta/client";
import { appUsageBadgePercent } from "@/lib/meta/app-usage";
import {
  fetchCampaignAdSetInsights,
  fetchCampaignBudgetInsights,
  type OptimisationGraphFetcher,
  type OptimisationNodeFetcher,
} from "@/lib/optimisation/insights-fetch";
import { runOptimisationTick, type OptimisationTickSummary } from "@/lib/optimisation/tick-runner";
import { isOptimisationWritesEnabledFromEnv } from "@/lib/optimisation/gates";
import {
  insertAutomationDecision,
  loadOptedInCampaignsForAutomation,
} from "@/lib/db/campaign-automation-decisions";
import {
  fetchEventChannelRollup,
  loadPlanLinkedChannelSubjects,
} from "@/lib/db/cross-channel-automation";
import { getAdSetAutomationState } from "@/lib/db/optimisation-decisions";
import { notify } from "@/lib/notify/slack";
import { buildLiveNotifyDeps } from "@/lib/notify/slack-deps";

/**
 * GET /api/cron/optimisation-tick
 *
 * Task #120, PR B — the Step 6 "Optimisation Strategy" automation loop.
 * Every 4h (`vercel.json`), evaluates every ad set in every
 * `status = 'published' AND optimisation_automation_enabled = true`
 * campaign against `evaluate.ts` (the single source of decision logic)
 * and, when the three-of-three live gate is open, applies
 * `scale_up` / `scale_down` via `POST /{adset_id}` `daily_budget`
 * (ABO) or `POST /{campaign_id}` `daily_budget` (CBO).
 *
 * Three-of-three (mirrors D2C `shouldD2CDryRun`):
 *   a) `ENABLE_OPTIMISATION_WRITES === "1"`
 *   b) `campaign_drafts.optimisation_automation_enabled`
 *   c) `campaign_drafts.optimisation_automation_live`
 * Anything less → shadow insert (`dry_run=true`, `applied=false`).
 *
 * Pause is recommend-only: never a Meta write; Slack `ads_urgent` instead.
 *
 * Killswitch: `ENABLE_OPTIMISATION_AUTOMATION` must be exactly `"1"` or
 * the route responds 200 with `skippedReason: "killswitch"`.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`.
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
 * Returns `false` (never throttle) when no snapshot exists yet.
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
  const writesEnabled = isOptimisationWritesEnabledFromEnv();
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

  const notifyDeps = buildLiveNotifyDeps(supabase);

  let summary: OptimisationTickSummary;
  try {
    summary = await runOptimisationTick(enabled, quotaThrottled, {
      loadOptedInCampaigns: () => loadOptedInCampaignsForAutomation(supabase),
      getAdSetState: (adsetId, sinceISO) => getAdSetAutomationState(supabase, adsetId, sinceISO),
      insertDecision: (row) => insertAutomationDecision(supabase, row),
      fetchInsights: (campaignId, window) =>
        fetchCampaignAdSetInsights(
          graphGetWithToken as OptimisationGraphFetcher,
          campaignId,
          token as string,
          window,
        ),
      fetchCampaignInsights: (campaignId, window) =>
        fetchCampaignBudgetInsights(
          graphGetWithToken as OptimisationNodeFetcher,
          campaignId,
          token as string,
          window,
        ),
      readAdSetDailyBudget: async (adsetId) => {
        const res = await graphGetWithToken<{ daily_budget?: string }>(
          `/${adsetId}`,
          { fields: "daily_budget" },
          token as string,
          { maxAttempts: 1 },
        );
        const n = Number(res.daily_budget);
        return Number.isFinite(n) ? n : null;
      },
      updateAdSetDailyBudget: (adsetId, dailyBudgetPence) =>
        graphPostWithToken(`/${adsetId}`, { daily_budget: dailyBudgetPence }, token as string),
      readCampaignDailyBudget: async (campaignId) => {
        const res = await graphGetWithToken<{ daily_budget?: string }>(
          `/${campaignId}`,
          { fields: "daily_budget" },
          token as string,
          { maxAttempts: 1 },
        );
        const n = Number(res.daily_budget);
        return Number.isFinite(n) ? n : null;
      },
      updateCampaignDailyBudget: (campaignId, dailyBudgetPence) =>
        graphPostWithToken(`/${campaignId}`, { daily_budget: dailyBudgetPence }, token as string),
      notify: (opts) => notify(opts, notifyDeps),
      writesEnabled,
      loadCrossChannelSubjects: (metaCampaigns) =>
        loadPlanLinkedChannelSubjects(supabase, metaCampaigns),
      fetchChannelRollup: (subject, window) =>
        fetchEventChannelRollup(supabase, subject.eventId, subject.channel, window),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[optimisation-tick] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json(summary, { status: summary.ok ? 200 : 207 });
}
