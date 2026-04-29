import { NextResponse, type NextRequest } from "next/server";

import { upsertTikTokDraft } from "@/lib/db/tiktok-drafts";
import { createClient } from "@/lib/supabase/server";
import { createDefaultTikTokDraft } from "@/lib/types/tiktok-draft";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    clientId?: string | null;
    eventId?: string | null;
  };
  const draftId = crypto.randomUUID();
  const draft = createDefaultTikTokDraft(draftId);
  draft.clientId = body.clientId ?? null;
  draft.eventId = body.eventId ?? null;

  if (draft.eventId) {
    const { data: event } = await supabase
      .from("events")
      .select("event_code")
      .eq("id", draft.eventId)
      .eq("user_id", user.id)
      .maybeSingle();
    draft.campaignSetup.eventCode =
      ((event as { event_code?: string | null } | null)?.event_code ?? null);
  }

  const saved = await upsertTikTokDraft(supabase, draftId, {
    ...draft,
    userId: user.id,
  });
  return NextResponse.json({ ok: true, draft: saved }, { status: 200 });
}
