import { NextResponse, type NextRequest } from "next/server";

import { loadPlanForUser } from "@/lib/plan/load";
import {
  mintPlanShareToken,
  revokePlanShareToken,
} from "@/lib/plan/share-tokens";
import { createClient } from "@/lib/supabase/server";

const PLAN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!PLAN_ID.test(id)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const plan = await loadPlanForUser(supabase, id, user.id);
  if (!plan) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const minted = await mintPlanShareToken(supabase, {
    planId: plan.id,
    userId: user.id,
  });
  if ("error" in minted) {
    return NextResponse.json({ ok: false, error: minted.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    token: minted.token,
    enabled: minted.enabled,
    can_edit: false,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!PLAN_ID.test(id)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const plan = await loadPlanForUser(supabase, id, user.id);
  if (!plan) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const revoked = await revokePlanShareToken(supabase, {
    planId: plan.id,
    userId: user.id,
  });
  if ("error" in revoked) {
    return NextResponse.json({ ok: false, error: revoked.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, enabled: false, can_edit: false });
}
