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
  editLabCaption,
} from "@/lib/creative-lab/card-write";
import { findArtistCandidates } from "@/lib/enrichment/artist-pipeline";
import { isSpotifyConfigured } from "@/lib/enrichment/spotify";
import { requestArtistClip } from "@/lib/creative-lab/ig-discovery";
import type { SaleStage } from "@/lib/creative-lab/caption-facts";
import { addSpotifyToLineup, labArtistForLibrary, saveLabLineup, tagSuggestions } from "@/lib/creative-lab/lineup";
import type { ServiceRoleDb } from "@/lib/creative-lab/load";
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
  slots?: { artistId: string; isHeadliner: boolean }[];
  query?: string;
  libraryArtistId?: string;
  spotify?: {
    name?: string;
    spotifyId?: string;
    imageUrl?: string | null;
    genres?: string[];
    instagramHandle?: string | null;
    tiktokHandle?: string | null;
    musicbrainzId?: string | null;
    profileJson?: Record<string, unknown>;
  };
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
  overlay?: string;
  primaryText?: string;
  pairs?: { clipId?: string; captionId?: string }[];
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
      case "suggest":
        return NextResponse.json(await suggestLineup(db, { userId: user.id, eventId, query: body.query ?? "" }));
      case "saveLineup":
        await saveLabLineup(db, { userId: user.id, eventId, slots: body.slots ?? [] });
        return NextResponse.json({ ok: true });
      case "addSpotify": {
        const pick = body.spotify;
        if (!pick?.name?.trim() || !pick.spotifyId?.trim()) {
          return NextResponse.json({ error: "Spotify did not return an artist." }, { status: 400 });
        }
        return NextResponse.json(await addSpotifyToLineup(db, {
          userId: user.id,
          eventId,
          pick: {
            name: pick.name,
            spotifyId: pick.spotifyId,
            imageUrl: pick.imageUrl ?? null,
            genres: pick.genres ?? [],
            instagramHandle: pick.instagramHandle ?? null,
            tiktokHandle: pick.tiktokHandle ?? null,
            musicbrainzId: pick.musicbrainzId ?? null,
            profileJson: pick.profileJson ?? { spotify: { id: pick.spotifyId, name: pick.name, genres: pick.genres ?? [] } },
          },
        }));
      }
      case "clearLibrary":
      case "saveLineupArtist":
        if (!event.client_id) return NextResponse.json({ error: "This event has no client." }, { status: 400 });
        try {
          const labId = await labArtistForLibrary(db, {
            userId: user.id,
            clientId: event.client_id,
            libraryArtistId: body.libraryArtistId ?? "",
            name: body.name ?? "",
          });
          if (body.action === "clearLibrary") {
            await setLabArtistCleared(db, { userId: user.id, artistId: labId, cleared: body.cleared === true });
            return NextResponse.json({ ok: true, artistId: labId });
          }
          return NextResponse.json(await saveLabArtist(db, {
            userId: user.id,
            clientId: event.client_id,
            eventId,
            artistId: labId,
            name: body.name ?? "",
            rightsDocRef: body.rightsDocRef ?? "",
            startingCaption: body.startingCaption ?? "",
            metaPageId: body.metaPageId,
            instagramActorId: body.instagramActorId,
            playedCities: body.playedCities ?? [],
            clipFolderUrl: body.clipFolderUrl,
            clipSource: body.clipSource,
            artistVoice: body.artistVoice === true,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (/artist_id/i.test(message)) {
            return NextResponse.json({ error: "The lineup link isn't available until the database update is applied." }, { status: 503 });
          }
          throw error;
        }
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
      case "editCaption": {
        const edited = await editLabCaption(db, {
          userId: user.id,
          eventId,
          captionId: body.captionId ?? "",
          text: body.overlay ?? "",
          primaryText: body.primaryText ?? "",
        });
        return NextResponse.json(edited);
      }
      case "propose": {
        const pairs = (body.pairs ?? [])
          .map((pair) => ({ clipId: pair.clipId ?? "", captionId: pair.captionId ?? "" }))
          .filter((pair) => pair.clipId && pair.captionId);
        if (pairs.length) {
          const clipRes = await db.from("creative_lab_clips").select("id, artist_id").eq("user_id", user.id);
          if (clipRes.error) throw new Error(clipRes.error.message);
          const artistOf = new Map((clipRes.data ?? []).map((row) => [String(row.id), String(row.artist_id)]));
          const byArtist = new Map<string, { clipId: string; captionId: string }[]>();
          for (const pair of pairs) {
            const artistId = artistOf.get(pair.clipId);
            if (!artistId) continue;
            const list = byArtist.get(artistId) ?? [];
            list.push(pair);
            byArtist.set(artistId, list);
          }
          let roundId: string | undefined;
          let refused: string | undefined;
          for (const [artistId, include] of byArtist) {
            const result = await proposeLabRound(db, {
              userId: user.id,
              eventId,
              artistId,
              adsetMetaId: body.adsetMetaId ?? "",
              include,
            });
            if (result.refused) refused = result.refused;
            else roundId = result.roundId;
          }
          if (!roundId) return NextResponse.json({ refused: refused ?? "Nothing left to propose." }, { status: 409 });
          return NextResponse.json({ roundId, refused });
        }
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

async function suggestLineup(db: ServiceRoleDb, args: { userId: string; eventId: string; query: string }) {
  const libraryRes = await db.from("artists").select("*").eq("user_id", args.userId) as { data: Record<string, unknown>[] | null; error: { message: string } | null };
  if (libraryRes.error) throw new Error(libraryRes.error.message);
  const rosterRes = await db.from("event_artists").select("*").eq("event_id", args.eventId) as { data: Record<string, unknown>[] | null; error: { message: string } | null };
  if (rosterRes.error) throw new Error(rosterRes.error.message);
  let spotifyError: string | null = null;
  const spotify: { spotifyId: string; name: string; imageUrl: string | null; genres: string[]; instagramHandle: string | null; tiktokHandle: string | null; musicbrainzId: string | null; profileJson: Record<string, unknown> }[] = [];
  if (args.query.trim() && isSpotifyConfigured()) {
    try {
      const found = await findArtistCandidates(args.query, { limit: 5 });
      for (const row of found) {
        if (!row.spotify_id) continue;
        spotify.push({
          spotifyId: row.spotify_id,
          name: row.name,
          imageUrl: row.profile_image_url,
          genres: row.genres,
          instagramHandle: row.instagram_handle,
          tiktokHandle: row.tiktok_handle,
          musicbrainzId: row.musicbrainz_id,
          profileJson: row.profile_jsonb,
        });
      }
    } catch {
      spotifyError = "Spotify isn't answering — try again later.";
    }
  }
  const library = (libraryRes.data ?? []).map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    spotifyId: row.spotify_id ? String(row.spotify_id) : null,
    imageUrl: row.profile_image_url ? String(row.profile_image_url) : null,
  }));
  return {
    ...tagSuggestions({
      query: args.query,
      library,
      spotify,
      onLineupIds: new Set((rosterRes.data ?? []).map((row) => String(row.artist_id ?? ""))),
    }),
    spotifyError,
  };
}
