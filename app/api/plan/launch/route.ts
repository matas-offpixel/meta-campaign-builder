import { NextRequest, NextResponse } from "next/server";

import { POST as metaLaunchPost } from "@/app/api/meta/launch-campaign/route";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { upsertTikTokDraft } from "@/lib/db/tiktok-drafts";
import { handleTikTokLaunch } from "@/lib/tiktok/write/launch";
import { planFanoutGateState } from "@/lib/plan/gate";
import { orchestratePlanLaunch, type PlanAdapterOutcome } from "@/lib/plan/orchestrator";
import type { CampaignPlan } from "@/lib/plan/types";
import type { CampaignDraft } from "@/lib/types";

export const maxDuration = 800;

function isCampaignPlan(value: unknown): value is CampaignPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as CampaignPlan;
  return (
    typeof plan.id === "string" &&
    typeof plan.userId === "string" &&
    !!plan.intent &&
    !!plan.launches
  );
}

function logOutgoing(adapter: string, payload: unknown): void {
  console.error(
    `[plan-fanout] outgoing ${adapter} payload`,
    JSON.stringify(payload),
  );
}

async function launchMeta(
  req: NextRequest,
  draft: CampaignDraft,
): Promise<PlanAdapterOutcome> {
  const launchReq = new NextRequest(new URL("/api/meta/launch-campaign", req.url), {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({
      draft,
      createPaused: true,
    }),
  });
  const res = await metaLaunchPost(launchReq);
  const json = (await res.json()) as { metaCampaignId?: string; error?: string };
  if (!res.ok) {
    return { ok: false, error: json.error ?? `Meta launch HTTP ${res.status}` };
  }
  return {
    ok: true,
    campaignId: json.metaCampaignId ?? null,
    draftId: draft.id,
  };
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const gate = planFanoutGateState();
  return NextResponse.json({
    ok: true,
    enabled: gate.enabled,
    skippedReason: gate.skippedReason,
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

  const gate = planFanoutGateState();
  if (!gate.enabled) {
    return NextResponse.json(
      { ok: true, skippedReason: gate.skippedReason, plan: null },
      { status: 200 },
    );
  }

  let plan: CampaignPlan;
  try {
    const body = (await req.json()) as { plan?: unknown };
    if (!isCampaignPlan(body.plan)) {
      return NextResponse.json({ ok: false, error: "Missing required field: plan" }, { status: 400 });
    }
    plan = body.plan;
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid request body: ${err instanceof Error ? err.message : "bad JSON"}` },
      { status: 400 },
    );
  }

  const result = await orchestratePlanLaunch({
    plan,
    logOutgoing,
    launchers: {
      meta: (draft) => launchMeta(req, draft),
      tiktok: async (draft) => {
        try {
          const saved = await upsertTikTokDraft(supabase, draft.id, {
            ...draft,
            userId: user.id,
          });
          const launched = await handleTikTokLaunch({
            userId: user.id,
            draftId: saved.id,
            session: supabase,
            admin: createServiceRoleClient(),
          });
          if (!launched.body.ok) {
            return { ok: false, draftId: saved.id, error: launched.body.error };
          }
          return {
            ok: true,
            draftId: saved.id,
            campaignId: launched.body.campaign_id,
          };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
      google: async () => ({
        ok: false,
        error:
          "google_search_push_not_wired_without_account — persist a google_search_plans tree and pass google_ads_account_id before fan-out can call pushGoogleSearchPlan",
      }),
    },
  });

  return NextResponse.json({
    ok: true,
    skippedReason: result.skippedReason,
    plan: result.plan,
  });
}
