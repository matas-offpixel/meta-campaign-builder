import { NextRequest, NextResponse } from "next/server";

import { migrateDraft } from "@/lib/autosave";
import { isOperator } from "@/lib/auth/operator-allowlist";
import { applyPostLaunchControls, type PostLaunchControlsPatch } from "@/lib/optimisation/armed-read-model";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { BudgetGuardrails, CampaignDraft } from "@/lib/types";

function viewerDb(operator: boolean) {
  if (!operator) return null;
  try {
    return createServiceRoleClient();
  } catch {
    return null;
  }
}

export async function PATCH(
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

  const operator = isOperator(user.id);
  const db = viewerDb(operator) ?? supabase;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const raw = body as PostLaunchControlsPatch;
  if (raw.guardrails && "pauseFloorBudget" in raw.guardrails) {
    return NextResponse.json(
      { ok: false, error: "pauseFloorBudget is not settable from these surfaces" },
      { status: 400 },
    );
  }

  const { data, error: readError } = await db
    .from("campaign_drafts")
    .select("draft_json, updated_at, user_id")
    .eq("id", id)
    .maybeSingle();
  if (readError || !data) {
    return NextResponse.json({ ok: false, error: "Draft not found" }, { status: 404 });
  }
  const ownerId = (data as { user_id: string }).user_id;
  if (!operator && ownerId !== user.id) {
    return NextResponse.json({ ok: false, error: "Draft not found" }, { status: 404 });
  }

  let draft: CampaignDraft;
  try {
    draft = migrateDraft((data as { draft_json: Record<string, unknown> }).draft_json);
  } catch {
    return NextResponse.json({ ok: false, error: "Draft JSON is malformed" }, { status: 500 });
  }

  const stamp = (data as { updated_at?: string }).updated_at;
  const patch: PostLaunchControlsPatch = {
    campaignTargetValue:
      typeof raw.campaignTargetValue === "number" ? raw.campaignTargetValue : undefined,
    useOverride: typeof raw.useOverride === "boolean" ? raw.useOverride : undefined,
    regenerateFromTarget: raw.regenerateFromTarget === true,
    guardrails: raw.guardrails && typeof raw.guardrails === "object"
      ? (raw.guardrails as Partial<BudgetGuardrails>)
      : undefined,
  };

  let nextStrategy;
  try {
    nextStrategy = applyPostLaunchControls(draft.optimisationStrategy, patch);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Invalid controls" },
      { status: 400 },
    );
  }

  const next: CampaignDraft = {
    ...draft,
    optimisationStrategy: nextStrategy,
    updatedAt: new Date().toISOString(),
  };

  let update = db
    .from("campaign_drafts")
    .update({ draft_json: next, updated_at: next.updatedAt })
    .eq("id", id);
  if (stamp) update = update.eq("updated_at", stamp);
  if (!operator) update = update.eq("user_id", user.id);

  const { data: written, error } = await update.select("id");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!written?.length) {
    return NextResponse.json(
      { ok: false, error: "Draft changed while saving — retry" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, strategy: nextStrategy });
}
