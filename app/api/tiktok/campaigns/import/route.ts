import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { handleTikTokImport } from "@/lib/tiktok/import/save";

/**
 * POST /api/tiktok/campaigns/import
 *
 * Two steps. Without `carry`, read the live campaign and return the
 * picker — nothing is saved. `carry: []` also saves nothing. With
 * `carry: string[]` of `video_id` / `tiktok_item_id` keys, map those
 * creatives onto a draft and save. The carry path requires `eventId`
 * belonging to the resolved client — a saved draft that cannot launch
 * is the bug this route exists not to reintroduce. Writes nothing to
 * TikTok.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await handleTikTokImport({
    userId: user?.id ?? null,
    body,
    supabase,
  });
  return NextResponse.json(result.body, { status: result.status });
}
