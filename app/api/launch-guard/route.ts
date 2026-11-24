import { NextRequest, NextResponse } from "next/server";

import { runLaunchGuard } from "@/lib/launch-guard/load";
import { createClient } from "@/lib/supabase/server";
import type { CampaignDraft } from "@/lib/types";

/**
 * POST { draft } → the pre-launch check for that draft as it stands in the
 * wizard (record RC3). Reads only, under the operator's session (RLS):
 * the event, the client's other shows of the last 12 months and their
 * artists. No Meta call. The launch route runs the same check again.
 * `viewer` is who "Keep this link" records.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  let draft: CampaignDraft;
  try {
    const body = (await req.json()) as { draft?: CampaignDraft };
    if (!body?.draft?.settings) throw new Error("Missing draft");
    draft = body.draft;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Bad request" },
      { status: 400 },
    );
  }
  try {
    const result = await runLaunchGuard(supabase, draft);
    return NextResponse.json({ ok: true, result, viewer: user.email ?? user.id });
  } catch (err) {
    console.error("[launch-guard] check failed:", err);
    return NextResponse.json({ ok: false, error: "The launch checks couldn't run." }, { status: 500 });
  }
}
