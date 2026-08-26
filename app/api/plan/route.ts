import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { probeCampaignPlansTable, upsertCampaignPlan } from "@/lib/plan/persist";
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

  const result = await upsertCampaignPlan(supabase, plan);
  if (!result.ok) {
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
