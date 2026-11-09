import { NextResponse, type NextRequest } from "next/server";

import { addLabRender, listLabSource } from "@/lib/plan/from-lab-server";
import { loadPlanLaunchRecords } from "@/lib/plan/load";
import { rowToCampaignPlanIntent } from "@/lib/plan/persist";
import type { CampaignPlan } from "@/lib/plan/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function planOf(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 }) };
  const { data, error } = await supabase.from("campaign_plans").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error || !data) return { error: NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 }) };
  const row = data as { id: string; user_id: string; name: string | null; status: CampaignPlan["status"]; created_at: string; updated_at: string } & Parameters<typeof rowToCampaignPlanIntent>[0];
  const plan: CampaignPlan = {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    intent: rowToCampaignPlanIntent(row),
    launches: await loadPlanLaunchRecords(supabase, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return { supabase, plan };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const who = await planOf(id);
  if ("error" in who && who.error) return who.error;
  const listed = await listLabSource(who.supabase, who.plan);
  if (!listed.ok) return NextResponse.json(listed, { status: 500 });
  return NextResponse.json(listed);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const who = await planOf(id);
  if ("error" in who && who.error) return who.error;
  let body: { renderId?: string };
  try {
    body = (await req.json()) as { renderId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }
  if (!body.renderId) return NextResponse.json({ ok: false, error: "No render with that id." }, { status: 400 });
  const added = await addLabRender(who.supabase, who.plan, body.renderId);
  if (!added.ok) return NextResponse.json(added, { status: 400 });
  return NextResponse.json(added);
}
