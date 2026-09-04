import { NextRequest, NextResponse } from "next/server";

import { graphPostWithToken } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { planFanoutGateState } from "@/lib/plan/gate";
import { loadPlanForUser } from "@/lib/plan/load";
import { resumePlanAdapter } from "@/lib/plan/resume";
import { createClient } from "@/lib/supabase/server";
import type { PlanAdapterName } from "@/lib/plan/types";

function isAdapter(value: unknown): value is PlanAdapterName {
  return value === "meta" || value === "tiktok" || value === "google";
}

/**
 * `▷ resume` for one channel. Behind `ENABLE_PLAN_FANOUT` because it is a
 * platform write; Meta-only because Meta is the only platform this app
 * has a status-write path for.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  let adapter: PlanAdapterName;
  try {
    const body = (await req.json()) as { adapter?: unknown };
    if (!isAdapter(body.adapter)) {
      return NextResponse.json(
        { ok: false, error: "Missing required field: adapter" },
        { status: 400 },
      );
    }
    adapter = body.adapter;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const plan = await loadPlanForUser(supabase, id, user.id);
  if (!plan) {
    return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  }

  const gate = planFanoutGateState();
  let token: string | null = null;
  if (gate.enabled && adapter === "meta") {
    try {
      token = (await resolveServerMetaToken(supabase, user.id)).token;
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "No Meta token" },
        { status: 401 },
      );
    }
  }

  const outcome = await resumePlanAdapter({
    adapter,
    campaignId: plan.launches[adapter].platformCampaignId,
    gateEnabled: gate.enabled,
    post: (campaignId) =>
      graphPostWithToken(`/${campaignId}`, { status: "ACTIVE" }, token as string),
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { ok: false, error: outcome.error, skippedReason: outcome.skippedReason ?? null },
      { status: outcome.skippedReason ? 200 : 502 },
    );
  }
  return NextResponse.json({ ok: true, campaignId: outcome.campaignId });
}
