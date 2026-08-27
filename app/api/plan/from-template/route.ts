import { NextRequest, NextResponse } from "next/server";

import { loadPlanTemplateEventSource } from "@/lib/plan/event-source";
import { applyPlanTemplateSnapshot } from "@/lib/plan/library";
import { loadPlanTemplateForUser } from "@/lib/plan/plan-templates";
import { upsertCampaignPlan } from "@/lib/plan/persist";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const body = (await req.json()) as { templateId?: string; eventId?: string; name?: string };
  if (!body.templateId || !body.eventId) {
    return NextResponse.json(
      { ok: false, error: "templateId and eventId are required" },
      { status: 400 },
    );
  }
  const template = await loadPlanTemplateForUser(supabase, body.templateId, user.id);
  if (!template) {
    return NextResponse.json({ ok: false, error: "Template not found" }, { status: 404 });
  }
  const event = await loadPlanTemplateEventSource(supabase, body.eventId, user.id);
  if (!event) {
    return NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 });
  }
  const plan = applyPlanTemplateSnapshot(template.snapshot, {
    userId: user.id,
    eventId: body.eventId,
    event,
    name: body.name?.trim() || template.name,
  });
  const result = await upsertCampaignPlan(supabase, plan);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, tableMissing: result.tableMissing, error: result.error },
      { status: result.tableMissing ? 503 : 400 },
    );
  }
  return NextResponse.json({ ok: true, plan: { id: plan.id } });
}
