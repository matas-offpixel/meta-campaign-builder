/**
 * POST /api/internal-counts/reports/[id]/rerun — re-run a stored count
 * after an alias is confirmed. Written blocks stay as they are; blocks in
 * review are parsed again from the stored PDF and written if they now pass.
 */

import { NextResponse, type NextRequest } from "next/server";

import { rerunReport } from "@/lib/internal-counts/store";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  // RLS: an operator only sees their own reports.
  const { data: report } = await supabase.from("internal_count_reports").select("id").eq("id", id).maybeSingle();
  if (!report) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  const result = await rerunReport(createServiceRoleClient(), id);
  const url = new URL("/internal-counts", req.nextUrl.origin);
  url.searchParams.set("rerun", `${result.blocksWritten}:${result.blocksInReview}`);
  return NextResponse.redirect(url, 303);
}
