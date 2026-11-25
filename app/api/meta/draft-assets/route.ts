/**
 * POST /api/meta/draft-assets — standalone Launch's first step (M3a).
 *
 * Body `{ draft }`. Every slot whose file is already in Storage (attached
 * from Drive or through the connector, lib/creatives/stored-at-launch.ts)
 * goes to the draft's ad account through the MML path the canvas's Send
 * uses (sendStoredDraftAssetsToMeta: creative_asset_channel_ids first, then
 * handleUploadAsset on a service-role copy of the registry object). Only the
 * caller's own registry rows are read (loadAssetsByIds filters on user_id),
 * so a slot naming someone else's file sends nothing.
 *
 * Answers `{ results, failed, calls, videoIds }`: each slot's outcome, which
 * the wizard lays onto the draft it holds and saves. Nothing is launched here.
 *
 * Body `{ action: "wait_videos", videoIds }`: FC4's second step, "Waiting for
 * Meta to finish {n} videos…": each video's status is read until ready
 * (waitForStoredVideosAs, the operator's own token, GETs only). Answers
 * `{ ready, errored, timedOut }`; the wizard fails the errored ones.
 */
import { NextRequest, NextResponse } from "next/server";
import { isOperator } from "@/lib/auth/operator-allowlist";
import { sendStoredDraftAssetsToMeta, waitForStoredVideosAs } from "@/lib/plan/creative-intake-server";
import { sentVideoIds } from "@/lib/plan/stored-assets-meta";
import { createClient } from "@/lib/supabase/server";
import type { CampaignDraft } from "@/lib/types";

// Each upload may wait for a video to be ready (file_url mode), as /api/meta/upload-asset does.
export const maxDuration = 800;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!isOperator(user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let draft: CampaignDraft;
  let waitIds: string[] | null = null;
  try {
    const body = (await req.json()) as { draft?: CampaignDraft; action?: string; videoIds?: unknown };
    if (body?.action === "wait_videos") {
      waitIds = Array.isArray(body.videoIds) ? [...new Set(body.videoIds.filter((v): v is string => typeof v === "string" && /^\d{5,30}$/.test(v)))].slice(0, 100) : [];
    } else if (!body?.draft || !Array.isArray(body.draft.creatives)) {
      throw new Error("Missing required field: draft");
    }
    draft = body.draft as CampaignDraft;
  } catch (err) {
    return NextResponse.json({ error: `Invalid request body: ${err instanceof Error ? err.message : "bad JSON"}` }, { status: 400 });
  }
  if (waitIds) return NextResponse.json(await waitForStoredVideosAs({ supabase, userId: user.id, videoIds: waitIds }));

  const out = await sendStoredDraftAssetsToMeta({ supabase, draft, userId: user.id });
  return NextResponse.json({
    results: out.results,
    failed: out.failed.map((f) => ({ assetId: f.assetId, creativeId: f.creativeId, error: f.error })),
    calls: out.calls,
    videoIds: out.failed.length === 0 ? sentVideoIds(out) : [],
  });
}
