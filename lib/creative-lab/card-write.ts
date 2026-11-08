/**
 * Writes for the Creative Lab card. creative_lab_* rows, plus a
 * creative_assets registry row when a new clip file has no row yet
 * (the clip's foreign key). No Meta calls.
 */

import { recordStartingCaption, type StartingCaptionResult } from "./starting-caption.ts";
import { ClipIntakeError, importArtistClips, type ClipImportResult } from "./clip-intake.ts";
import { generateCaptions, type GenerateCaptionsDeps } from "./writer.ts";
import { judgeLabRound } from "./judge-round.ts";
import { approveRound } from "./launch.ts";
import { proposeRound, RoundBuildError } from "./propose.ts";
import { RoundRefusedError } from "./rounds.ts";
import type { ServiceRoleDb } from "./load.ts";
import { isCaptionStyle } from "./tags.ts";
import { clipsForEachNew, currentRenderError, NO_NEW_CLIPS, playableClipSeconds } from "./surface.ts";
import { headlinerError } from "../db/creative-lab.ts";
import { factsHash, loadEventFacts, saleStageFromStatus, validateCaption } from "./caption-facts.ts";
import { quoteInsert, validateQuote, type QuoteSource } from "./quote.ts";
import { quoteStyleVersion } from "../../src/remotion/caption-style/quote-profile.ts";
import type { SaleStage } from "./caption-facts.ts";

type Row = Record<string, unknown>;

function text(row: Row | null | undefined, key: string): string {
  return String(row?.[key] ?? "").trim();
}

function cityList(value: readonly string[] | null | undefined): string[] {
  return (value ?? []).map((city) => city.trim()).filter(Boolean);
}

export async function saveLabFacts(
  db: ServiceRoleDb,
  args: { userId: string; eventId: string; lineup: string[]; headliners: string[]; allowedDates: string[] },
): Promise<void> {
  const lineup = args.lineup.map((name) => name.trim()).filter(Boolean);
  const headliners = args.headliners.map((name) => name.trim()).filter(Boolean);
  const problem = headlinerError(lineup, headliners);
  if (problem) throw new Error(problem);
  const saved = await db.from("creative_lab_event_facts").upsert(
    {
      user_id: args.userId,
      event_id: args.eventId,
      lineup,
      headliners,
      allowed_dates: args.allowedDates.map((day) => day.slice(0, 10)).filter(Boolean),
    },
    { onConflict: "event_id" },
  );
  if (saved.error) throw new Error(saved.error.message);
}

