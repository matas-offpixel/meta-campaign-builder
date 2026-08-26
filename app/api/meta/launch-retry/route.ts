import { NextRequest, NextResponse } from "next/server";

import { listFailedMetaWrites } from "@/lib/meta/write-idempotency";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/meta/launch-retry?draftId=
 *
 * Failed ad / ad-set rows on the Meta write ledger for this draft.
 * The retry surface is shown only when this list is non-empty.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const draftId = req.nextUrl.searchParams.get("draftId")?.trim() ?? "";
  if (!draftId) {
    return NextResponse.json({ error: "draftId is required" }, { status: 400 });
  }

  const { data: draft, error } = await supabase
    .from("campaign_drafts")
    .select("id")
    .eq("id", draftId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  let service;
  try {
    service = createServiceRoleClient();
  } catch {
    return NextResponse.json({ failed: [], failedAdCreates: 0, failedAdSetCreates: 0 });
  }

  const failed = await listFailedMetaWrites({
    supabase: service,
    draftId,
  });
  return NextResponse.json({
    failed,
    failedAdCreates: failed.filter((row) => row.op_kind === "ad_create").length,
    failedAdSetCreates: failed.filter((row) => row.op_kind === "adset_create").length,
  });
}
