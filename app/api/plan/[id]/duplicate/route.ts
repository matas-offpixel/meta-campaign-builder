import { NextRequest, NextResponse } from "next/server";

import { nextDuplicateName } from "@/lib/duplicate-name";
import { loadPlanTemplateEventSource } from "@/lib/plan/event-source";
import { duplicatePlanAsDraft } from "@/lib/plan/library";
import { loadPlanForUser } from "@/lib/plan/load";
import { upsertCampaignPlan } from "@/lib/plan/persist";
import { createClient } from "@/lib/supabase/server";

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
  const body = (await req.json()) as { eventId?: string; name?: string };
  if (!body.eventId) {
    return NextResponse.json({ ok: false, error: "eventId is required" }, { status: 400 });
  }
  const plan = await loadPlanForUser(supabase, id, user.id);
  if (!plan) {
    return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  }
  const [sourceEvent, event] = await Promise.all([
    loadPlanTemplateEventSource(supabase, plan.intent.eventId, user.id),
    loadPlanTemplateEventSource(supabase, body.eventId, user.id),
  ]);
  if (!event) {
    return NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 });
  }
  const { data: nameRows } = await supabase
    .from("campaign_plans")
    .select("name")
    .eq("user_id", user.id);
  const existingNames = ((nameRows ?? []) as Array<{ name: string | null }>)
    .map((row) => row.name)
    .filter((name): name is string => !!name);
  const copy = duplicatePlanAsDraft(plan, {
    userId: user.id,
    eventId: body.eventId,
    sourceEvent,
    event,
    name: body.name?.trim() || nextDuplicateName(plan.name || "Untitled plan", existingNames),
  });
  const result = await upsertCampaignPlan(supabase, copy);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, tableMissing: result.tableMissing, error: result.error },
      { status: result.tableMissing ? 503 : 400 },
    );
  }
  return NextResponse.json({ ok: true, plan: { id: copy.id } });
}