export async function saveLabArtist(
  db: ServiceRoleDb,
  args: {
    userId: string;
    clientId: string;
    eventId?: string | null;
    artistId?: string | null;
    name: string;
    rightsDocRef: string;
    startingCaption: string;
    metaPageId?: string | null;
    instagramActorId?: string | null;
    playedCities?: readonly string[];
    clipFolderUrl?: string | null;
    clipSource?: string | null;
    artistVoice?: boolean;
  },
): Promise<{ id: string; startingCaption: StartingCaptionResult | null; clipImport: ClipImportResult | null; clipImportError: string | null }> {
  const name = args.name.trim();
  if (!name) throw new Error("An artist needs a name.");
  const metaPageId = args.metaPageId?.trim() || null;
  let instagramActorId = args.instagramActorId?.trim() || null;
  const playedCities = cityList(args.playedCities);
  let id = args.artistId?.trim() || "";
  let previousUrl = "";
  let previousSource = "file";
  if (id) {
    const existingRes = await db.from("creative_lab_artists").select("*").eq("id", id).eq("user_id", args.userId).maybeSingle();
    if (existingRes.error) throw new Error(existingRes.error.message);
    const existing = existingRes.data as Row | null;
    const previousPage = text(existing, "meta_page_id");
    const previousInstagram = text(existing, "instagram_actor_id");
    previousUrl = text(existing, "clip_folder_url");
    previousSource = text(existing, "clip_source") || "file";
    if (metaPageId === previousPage && !instagramActorId && previousInstagram) instagramActorId = previousInstagram;
  }
  const clipFolderUrl = args.clipFolderUrl === undefined ? previousUrl || null : args.clipFolderUrl?.trim() || null;
  const requestedSource = args.clipSource?.trim() ?? "";
  const clipSource = ["spark", "file", "instagram", "presskit"].includes(requestedSource)
    ? requestedSource
    : ["spark", "file", "instagram", "presskit"].includes(previousSource)
      ? previousSource
      : "file";
  const payload = {
    user_id: args.userId,
    client_id: args.clientId,
    name,
    rights_doc_ref: args.rightsDocRef.trim() || null,
    starting_caption: args.startingCaption.trim() || null,
    meta_page_id: metaPageId,
    instagram_actor_id: instagramActorId,
    played_cities: playedCities,
    clip_folder_url: clipFolderUrl,
    clip_source: clipSource,
  };
  if (id) {
    const updated = await db.from("creative_lab_artists").update(payload).eq("id", id).eq("user_id", args.userId);
    if (updated.error) throw new Error(updated.error.message);
  } else {
    const inserted = await db.from("creative_lab_artists").insert(payload).select("id").single();
    if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "artist insert failed");
    id = String((inserted.data as Row).id);
  }
  const startingCaption = args.eventId
    ? await recordStartingCaption(db, {
        userId: args.userId,
        eventId: args.eventId,
        artistName: name,
        text: args.startingCaption,
        metaPageId: args.metaPageId,
        artistVoice: args.artistVoice,
        playedCities,
      })
    : null;
  let clipImport: ClipImportResult | null = null;
  let clipImportError: string | null = null;
  if (clipFolderUrl && clipFolderUrl !== previousUrl) {
    try {
      clipImport = await importArtistClips(db, { artistId: id });
    } catch (err) {
      if (!(err instanceof ClipIntakeError)) throw err;
      clipImportError = err.message;
    }
  }
  return { id, startingCaption, clipImport, clipImportError };
}

export async function setLabArtistCleared(
  db: ServiceRoleDb,
  args: { userId: string; artistId: string; cleared: boolean; now?: Date },
): Promise<void> {
  const res = await db.from("creative_lab_artists").select("*").eq("id", args.artistId).eq("user_id", args.userId).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  if (!res.data) throw new Error("No artist with that id.");
  const patch = args.cleared
    ? { approved_by: args.userId, approved_at: (args.now ?? new Date()).toISOString() }
    : { approved_by: null, approved_at: null };
  const updated = await db.from("creative_lab_artists").update(patch).eq("id", args.artistId).eq("user_id", args.userId);
  if (updated.error) throw new Error(updated.error.message);
}

export async function approveLabArtist(db: ServiceRoleDb, args: { userId: string; artistId: string; now?: Date }): Promise<void> {
  await setLabArtistCleared(db, { ...args, cleared: true });
}

export async function addLabClip(
  db: ServiceRoleDb,
  args: {
    userId: string;
    artistId: string;
    source: string;
    rightsRef: string;
    permalinks?: string[] | null;
    filmedEventId?: string | null;
    durationSeconds?: number | null;
    creativeAssetId?: string | null;
    newAsset?: { filename: string; storagePath: string; contentHash: string; byteSize: number; durationSeconds?: number | null };
  },
): Promise<void> {
  if (!args.source.trim()) throw new Error("A clip needs a source.");
  let rightsRef = args.rightsRef.trim();
  if (!rightsRef && args.source.trim().toLowerCase() === "instagram") {
    const artist = await db.from("creative_lab_artists").select("rights_doc_ref").eq("id", args.artistId).maybeSingle();
    if (artist.error) throw new Error(artist.error.message);
    rightsRef = text(artist.data as Row | null, "rights_doc_ref");
  }
  if (!rightsRef) throw new Error("A clip needs a rights ref.");
  const seconds = args.durationSeconds ?? args.newAsset?.durationSeconds ?? null;
  if (seconds != null && seconds > 30) throw new Error("Clips over 30 seconds are refused.");
  let assetId = args.creativeAssetId?.trim() || "";
  if (!assetId && args.newAsset) {
    const existing = await db
      .from("creative_assets")
      .select("id")
      .eq("user_id", args.userId)
      .eq("content_hash", args.newAsset.contentHash)
      .eq("byte_size", args.newAsset.byteSize)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    assetId = text(existing.data as Row | null, "id");
    if (!assetId) {
      const inserted = await db
        .from("creative_assets")
        .insert({
          user_id: args.userId,
          content_hash: args.newAsset.contentHash,
          byte_size: args.newAsset.byteSize,
          filename: args.newAsset.filename,
          media_kind: "video",
          aspect_ratio: "9:16",
          duration_seconds: seconds,
          storage_bucket: "campaign-assets",
          storage_path: args.newAsset.storagePath,
        })
        .select("id")
        .single();
      if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "asset insert failed");
      assetId = String((inserted.data as Row).id);
    }
  }
  if (!assetId) throw new Error("Pick a video or upload one.");
  const clips = await db.from("creative_lab_clips").select("clip_no").eq("artist_id", args.artistId);
  if (clips.error) throw new Error(clips.error.message);
  const next = Math.max(0, ...((clips.data ?? []) as Row[]).map((row) => Number(row.clip_no) || 0)) + 1;
  const links = (args.permalinks ?? []).map((link) => link.trim()).filter(Boolean);
  const rows = (links.length ? links : [null]).map((permalink, index) => ({
    user_id: args.userId,
    artist_id: args.artistId,
    creative_asset_id: assetId,
    clip_no: next + index,
    source: args.source.trim(),
    rights_ref: rightsRef,
    permalink,
    event_id: args.filmedEventId || null,
    out_s: seconds,
  }));
  const inserted = await db.from("creative_lab_clips").insert(rows);
  if (inserted.error) throw new Error(inserted.error.message);
}

