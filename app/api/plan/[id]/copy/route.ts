import { NextRequest, NextResponse } from "next/server";

import { applyPlanCopy, suggestPlanCopy } from "@/lib/plan/copy-server";
import type { CopyAcross, CopySelection } from "@/lib/plan/copy-apply";
import { loadPlanLaunchRecords } from "@/lib/plan/load";
import { rowToCampaignPlanIntent } from "@/lib/plan/persist";
import type { CampaignPlan } from "@/lib/plan/types";
import type { CTAType } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";

async function loadOwnedPlan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  userId: string,
): Promise<CampaignPlan | null> {
  const { data, error } = await supabase.from("campaign_plans").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  const row = data as {
    id: string;
    user_id: string;
    name: string | null;
    status: CampaignPlan["status"];
    created_at: string;
    updated_at: string;
  } & Parameters<typeof rowToCampaignPlanIntent>[0];
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    intent: rowToCampaignPlanIntent(row),
    launches: await loadPlanLaunchRecords(supabase, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function selectionFrom(body: Record<string, unknown>): CopySelection {
  const raw = (body.selection ?? {}) as Record<string, unknown>;
  const cta = raw.cta;
  return {
    metaPrimary: strings(raw.metaPrimary),
    metaHeadline: typeof raw.metaHeadline === "string" ? raw.metaHeadline : "",
    metaDescription: typeof raw.metaDescription === "string" ? raw.metaDescription : "",
    tiktok: typeof raw.tiktok === "string" ? raw.tiktok : "",
    googleHeadlines: strings(raw.googleHeadlines),
    googleDescriptions: strings(raw.googleDescriptions),
    url: typeof raw.url === "string" ? raw.url : "",
    cta: (typeof cta === "string" ? cta : "book_now") as CTAType,
  };
}

function acrossFrom(body: Record<string, unknown>): CopyAcross {
  const raw = (body.across ?? {}) as Record<string, unknown>;
  const on = (key: keyof CopyAcross, fallback: boolean) => (typeof raw[key] === "boolean" ? raw[key] : fallback);
  return {
    caption: on("caption", true),
    url: on("url", false),
    cta: on("cta", false),
    headline: on("headline", true),
    description: on("description", true),
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  const plan = await loadOwnedPlan(supabase, id, user.id);
  if (!plan) return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Missing body" }, { status: 400 });
  if (body.action === "suggest") {
    const url = typeof body.url === "string" ? body.url : plan.intent.destinationUrl;
    const result = await suggestPlanCopy(supabase, plan, url);
    return NextResponse.json({ ok: true, ...result });
  }
  if (body.action === "apply") {
    const result = await applyPlanCopy(supabase, plan, {
      selection: selectionFrom(body),
      across: acrossFrom(body),
      pageText: typeof body.pageText === "string" ? body.pageText : "",
    });
    if (!result.ok) return NextResponse.json(result, { status: 500 });
    return NextResponse.json(result);
  }
  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
