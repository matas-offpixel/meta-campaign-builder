import { NextRequest, NextResponse } from "next/server";

import { loadChannelDefaultsForEvent } from "@/lib/clients/channel-defaults";
import { createClient } from "@/lib/supabase/server";
import { loadLinkedDraftsForPlan } from "@/lib/plan/linked-drafts";
import { collectPlanPreflight } from "@/lib/plan/preflight";
import type { CampaignPlan } from "@/lib/plan/types";

function isCampaignPlan(value: unknown): value is CampaignPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as CampaignPlan;
  return typeof plan.id === "string" && !!plan.intent && !!plan.launches;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  let plan: CampaignPlan;
  try {
    const body = (await req.json()) as { plan?: unknown };
    if (!isCampaignPlan(body.plan)) {
      return NextResponse.json({ ok: false, error: "Missing required field: plan" }, { status: 400 });
    }
    plan = body.plan;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "bad JSON" },
      { status: 400 },
    );
  }

  const linked = await loadLinkedDraftsForPlan(supabase, plan);
  const channel = await loadChannelDefaultsForEvent(supabase, plan.intent.eventId);
  const result = collectPlanPreflight(plan, linked, channel);
  return NextResponse.json({
    ok: result.ok,
    issues: result.issues,
    previews: {
      meta: {
        name: result.drafts.meta.settings.campaignName,
        objective: result.drafts.meta.settings.objective,
        dailyBudget: result.drafts.meta.budgetSchedule.budgetAmount,
        destinationUrl: result.drafts.meta.creatives[0]?.destinationUrl ?? null,
      },
      tiktok: {
        name: result.drafts.tiktok.campaignSetup.campaignName,
        objective: result.drafts.tiktok.campaignSetup.objective,
        dailyBudget: result.drafts.tiktok.budgetSchedule.dailyBudget,
        destinationUrl: result.drafts.tiktok.creatives.items[0]?.landingPageUrl ?? null,
      },
      google: {
        name: result.drafts.google.plan.name,
        objective: "search",
        dailyBudget: result.drafts.google.plan.total_budget,
        destinationUrl: result.drafts.google.campaigns[0]?.ad_groups[0]?.rsas[0]?.final_url ?? null,
      },
    },
  });
}