async function clipsAwaitingPreview(db: ServiceRoleDb, eventId: string): Promise<string[]> {
  const eventRes = await db.from("events").select("client_id").eq("id", eventId).maybeSingle();
  if (eventRes.error) throw new Error(eventRes.error.message);
  const clientId = text(eventRes.data as Row | null, "client_id");
  if (!clientId) return [];
  const artistsRes = await db.from("creative_lab_artists").select("id, name, approved_at").eq("client_id", clientId);
  if (artistsRes.error) throw new Error(artistsRes.error.message);
  const artists = (artistsRes.data ?? []) as Row[];
  const artistIds = artists.map((row) => text(row, "id")).filter(Boolean);
  if (artistIds.length === 0) return [];
  const clipsRes = await db.from("creative_lab_clips").select("id, artist_id, clip_no, in_s, out_s, creative_asset_id").in("artist_id", artistIds);
  if (clipsRes.error) throw new Error(clipsRes.error.message);
  const clipRows = (clipsRes.data ?? []) as Row[];
  if (clipRows.length === 0) return [];
  const assetIds = [...new Set(clipRows.map((row) => text(row, "creative_asset_id")).filter(Boolean))];
  const assetsRes = assetIds.length
    ? await db.from("creative_assets").select("id, duration_seconds").in("id", assetIds)
    : { data: [] as Row[], error: null };
  if (assetsRes.error) throw new Error(assetsRes.error.message);
  const assets = new Map(((assetsRes.data ?? []) as Row[]).map((row) => [text(row, "id"), row]));
  const clipIds = clipRows.map((row) => text(row, "id")).filter(Boolean);
  const rendersRes = await db.from("creative_lab_renders").select("clip_id, status, error, created_at").in("clip_id", clipIds);
  if (rendersRes.error) throw new Error(rendersRes.error.message);
  const renders = (rendersRes.data ?? []) as Row[];
  const roundsRes = await db.from("creative_lab_rounds").select("id, round_no").eq("event_id", eventId);
  if (roundsRes.error) throw new Error(roundsRes.error.message);
  const rounds = (roundsRes.data ?? []) as Row[];
  const roundIds = rounds.map((row) => text(row, "id")).filter(Boolean);
  const adsRes = roundIds.length
    ? await db.from("creative_lab_round_ads").select("clip_id, round_id, verdict, verdict_results, verdict_cost_per_result, window_start").in("round_id", roundIds)
    : { data: [] as Row[], error: null };
  if (adsRes.error) throw new Error(adsRes.error.message);
  const ads = (adsRes.data ?? []) as Row[];
  const paired = new Set<string>();
  const capRes = await db.from("creative_lab_captions").select("clip_id, status").eq("event_id", eventId);
  if (capRes.error) {
    if (!/clip_id|does not exist|schema cache/i.test(capRes.error.message)) throw new Error(capRes.error.message);
  } else {
    for (const row of (capRes.data ?? []) as Row[]) {
      const id = text(row, "clip_id");
      if (id && text(row, "status") !== "rejected") paired.add(id);
    }
  }
  const clips = clipRows.map((row) => {
    const artist = artists.find((item) => text(item, "id") === text(row, "artist_id"));
    const asset = assets.get(text(row, "creative_asset_id"));
    const fileSeconds = asset?.duration_seconds == null || asset.duration_seconds === "" ? null : Number(asset.duration_seconds);
    const inS = row.in_s == null || row.in_s === "" ? null : Number(row.in_s);
    const outS = row.out_s == null || row.out_s === "" ? null : Number(row.out_s);
    const clipRenders = renders.filter((render) => text(render, "clip_id") === text(row, "id"));
    const judgedAds = ads
      .filter((ad) => text(ad, "clip_id") === text(row, "id"))
      .filter((ad) => text(ad, "verdict") || text(ad, "window_start") || ad.verdict_results != null || ad.verdict_cost_per_result != null)
      .sort((a, b) => Number(rounds.find((round) => text(round, "id") === text(b, "round_id"))?.round_no) - Number(rounds.find((round) => text(round, "id") === text(a, "round_id"))?.round_no));
    const judged = judgedAds[0];
    return {
      id: text(row, "id"),
      artistName: text(artist, "name") || "Clip",
      clipNo: Number(row.clip_no) || 0,
      cleared: Boolean(artist?.approved_at),
      renderError: currentRenderError(clipRenders.map((render) => ({
        status: text(render, "status"),
        error: text(render, "error") || null,
        createdAt: String(render.created_at ?? ""),
      }))),
      durationSeconds: playableClipSeconds({
        fileSeconds: fileSeconds != null && Number.isFinite(fileSeconds) ? fileSeconds : null,
        inS: inS != null && Number.isFinite(inS) ? inS : null,
        outS: outS != null && Number.isFinite(outS) ? outS : null,
      }),
      judged: judged ? { verdict: text(judged, "verdict") || null, cost: null, results: null, metric: null, roundNo: 0 } : null,
    };
  });
  return clipsForEachNew(clips, paired).map((clip) => clip.id);
}

