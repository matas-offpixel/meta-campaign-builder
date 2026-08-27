import { NextRequest, NextResponse } from "next/server";

import { loadPlanTemplateEventSource } from "@/lib/plan/event-source";
import { extractPlanTemplateSnapshot } from "@/lib/plan/library";
import { loadPlanForUser } from "@/lib/plan/load";
import { insertPlanTemplate, loadPlanTemplatesForUser } from "@/lib/plan/plan-templates";
import { createClient } from "@/lib/supabase/server";

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const result = await loadPlanTemplatesForUser(supabase, user.id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, tableMissing: result.tableMissing, error: result.error },
      { status: result.tableMissing ? 503 : 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    templates: result.templates,
    tableMissing: result.tableMissing,
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
  const body = (await req.json()) as {
    planId?: string;
    name?: string;
    description?: string;
    tags?: string[];
  };
  if (!body.planId || !body.name?.trim()) {
    return NextResponse.json({ ok: false, error: "planId and name are required" }, { status: 400 });
  }
  const plan = await loadPlanForUser(supabase, body.planId, user.id);
  if (!plan) {
    return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  }
  const event = await loadPlanTemplateEventSource(supabase, plan.intent.eventId, user.id);
  const snapshot = extractPlanTemplateSnapshot(plan, event);
  const result = await insertPlanTemplate(supabase, {
    userId: user.id,
    name: body.name.trim(),
    description: (body.description ?? "").trim(),
    tags: body.tags ?? [],
    snapshot,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, tableMissing: result.tableMissing, error: result.error },
      { status: result.tableMissing ? 503 : 400 },
    );
  }
  return NextResponse.json({ ok: true, template: result.template });
}
