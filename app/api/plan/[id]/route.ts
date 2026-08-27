import { NextRequest, NextResponse } from "next/server";

import { archiveCampaignPlan, deleteCampaignPlan, unarchiveCampaignPlan } from "@/lib/plan/dispose";
import { loadPlanForUser } from "@/lib/plan/load";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _req: NextRequest,
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
  const plan = await loadPlanForUser(supabase, id, user.id);
  if (!plan) {
    return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  }
  const result = await deleteCampaignPlan(supabase, id, user.id);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        action: result.action,
        tableMissing: result.tableMissing,
        error: result.error,
      },
      { status: result.action === "archive" ? 409 : result.tableMissing ? 503 : 400 },
    );
  }
  return NextResponse.json({ ok: true, action: "delete" });
}

export async function PATCH(
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
  let status: unknown;
  try {
    const body = (await req.json()) as { status?: unknown };
    status = body.status;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "bad JSON" },
      { status: 400 },
    );
  }
  if (status !== "archived" && status !== "unarchive") {
    return NextResponse.json({ ok: false, error: "status must be archived or unarchive" }, { status: 400 });
  }
  const plan = await loadPlanForUser(supabase, id, user.id);
  if (!plan) {
    return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  }
  if (status === "unarchive") {
    if (plan.status !== "archived") {
      return NextResponse.json({ ok: false, error: "plan is not archived" }, { status: 400 });
    }
    const result = await unarchiveCampaignPlan(supabase, id, user.id);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, tableMissing: result.tableMissing, error: result.error },
        { status: result.tableMissing ? 503 : 400 },
      );
    }
    return NextResponse.json({ ok: true, action: "unarchive", status: result.status });
  }
  const result = await archiveCampaignPlan(supabase, id, user.id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, tableMissing: result.tableMissing, error: result.error },
      { status: result.tableMissing ? 503 : 400 },
    );
  }
  return NextResponse.json({ ok: true, action: "archive" });
}
