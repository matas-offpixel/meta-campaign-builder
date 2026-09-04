import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  loadCampaignAutomationState,
  updateCampaignAutomationFlags,
} from "@/lib/db/campaign-automation";
import { parseAutomationFlagWrite } from "@/lib/optimisation/automation-ui";
import { optimisationWritesGateState } from "@/lib/optimisation/gates";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Draft id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  const state = await loadCampaignAutomationState(supabase, id, user.id);
  if (!state) {
    return NextResponse.json({ ok: false, error: "Draft not found" }, { status: 404 });
  }

  const gate = optimisationWritesGateState();
  return NextResponse.json({
    ok: true,
    enabled: state.enabled,
    live: state.live,
    status: state.status,
    lastEvaluatedAt: state.lastEvaluatedAt,
    decisions: state.decisions,
    materialisedPreset: state.materialisedPreset,
    writesEnabled: gate.writesEnabled,
    skippedReason: gate.skippedReason,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Draft id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseAutomationFlagWrite(body);
  if (!parsed.ok) {
    const status = parsed.code === "confirm_required" ? 409 : 400;
    return NextResponse.json(
      { ok: false, error: parsed.error, code: parsed.code },
      { status },
    );
  }

  const updated = await updateCampaignAutomationFlags(supabase, id, user.id, {
    enabled: parsed.enabled,
    live: parsed.live,
  });
  if (!updated) {
    return NextResponse.json({ ok: false, error: "Draft not found" }, { status: 404 });
  }

  const state = await loadCampaignAutomationState(supabase, id, user.id);
  const gate = optimisationWritesGateState();
  return NextResponse.json({
    ok: true,
    enabled: state?.enabled ?? parsed.enabled,
    live: state?.live ?? parsed.live,
    status: state?.status ?? "draft",
    lastEvaluatedAt: state?.lastEvaluatedAt ?? null,
    decisions: state?.decisions ?? [],
    materialisedPreset: state?.materialisedPreset ?? null,
    writesEnabled: gate.writesEnabled,
    skippedReason: gate.skippedReason,
  });
}
