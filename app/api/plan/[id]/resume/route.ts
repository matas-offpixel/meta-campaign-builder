import { NextRequest, NextResponse } from "next/server";

import { graphGetWithToken, graphPostWithToken } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { planFanoutGateState } from "@/lib/plan/gate";
import { loadPlanForUser } from "@/lib/plan/load";
import { resumePlanAdapter, type ResumeTreeGraph, type ResumeTreeNode } from "@/lib/plan/resume";
import { createClient } from "@/lib/supabase/server";
import type { PlanAdapterName } from "@/lib/plan/types";

function isAdapter(value: unknown): value is PlanAdapterName {
  return value === "meta" || value === "tiktok" || value === "google";
}

async function listStatusNodes(path: string, token: string): Promise<ResumeTreeNode[]> {
  const out: ResumeTreeNode[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const query: Record<string, string> = { fields: "id,status", limit: "100" };
    if (after) query.after = after;
    const json = await graphGetWithToken<{
      data?: Array<{ id?: string; status?: string }>;
      paging?: { cursors?: { after?: string }; next?: string };
    }>(path, query, token);
    for (const row of json.data ?? []) {
      if (row.id) out.push({ id: row.id, status: row.status ?? "" });
    }
    after = json.paging?.cursors?.after;
    if (!json.paging?.next || !after) break;
  }
  return out;
}

function metaResumeGraph(token: string): ResumeTreeGraph {
  return {
    getCampaign: async (campaignId) => {
      const row = await graphGetWithToken<{ id?: string; status?: string }>(
        `/${campaignId}`,
        { fields: "id,status" },
        token,
      );
      return { id: row.id ?? campaignId, status: row.status ?? "" };
    },
    listAdSets: (campaignId) => listStatusNodes(`/${campaignId}/adsets`, token),
    listAds: (adSetId) => listStatusNodes(`/${adSetId}/ads`, token),
    activate: async (id) => {
      await graphPostWithToken(`/${id}`, { status: "ACTIVE" }, token);
    },
  };
}

/**
 * `▷ resume` for one channel. Behind `ENABLE_PLAN_FANOUT` because it is a
 * platform write; Meta-only because Meta is the only platform this app
 * has a status-write path for. Walks campaign → ad sets → ads.
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
  let graph: ResumeTreeGraph | undefined;
  if (gate.enabled && adapter === "meta") {
    try {
      const token = (await resolveServerMetaToken(supabase, user.id)).token;
      graph = metaResumeGraph(token);
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
    graph,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { ok: false, error: outcome.error, skippedReason: outcome.skippedReason ?? null },
      { status: outcome.skippedReason ? 200 : 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    campaignId: outcome.campaignId,
    word: outcome.word,
  });
}
