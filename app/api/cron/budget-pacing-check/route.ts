import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { graphGetWithToken } from "@/lib/meta/client";
import { graphMultiGetByIds } from "@/lib/meta/graph-multi-get";
import { fetchCampaignSpendPence, type BudgetPacingGraphFetcher } from "@/lib/budget-pacing/spend-fetch";
import { runBudgetPacingTick, type BudgetPacingTickSummary } from "@/lib/budget-pacing/tick-runner";
import { loadPublishedCampaignsForBudgetPacing } from "@/lib/db/budget-pacing-campaigns";
import { notify } from "@/lib/notify/slack";
import { buildLiveNotifyDeps } from "@/lib/notify/slack-deps";

/**
 * GET /api/cron/budget-pacing-check
 *
 * Task #121 Phase 2 — hourly (`vercel.json`) budget-pacing alerts, the
 * operator's original ask and the reason Phase 1's Slack service exists.
 * Loads every `status = 'published'` campaign, fetches each one's lifetime
 * Meta spend in a single batched call (see `lib/budget-pacing/spend-fetch.ts`),
 * and posts a `#ads-ops` Slack message for every 25/50/60/70/80/90/100%
 * threshold newly crossed. Zero Meta write calls — read-only insights GETs
 * plus a Slack webhook POST.
 *
 * All decision logic (the budget plan, threshold crossing, dedupe keying)
 * lives in `lib/budget-pacing/tick-runner.ts`'s pure `runBudgetPacingTick`,
 * unit-tested in isolation. This route is intentionally thin: auth →
 * killswitch → wire the pure runner to the real Supabase client, Meta
 * token, and live Slack `notify()` deps — same split as
 * `app/api/cron/optimisation-tick/route.ts`.
 *
 * Killswitch: `ENABLE_BUDGET_PACING_ALERTS` must be exactly `"1"`. Unset
 * (the default) or any other value disables the whole route — it still
 * responds 200 with `skippedReason: "killswitch"` rather than a cron
 * failure, so Vercel's cron monitor doesn't flag a disabled feature as
 * broken. `notify()`'s own `ENABLE_SLACK_NOTIFICATIONS` killswitch is a
 * separate, independent gate — both must be on for a real Slack message.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>` — identical
 * helper to every other cron in this repo.
 */

export const maxDuration = 120;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

function isBudgetPacingEnabled(): boolean {
  return process.env.ENABLE_BUDGET_PACING_ALERTS === "1";
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const enabled = isBudgetPacingEnabled();

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
  if (enabled && !token) {
    return NextResponse.json({ ok: false, error: "META_ACCESS_TOKEN is not configured" }, { status: 500 });
  }

  const notifyDeps = buildLiveNotifyDeps(supabase);

  let summary: BudgetPacingTickSummary;
  try {
    summary = await runBudgetPacingTick(enabled, {
      loadPublishedCampaigns: () => loadPublishedCampaignsForBudgetPacing(supabase),
      fetchSpendPence: (campaignIds) =>
        // Two fetchers: the ≤20 path is a real GET per campaign, the
        // >20 path reads many nodes at once and can no longer use the
        // `ids=` multi-read Meta removed in v26.0. See
        // lib/meta/graph-multi-get-parse.ts.
        fetchCampaignSpendPence(
          graphGetWithToken as BudgetPacingGraphFetcher,
          campaignIds,
          token as string,
          graphMultiGetByIds as BudgetPacingGraphFetcher,
        ),
      notify: (opts) => notify(opts, notifyDeps),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[budget-pacing-check] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json(summary, { status: summary.ok ? 200 : 207 });
}
