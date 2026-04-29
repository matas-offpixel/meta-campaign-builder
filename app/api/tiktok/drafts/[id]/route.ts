import { NextResponse, type NextRequest } from "next/server";

import { getTikTokDraft, upsertTikTokDraft } from "@/lib/db/tiktok-drafts";
import { createClient } from "@/lib/supabase/server";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params;
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

  const current = await getTikTokDraft(supabase, id);
  if (!current) {
    return NextResponse.json(
      { ok: false, error: "Draft not found" },
      { status: 404 },
    );
  }

  const body = (await req.json().catch(() => null)) as Partial<
    TikTokCampaignDraft
  > | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Invalid draft payload" },
      { status: 400 },
    );
  }

  const nextDraft = mergeTikTokDraft(current, body);
  const saved = await upsertTikTokDraft(supabase, id, {
    ...nextDraft,
    userId: user.id,
  });
  return NextResponse.json({ ok: true, draft: saved }, { status: 200 });
}

function mergeTikTokDraft(
  current: TikTokCampaignDraft,
  patch: Partial<TikTokCampaignDraft>,
): TikTokCampaignDraft {
  return {
    ...current,
    ...patch,
    accountSetup: {
      ...current.accountSetup,
      ...(patch.accountSetup ?? {}),
    },
    campaignSetup: {
      ...current.campaignSetup,
      ...(patch.campaignSetup ?? {}),
    },
    optimisation: {
      ...current.optimisation,
      ...(patch.optimisation ?? {}),
    },
    audiences: {
      ...current.audiences,
      ...(patch.audiences ?? {}),
    },
    creatives: {
      ...current.creatives,
      ...(patch.creatives ?? {}),
    },
    budgetSchedule: {
      ...current.budgetSchedule,
      ...(patch.budgetSchedule ?? {}),
    },
    creativeAssignments: {
      ...current.creativeAssignments,
      ...(patch.creativeAssignments ?? {}),
    },
  };
}