export async function generateLabCaptions(
  db: ServiceRoleDb,
  args: { eventId: string; style: string; n: number; clipId?: string | null; stageOverride?: SaleStage | null; artistId?: string | null; each?: boolean },
  deps?: GenerateCaptionsDeps,
): Promise<{ captions: Awaited<ReturnType<typeof generateCaptions>>; notice: string | null }> {
  if (!isCaptionStyle(args.style)) throw new Error("Unknown caption style.");
  if (args.each) {
    const targets = await clipsAwaitingPreview(db, args.eventId);
    if (targets.length === 0) return { captions: [], notice: NO_NEW_CLIPS };
    const captions = [];
    for (const clipId of targets) {
      captions.push(...await generateCaptions(db, {
        eventId: args.eventId,
        style: args.style,
        n: 1,
        clipId,
        stageOverride: args.stageOverride || undefined,
        artistId: args.artistId || undefined,
      }, deps));
    }
    return { captions, notice: null };
  }
  return {
    captions: await generateCaptions(db, {
      eventId: args.eventId,
      style: args.style,
      n: args.n,
      clipId: args.clipId || undefined,
      stageOverride: args.stageOverride || undefined,
      artistId: args.artistId || undefined,
    }, deps),
    notice: null,
  };
}

export async function editLabCaption(
  db: ServiceRoleDb,
  args: { userId: string; eventId: string; captionId: string; text: string; primaryText: string },
): Promise<{ ok: boolean; sentence: string | null }> {
  const rowRes = await db.from("creative_lab_captions").select("*").eq("id", args.captionId).eq("user_id", args.userId).maybeSingle();
  if (rowRes.error) throw new Error(rowRes.error.message);
  const row = rowRes.data as Row | null;
  const style = text(row, "style");
  if (row && (text(row, "mode") === "quote" || style === "quote")) {
    if (args.text.trim() !== text(row, "text")) {
      return { ok: false, sentence: "The Lab doesn't rewrite a quote." };
    }
    const updated = await db
      .from("creative_lab_captions")
      .update({ primary_text: args.primaryText.trim() })
      .eq("id", args.captionId)
      .eq("user_id", args.userId);
    if (updated.error) throw new Error(updated.error.message);
    return { ok: true, sentence: null };
  }
  if (!row || !isCaptionStyle(style)) throw new Error("No caption with that id.");
  const eventRes = await db.from("events").select("status").eq("id", args.eventId).maybeSingle();
  if (eventRes.error) throw new Error(eventRes.error.message);
  const facts = await loadEventFacts(db, args.eventId);
  const check = validateCaption(args.text, style, (row.declared_names as string[] | undefined) ?? [], facts, { version: text(row, "style_version") }, {
    primaryText: args.primaryText,
    saleStage: saleStageFromStatus(text(eventRes.data as Row | null, "status")),
  });
  const updated = await db
    .from("creative_lab_captions")
    .update({
      text: args.text.trim(),
      lines: check.lines,
      primary_text: args.primaryText.trim(),
      facts_hash: check.factsHash,
      size_variant: check.sizeVariant,
    })
    .eq("id", args.captionId)
    .eq("user_id", args.userId);
  if (updated.error) throw new Error(updated.error.message);
  return { ok: check.ok, sentence: check.ok ? null : check.errors[0]?.detail ?? "This caption did not pass." };
}

