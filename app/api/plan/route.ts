import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { NEW_PLAN_NEEDS_PHASE, existingPhaseOffer } from "@/lib/plan/ad-plan-read";
import { isCampaignPlanPhase } from "@/lib/plan/phase";
import {
  campaignPlanRowExists,
  findCampaignPlanByEventPhase,
  probeCampaignPlansTable,
  upsertCampaignPlan,
} from "@/lib/plan/persist";
import type { CampaignPlan } from "@/lib/plan/types";

function isCampaignPlan(value: unknown): value is CampaignPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as CampaignPlan;
  return typeof plan.id === "string" && !!plan.intent && !!plan.launches;
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const probe = await probeCampaignPlansTable(supabase);
  return NextResponse.json({
    ok: true,
    tableMissing: probe.tableMissing,
    error: probe.error,
  });
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
    plan = { ...body.plan, userId: user.id };
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "bad JSON" },
      { status: 400 },
    );
  }

  const phase = isCampaignPlanPhase(plan.phase) ? plan.phase : null;
  if (phase && plan.intent.eventId) {
    const existing = await findCampaignPlanByEventPhase(
      supabase,
      plan.intent.eventId,
      phase,
    );
    if (existing && existing.id !== plan.id) {
      return NextResponse.json(
        {
          ok: false,
          existingPlanId: existing.id,
          existingPhase: existing.phase,
          error: existingPhaseOffer(existing.phase),
        },
        { status: 409 },
      );
    }
  }

  const exists = await campaignPlanRowExists(supabase, plan.id);
  if (!exists && !phase) {
    return NextResponse.json({ ok: false, error: NEW_PLAN_NEEDS_PHASE }, { status: 400 });
  }

  const result = await upsertCampaignPlan(supabase, plan);
  if (!result.ok) {
    if (result.existingPlanId) {
      return NextResponse.json(
        {
          ok: false,
          existingPlanId: result.existingPlanId,
          existingPhase: result.existingPhase,
          error: result.error,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        tableMissing: result.tableMissing,
        error: result.error,
      },
      { status: result.tableMissing ? 503 : 400 },
    );
  }
  return NextResponse.json({ ok: true, plan });
}
