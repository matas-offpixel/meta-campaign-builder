import { NextRequest, NextResponse } from "next/server";

import { isOperator } from "@/lib/auth/operator-allowlist";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  loadCampaignAutomationState,
  updateCampaignAutomationFlags,
} from "@/lib/db/campaign-automation";
import { parseAutomationFlagWrite } from "@/lib/optimisation/automation-ui";
import { optimisationWritesGateState } from "@/lib/optimisation/gates";

async function viewerDb() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, db: supabase, asOperator: false };
  const asOperator = isOperator(user.id);
  if (!asOperator) return { user, db: supabase, asOperator: false };
  try {
    return { user, db: createServiceRoleClient(), asOperator: true };
  } catch {
    return { user, db: supabase, asOperator: false };
  }
}

function gatePayload(
  state: {
    enabled: boolean;
    live: boolean;
    status: string;
    lastEvaluatedAt: string | null;
    decisions: unknown;
    materialisedPreset: unknown;
  },
) {
  const gate = optimisationWritesGateState();
  return {
    ok: true,
    enabled: state.enabled,
    live: state.live,
    status: state.status,
    lastEvaluatedAt: state.lastEvaluatedAt,
    decisions: state.decisions,
    materialisedPreset: state.materialisedPreset,
    writesEnabled: gate.writesEnabled,
    skippedReason: gate.skippedReason,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Draft id is required" }, { status: 400 });
  }

  const { user, db, asOperator } = await viewerDb();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  const state = await loadCampaignAutomationState(db, id, user.id, { asOperator });
  if (!state) {
    return NextResponse.json({ ok: false, error: "Draft not found" }, { status: 404 });
  }
  return NextResponse.json(gatePayload(state));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Draft id is required" }, { status: 400 });
  }

  const { user, db, asOperator } = await viewerDb();
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

  const updated = await updateCampaignAutomationFlags(
    db,
    id,
    user.id,
    { enabled: parsed.enabled, live: parsed.live },
    { asOperator },
  );
  if (!updated) {
    return NextResponse.json({ ok: false, error: "Draft not found" }, { status: 404 });
  }

  const state = await loadCampaignAutomationState(db, id, user.id, { asOperator });
  return NextResponse.json(
    gatePayload(
      state ?? {
        enabled: parsed.enabled,
        live: parsed.live,
        status: "draft",
        lastEvaluatedAt: null,
        decisions: [],
        materialisedPreset: null,
      },
    ),
  );
}