export async function setLabCaptionStatus(
  db: ServiceRoleDb,
  args: { userId: string; captionId: string; status: "approved" | "rejected" },
): Promise<void> {
  const updated = await db
    .from("creative_lab_captions")
    .update({ status: args.status })
    .eq("id", args.captionId)
    .eq("user_id", args.userId)
    .eq("status", "proposed");
  if (updated.error) throw new Error(updated.error.message);
}

export async function proposeLabRound(
  db: ServiceRoleDb,
  args: {
    userId: string;
    eventId: string;
    artistId: string;
    adsetMetaId: string;
    include?: readonly { clipId: string; captionId: string }[];
  },
): Promise<{ refused?: string; roundId?: string }> {
  try {
    const result = await proposeRound(db, args);
    return { roundId: result.roundId };
  } catch (err) {
    if (err instanceof RoundRefusedError || err instanceof RoundBuildError) return { refused: err.message };
    throw err;
  }
}

export async function approveLabRound(db: ServiceRoleDb, args: { userId: string; roundId: string }) {
  return approveRound(db, args);
}

export async function judgeLabCard(db: ServiceRoleDb, args: { userId: string; roundId: string; apply: boolean }) {
  return judgeLabRound(db, args);
}

export async function storeLabQuote(
  db: ServiceRoleDb,
  args: {
    userId: string;
    eventId: string;
    artistId: string;
    words: string;
    source: QuoteSource;
    sourceText?: string | null;
    sourceRef?: string | null;
    sourceNote?: string | null;
    weight?: 400 | 700;
    primaryText?: string;
  },
): Promise<{ ok: boolean; sentence: string | null }> {
  const built = quoteInsert({
    words: args.words,
    source: args.source,
    sourceText: args.sourceText,
    sourceRef: args.sourceRef,
    sourceNote: args.sourceNote,
    weight: args.weight,
    artistId: args.artistId,
    primaryText: args.primaryText,
  });
  if (!built.ok) return { ok: false, sentence: built.sentence };
  const facts = await loadEventFacts(db, args.eventId);
  const check = validateQuote(built.row.text, facts);
  const existing = await db.from("creative_lab_captions").select("caption_no").eq("event_id", args.eventId).eq("style", "quote");
  if (existing.error) throw new Error(existing.error.message);
  const next = Math.max(0, ...((existing.data ?? []) as Row[]).map((row) => Number(row.caption_no) || 0)) + 1;
  const inserted = await db.from("creative_lab_captions").insert({
    user_id: args.userId,
    event_id: args.eventId,
    caption_no: next,
    facts_hash: factsHash(facts),
    style_version: await quoteStyleVersion(),
    ...built.row,
  }).select("id").single();
  if (inserted.error) throw new Error(inserted.error.message);
  return { ok: check.ok, sentence: check.sentence };
}
