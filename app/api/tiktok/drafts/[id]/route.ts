import { NextResponse, type NextRequest } from "next/server";

import { getTikTokDraft } from "@/lib/db/tiktok-drafts";
import { createClient } from "@/lib/supabase/server";
import { handleTikTokDraftPatch } from "@/lib/tiktok-wizard/patch-draft";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  const draft = await getTikTokDraft(supabase, id);
  if (!draft) {
    return NextResponse.json({ ok: false, error: "Draft not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, draft }, { status: 200 });
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const body = (await req.json().catch(() => null)) as Partial<
    TikTokCampaignDraft
  > | null;
  const result = await handleTikTokDraftPatch({
    userId: user?.id ?? null,
    draftId: id,
    body,
    supabase,
  });
  return NextResponse.json(result.body, { status: result.status });
}
