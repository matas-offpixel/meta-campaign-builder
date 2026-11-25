import { NextRequest, NextResponse } from "next/server";

import { readLiveIdentity } from "@/lib/launch-guard/live-identity";
import { loadGuardEvent, loadIdentityOwnership } from "@/lib/launch-guard/load";
import { agencyMetaToken } from "@/lib/meta/agency-token";
import { graphGetWithToken } from "@/lib/meta/client";
import { getUserFacebookToken } from "@/lib/meta/page-token";
import { createClient } from "@/lib/supabase/server";
import type { CampaignDraft } from "@/lib/types";

/**
 * POST { draft } → the live ads' page and Instagram (RC8, #1362), or
 * `live: null`. Graph GETs only, never a write: the campaign's ads, then
 * the ids' names. Review & launch calls it once per open
 * (createLiveIdentityReader); the comparison runs in /api/launch-guard on
 * the draft as it stands. A failed read is logged and returns `live: null`,
 * so nothing shows.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });

  let draft: CampaignDraft;
  try {
    const body = (await req.json()) as { draft?: CampaignDraft };
    if (!body?.draft?.settings) throw new Error("Missing draft");
    draft = body.draft;
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Bad request" }, { status: 400 });
  }

  const token = (await getUserFacebookToken(supabase, user.id)) ?? agencyMetaToken(user.id);
  if (!token) return NextResponse.json({ ok: true, live: null });

  try {
    const eventId = draft.settings.eventId?.trim();
    const event = eventId ? await loadGuardEvent(supabase, eventId) : null;
    const live = await readLiveIdentity(
      (path, params) => graphGetWithToken(path, params, token, { maxAttempts: 1 }),
      draft,
      async (pageIds, igIds) => (event ? loadIdentityOwnership(supabase, { event, pageIds, igIds, excludeDraftId: draft.id }) : null),
    );
    return NextResponse.json({ ok: true, live });
  } catch (err) {
    console.warn("[launch-guard/live-identity] read failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true, live: null });
  }
}
