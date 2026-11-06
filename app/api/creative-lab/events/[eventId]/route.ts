/**
 * Mutations for the Creative Lab card. The launch itself is
 * POST /api/creative-lab/rounds/[id]/launch.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  addLabClip,
  approveLabRound,
  generateLabCaptions,
  judgeLabCard,
  proposeLabRound,
  saveLabArtist,
  saveLabFacts,
  setLabArtistCleared,
  setLabCaptionStatus,
} from "@/lib/creative-lab/card-write";
import { requestArtistClip } from "@/lib/creative-lab/ig-discovery";
import type { SaleStage } from "@/lib/creative-lab/caption-facts";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

type Body = {
  action?: string;
  lineup?: string[];
  headliners?: string[];
  allowedDates?: string[];
  artistId?: string;
  name?: string;
  rightsDocRef?: string;
  startingCaption?: string;
  metaPageId?: string | null;
  instagramActorId?: string | null;
  playedCities?: string[];
  clipFolderUrl?: string | null;
  clipSource?: string | null;
  artistVoice?: boolean;
  source?: string;
  rightsRef?: string;
  permalinks?: string[];
  filmedEventId?: string | null;
  durationSeconds?: number | null;
  creativeAssetId?: string | null;
  newAsset?: { filename: string; storagePath: string; contentHash: string; byteSize: number; durationSeconds?: number | null };
  style?: string;
  n?: number;
  clipId?: string | null;
  stageOverride?: SaleStage | null;
  captionId?: string;
  status?: "approved" | "rejected";
  adsetMetaId?: string;
  roundId?: string;
  apply?: boolean;
  cleared?: boolean;
  igMediaId?: string;
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const { eventId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const db = createServiceRoleClient();
  const eventRes = await db.from("events").select("id, user_id, client_id").eq("id", eventId).eq("user_id", user.id).maybeSingle();
  if (eventRes.error) return NextResponse.json({ error: eventRes.error.message }, { status: 500 });
  const event = eventRes.data as { client_id: string | null } | null;
  if (!event) return NextResponse.json({ error: "No event with that id." }, { status: 404 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "saveFacts":
        await saveLabFacts(db, {
          userId: user.id,
          eventId,
          lineup: body.lineup ?? [],
          headliners: body.headliners ?? [],
          allowedDates: body.allowedDates ?? [],
        });
        return NextResponse.json({ ok: true });
      case "saveArtist":
        if (!event.client_id) return NextResponse.json({ error: "This event has no client." }, { status: 400 });
        return NextResponse.json(
          await saveLabArtist(db, {
            userId: user.id,
            clientId: event.client_id,
            eventId,
            artistId: body.artistId,
            name: body.name ?? "",
            rightsDocRef: body.rightsDocRef ?? "",
            startingCaption: body.startingCaption ?? "",
            metaPageId: body.metaPageId,
            instagramActorId: body.instagramActorId,
            playedCities: body.playedCities ?? [],
            clipFolderUrl: body.clipFolderUrl,
            clipSource: body.clipSource,
            artistVoice: body.artistVoice === true,
          }),
        );
      case "setCleared":
        await setLabArtistCleared(db, { userId: user.id, artistId: body.artistId ?? "", cleared: body.cleared === true });
        return NextResponse.json({ ok: true });
      case "requestIgCandidate":
        await requestArtistClip(db, { userId: user.id, artistId: body.artistId ?? "", igMediaId: body.igMediaId ?? "" });
        return NextResponse.json({ ok: true });
      case "addClip":
        await addLabClip(db, {
          userId: user.id,
          artistId: body.artistId ?? "",
          source: body.source ?? "",
          rightsRef: body.rightsRef ?? "",
          permalinks: body.permalinks,
          filmedEventId: body.filmedEventId,
          durationSeconds: body.durationSeconds,
          creativeAssetId: body.creativeAssetId,
          newAsset: body.newAsset,
        });
        return NextResponse.json({ ok: true });
      case "generate":
        return NextResponse.json({
          captions: await generateLabCaptions(db, {
            eventId,
            style: body.style ?? "",
            n: body.n ?? 1,
            clipId: body.clipId,
            stageOverride: body.stageOverride,
            artistId: body.artistId,
          }),
        });
      case "setCaptionStatus":
        if (body.status !== "approved" && body.status !== "rejected") {
          return NextResponse.json({ error: "Status must be approved or rejected." }, { status: 400 });
        }
        await setLabCaptionStatus(db, { userId: user.id, captionId: body.captionId ?? "", status: body.status });
        return NextResponse.json({ ok: true });
      case "propose": {
        const result = await proposeLabRound(db, {
          userId: user.id,
          eventId,
          artistId: body.artistId ?? "",
          adsetMetaId: body.adsetMetaId ?? "",
        });
        return NextResponse.json(result, { status: result.refused ? 409 : 200 });
      }
      case "approveRound":
        return NextResponse.json(await approveLabRound(db, { userId: user.id, roundId: body.roundId ?? "" }));
      case "judge":
        return NextResponse.json(await judgeLabCard(db, { userId: user.id, roundId: body.roundId ?? "", apply: body.apply === true }));
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Request failed" }, { status: 400 });
  }
}
