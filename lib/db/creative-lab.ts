/**
 * Creative Lab card on the event page. Reads only. Writes go through
 * lib/creative-lab/card-write.ts.
 */

import { profile } from "../../src/remotion/caption-style/profile.ts";
import { validateCaption, type EventFacts } from "../creative-lab/caption-facts.ts";
import { labLaunchesEnabled } from "../creative-lab/killswitch.ts";
import type { ServiceRoleDb } from "../creative-lab/load.ts";
import { artistKey, playedBefore, spotifyCandidatesOf } from "../creative-lab/lineup.ts";
import { clipWindow, currentRenderError, renderRoundOpen } from "../creative-lab/surface.ts";
import { daysUntilEvent, nextPayday } from "../creative-lab/payday.ts";
import { failedCheckSentence, whatsWorking, type WorkingAd } from "../creative-lab/surface.ts";
import { quoteLines, validateQuote } from "../creative-lab/quote.ts";
import { isCaptionStyle } from "../creative-lab/tags.ts";
import { loadCardVoice, type CardVoice } from "../creative-lab/voice-store.ts";
import { loadClipSelection } from "../creative-lab/selection-store.ts";

type Row = Record<string, unknown>;

function pronounOn(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const row = profile as { pronouns?: unknown; pronoun?: unknown };
  if (typeof row.pronouns === "string" && row.pronouns.trim()) return row.pronouns.trim();
  if (typeof row.pronoun === "string" && row.pronoun.trim()) return row.pronoun.trim();
  return null;
}

function publicThumbUrl(path: string): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/creative-thumbnails/${path}`;
}

function overlayOf(value: unknown): { verdict: string; frames: { t: number; text: boolean; what: string }[]; reason: string; flagged: number } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { verdict?: unknown; frames?: unknown; reason?: unknown; flagged?: unknown };
  if (typeof row.verdict !== "string") return null;
  const frames = Array.isArray(row.frames)
    ? row.frames.map((frame) => {
        const item = frame as { t?: unknown; text?: unknown; what?: unknown };
        return { t: Number(item.t) || 0, text: item.text === true, what: String(item.what ?? "") };
      })
    : [];
  return {
    verdict: row.verdict,
    frames,
    reason: String(row.reason ?? ""),
    flagged: Number(row.flagged) || frames.filter((frame) => frame.text).length,
  };
}

export type LabLineupRow = {
  artistId: string;
  name: string;
  isHeadliner: boolean;
  imageUrl: string | null;
  instagramHandle: string | null;
  tiktokHandle: string | null;
  spotifyId: string | null;
  metaPageId: string | null;
  genres: string[];
  enrichedAt: string | null;
  playedBefore: string[];
  labArtistId: string | null;
  clearedAt: string | null;
  clearedBy: string | null;
  rightsNote: string | null;
  clipCount: number;
  spotifyCandidates: { spotifyId: string; name: string; imageUrl: string | null; genres: string[] }[];
};

async function rows(db: ServiceRoleDb, table: string, column: string, value: string): Promise<Row[]> {
  const res = await db.from(table).select("*").eq(column, value);
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data ?? []) as Row[];
}

async function rowsIfPresent(db: ServiceRoleDb, table: string, column: string, value: string): Promise<Row[]> {
  const res = await db.from(table).select("*").eq(column, value);
  const error = res.error as { message?: string; code?: string } | null;
  if (!error) return (res.data ?? []) as Row[];
  if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "")) return [];
  throw new Error(`${table}: ${error.message}`);
}

function text(row: Row | null | undefined, key: string): string {
  return String(row?.[key] ?? "").trim();
}

export type RightsState = "missing" | "recorded" | "approved";

export function rightsState(artist: { rights_doc_ref?: string | null; approved_at?: string | null }): RightsState {
  if (artist.approved_at) return "approved";
  if (artist.rights_doc_ref?.trim()) return "recorded";
  return "missing";
}

export function rightsLabel(artist: { rights_doc_ref?: string | null; approved_at?: string | null }): string {
  return artist.approved_at ? "Cleared — artist channels too" : "Promoter page only";
}

/** Headliners stay in the order given, and every name is on the lineup. */
export function headlinerError(lineup: readonly string[], headliners: readonly string[]): string | null {
  for (const name of headliners) {
    if (!lineup.includes(name)) return `${name} is not on the lineup`;
  }
  return null;
}

export type CreativeLabCardData = {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  venueName: string | null;
  eventStatus: string | null;
  clientName: string | null;
  clientId: string | null;
  voice: CardVoice | null;
  launchesEnabled: boolean;
  saleDatesMissing: boolean;
  longApproved: boolean;
  paydayLabel: string;
  daysToEvent: number | null;
  /** When the card was read (ISO). Ages on screen count from this, never the browser clock. */
  now: string;
  facts: { lineup: string[]; headliners: string[]; allowedDates: string[] } | null;
  artists: {
    id: string;
    name: string;
    rightsDocRef: string | null;
    startingCaption: string | null;
    metaPageId: string | null;
    instagramActorId: string | null;
    playedCities: string[];
    clipFolderUrl: string | null;
    clipSource: string;
    clipFolderLastError: string | null;
    igLastError: string | null;
    igUsername: string | null;
    /** From the library artist's profile when a pronoun is stored there. */
    pronouns: string | null;
    igCandidates: {
      id: string;
      igMediaId: string;
      permalink: string | null;
      postedAt: string | null;
      likes: number | null;
      comments: number | null;
      score: number | null;
      aspect: string | null;
      hasFile: boolean;
      audioMatch: boolean | null;
      status: string;
      reason: string | null;
      thumbnailUrl: string | null;
      lengthSeconds: number | null;
      overlayOpen: boolean;
      overlay: { verdict: string; frames: { t: number; text: boolean; what: string }[]; reason: string; flagged: number } | null;
      caption?: string | null;
    }[];
    rights: RightsState;
    rightsLabel: string;
    approvedAt?: string | null;
  }[];
  clips: {
    id: string;
    artistId: string;
    clipNo: number;
    source: string;
    rightsRef: string;
    filmedEventId: string | null;
    durationSeconds: number | null;
    inS: number;
    outS: number | null;
    sourceWidth: number | null;
    sourceHeight: number | null;
    billingOrder: number;
    isHeadliner: boolean;
    thumbnailUrl: string | null;
    storagePath: string | null;
    previewUrl: string | null;
    hasFile: boolean;
    artistName: string;
    cleared: boolean;
    renderError: string | null;
    judged: { verdict: string | null; cost: number | null; results: number | null; metric: string | null; roundNo: number } | null;
    audioMatch: boolean | null;
    /** False only when the clip row already records that the file has no audio. */
    hasAudio?: boolean | null;
    cropFocusX: number;
    cropOpen: boolean;
  }[];
  renders: {
    id: string;
    clipId: string;
    captionId: string;
    label: string;
    status: string;
    error: string | null;
    renderMs: number | null;
    updatedAt: string;
    previewUrl: string | null;
    posterUrl: string | null;
    clipPreviewUrl: string | null;
    lines: string[];
    playing: boolean;
    /** Every round holding this render is still draft or rendering (or it is in none), so a failed render can be tried again from its row. */
    roundOpen: boolean;
  }[];
  assets: { id: string; filename: string; durationSeconds: number | null; thumbnailUrl: string | null }[];
  clientEvents: { id: string; name: string; eventDate: string | null }[];
  captions: {
    id: string;
    style: string;
    status: string;
    lines: string[];
    primaryText: string;
    sizeVariant: string;
    validatorOk: boolean;
    validatorDetail: string;
    awaitingLong: boolean;
    clipId?: string | null;
    mode?: "caption" | "quote";
    quoteSource?: "press_kit" | "post" | "typed" | null;
    quoteSourceRef?: string | null;
    quoteSourceNote?: string | null;
    quoteWeight?: 400 | 700 | null;
    artistId?: string | null;
  }[];
  adSets: { metaAdSetId: string; adAccountId: string; name: string; status: string; adCount: number; cap: 50 }[];
  adAccountId: string | null;
  rounds: {
    id: string;
    roundNo: number;
    artistId: string;
    artistName: string;
    status: string;
    artistApproved: boolean;
    rendersPending: boolean;
    ads: { id: string; adName: string; role: string; launchState: string; thumbnailUrl: string | null; metaAdId: string | null; adsManagerUrl: string | null; clipId: string; captionId: string; verdict: string | null; cost: number | null; results: number | null; metric: string | null }[];
  }[];
  lineupRows: LabLineupRow[];
  working: { angle: string | null; clip: string | null } | null;
  /** Absent on a card read before migration 217: every usable clip is selected. */
  clipSelection?: { mode: "all" | "chosen"; rows: { clipId: string; selected: boolean }[] };
};

export async function loadCreativeLabCard(
  db: ServiceRoleDb,
  args: {
    eventId: string;
    userId: string;
    clientId: string | null;
    eventName: string;
    eventDate: string | null;
    venueName: string | null;
    venueCity: string | null;
    eventStatus: string | null;
    presaleAt?: string | null;
    generalSaleAt?: string | null;
    operatorId?: string | null;
    operatorName?: string | null;
    now?: Date;
  },
): Promise<CreativeLabCardData> {
  const [factRows, artists, captions, rounds, adSets, launchedAds, assets, clientEvents, libraryArtists, roster, memberships, clientAccount, eventAccount] = await Promise.all([
    rows(db, "creative_lab_event_facts", "event_id", args.eventId),
    args.clientId ? rows(db, "creative_lab_artists", "client_id", args.clientId) : Promise.resolve([]),
    rows(db, "creative_lab_captions", "event_id", args.eventId),
    rows(db, "creative_lab_rounds", "event_id", args.eventId),
    rows(db, "launched_ad_sets", "event_id", args.eventId),
    rows(db, "launched_ads", "event_id", args.eventId),
    rows(db, "creative_assets", "user_id", args.userId),
    args.clientId ? rows(db, "events", "client_id", args.clientId) : Promise.resolve([]),
    rows(db, "artists", "user_id", args.userId),
    rows(db, "event_artists", "event_id", args.eventId),
    rows(db, "event_artists", "user_id", args.userId),
    args.clientId
      ? db.from("clients").select("meta_ad_account_id, name, instagram_handle").eq("id", args.clientId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("events").select("meta_ad_account_id").eq("id", args.eventId).maybeSingle(),
  ]);
  if (clientAccount.error) throw new Error(`clients: ${clientAccount.error.message}`);
  if (eventAccount.error) throw new Error(`events: ${eventAccount.error.message}`);
  const adAccountId = text(clientAccount.data as Row | null, "meta_ad_account_id") || text(eventAccount.data as Row | null, "meta_ad_account_id") || null;
  const clientName = text(clientAccount.data as Row | null, "name") || null;
  const artistIds = new Set(artists.map((row) => text(row, "id")));
  const clipRows = (await rows(db, "creative_lab_clips", "user_id", args.userId)).filter((row) => artistIds.has(text(row, "artist_id")));
  const renderRows = (await rows(db, "creative_lab_renders", "user_id", args.userId)).filter((row) => clipRows.some((clip) => text(clip, "id") === text(row, "clip_id")));
  const candidateRows = (await rowsIfPresent(db, "creative_lab_ig_candidates", "user_id", args.userId)).filter((row) => artistIds.has(text(row, "artist_id")));
  const roundIds = new Set(rounds.map((row) => text(row, "id")));
  const adRows = (await rows(db, "creative_lab_round_ads", "user_id", args.userId)).filter((row) => roundIds.has(text(row, "round_id")));
  const launchRows = (await rows(db, "creative_lab_round_ad_launches", "user_id", args.userId)).filter((row) =>
    adRows.some((ad) => text(ad, "id") === text(row, "round_ad_id")),
  );

  const factsRow = factRows[0];
  const lineup = ((factsRow?.lineup as string[] | undefined) ?? []).map((name) => name.trim()).filter(Boolean);
  const headliners = ((factsRow?.headliners as string[] | undefined) ?? []).map((name) => name.trim()).filter(Boolean);
  const allowedDates = ((factsRow?.allowed_dates as string[] | undefined) ?? []).map((day) => day.slice(0, 10));
  const facts: EventFacts | null = factsRow
    ? {
        eventId: args.eventId,
        eventName: args.eventName,
        eventDate: args.eventDate?.slice(0, 10) ?? null,
        venueName: args.venueName,
        venueCity: args.venueCity,
        lineup,
        headliners,
        hasFacts: true,
        allowedDates,
        tiers: [],
      }
    : null;

  const assetOf = new Map(assets.map((row) => [text(row, "id"), row]));
  const videos = assets.filter((row) => text(row, "media_kind") === "video");
  const counts = new Map<string, number>();
  for (const ad of launchedAds) {
    const id = text(ad, "meta_adset_id");
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const today = (args.now ?? new Date()).toISOString().slice(0, 10);
  const libraryById = new Map(libraryArtists.map((row) => [text(row, "id"), row]));
  const lineupRows: LabLineupRow[] = roster
    .slice()
    .sort((a, b) => (Number(a.billing_order) || 0) - (Number(b.billing_order) || 0))
    .flatMap((row) => {
      const artistId = text(row, "artist_id");
      const artist = libraryById.get(artistId);
      const name = text(artist, "name");
      if (!name) return [];
      const lab = artists.find((item) => text(item, "artist_id") === artistId)
        ?? artists.find((item) => artistKey(text(item, "name")) === artistKey(name));
      const labId = lab ? text(lab, "id") : "";
      const profileJson = artist?.profile_jsonb as { spotify?: { genres?: unknown } } | null;
      const genres = Array.isArray(artist?.genres) && (artist.genres as string[]).length
        ? (artist.genres as string[])
        : Array.isArray(profileJson?.spotify?.genres)
          ? (profileJson.spotify.genres as string[])
          : [];
      const eventCities = clientEvents
        .filter((event) => text(event, "event_date").slice(0, 10) < today)
        .filter((event) => memberships.some((member) => text(member, "artist_id") === artistId && text(member, "event_id") === text(event, "id") && text(event, "id") !== args.eventId))
        .map((event) => text(event, "venue_city"))
        .filter(Boolean);
      return [{
        artistId,
        name,
        isHeadliner: row.is_headliner === true,
        imageUrl: text(artist, "profile_image_url") || null,
        instagramHandle: text(artist, "instagram_handle") || text(lab, "ig_username") || null,
        tiktokHandle: text(artist, "tiktok_handle") || null,
        spotifyId: text(artist, "spotify_id") || null,
        metaPageId: text(artist, "meta_page_id") || text(lab, "meta_page_id") || null,
        genres,
        enrichedAt: text(artist, "enriched_at") || null,
        playedBefore: playedBefore(eventCities, Array.isArray(lab?.played_cities) ? (lab.played_cities as string[]) : []),
        labArtistId: labId || null,
        clearedAt: text(lab, "approved_at") || null,
        clearedBy: text(lab, "approved_by") && text(lab, "approved_by") === (args.operatorId ?? "") ? (args.operatorName || "You") : null,
        rightsNote: text(lab, "rights_doc_ref") || null,
        clipCount: labId ? clipRows.filter((clip) => text(clip, "artist_id") === labId).length : 0,
        spotifyCandidates: text(artist, "spotify_id") ? [] : spotifyCandidatesOf(artist?.profile_jsonb),
      }];
    });

  const scopeIds = [...new Set([args.eventId, ...clientEvents.map((row) => text(row, "id")).filter(Boolean)])];
  const insightRoundRes = await db.from("creative_lab_rounds").select("id, round_no, event_id").eq("user_id", args.userId).in("event_id", scopeIds);
  if (insightRoundRes.error) throw new Error(`creative_lab_rounds: ${insightRoundRes.error.message}`);
  const insightRounds = (insightRoundRes.data ?? []) as Row[];
  const insightRoundIds = insightRounds.map((row) => text(row, "id")).filter(Boolean);
  const insightAdRes = insightRoundIds.length
    ? await db.from("creative_lab_round_ads").select("round_id, clip_id, caption_id, verdict, verdict_results, verdict_cost_per_result").in("round_id", insightRoundIds)
    : { data: [] as Row[], error: null };
  if (insightAdRes.error) throw new Error(`creative_lab_round_ads: ${insightAdRes.error.message}`);
  const insightAds = (insightAdRes.data ?? []) as Row[];
  const captionIds = [...new Set(insightAds.map((row) => text(row, "caption_id")).filter(Boolean))];
  const insightCaptionRes = captionIds.length
    ? await db.from("creative_lab_captions").select("id, style").in("id", captionIds)
    : { data: [] as Row[], error: null };
  if (insightCaptionRes.error) throw new Error(`creative_lab_captions: ${insightCaptionRes.error.message}`);
  const styleOf = new Map(((insightCaptionRes.data ?? []) as Row[]).map((row) => [text(row, "id"), text(row, "style")]));
  const workingAds: WorkingAd[] = insightAds.map((ad) => {
    const round = insightRounds.find((row) => text(row, "id") === text(ad, "round_id"));
    const clip = clipRows.find((row) => text(row, "id") === text(ad, "clip_id"));
    const artist = artists.find((row) => text(row, "id") === text(clip, "artist_id"));
    return {
      style: styleOf.get(text(ad, "caption_id")) ?? "",
      roundId: text(ad, "round_id"),
      eventId: text(round, "event_id"),
      verdict: ad.verdict == null || ad.verdict === "" ? null : String(ad.verdict),
      cost: ad.verdict_cost_per_result == null ? null : Number(ad.verdict_cost_per_result),
      results: ad.verdict_results == null ? null : Number(ad.verdict_results),
      clipNo: Number(clip?.clip_no) || 0,
      artistName: text(artist, "name"),
      roundNo: Number(round?.round_no) || 0,
    };
  });
  const working = whatsWorking(workingAds, { clientName: clientName || "this client", eventId: args.eventId });
  const voice = args.clientId
    ? await loadCardVoice(
        db,
        args.clientId,
        artists.map((row) => ({
          id: text(row, "id"),
          handle: text(row, "ig_username") || null,
          error: text(row, "ig_last_error") || null,
        })),
        text(clientAccount.data as Row | null, "instagram_handle") || null,
      ).catch(() => null)
    : null;

  const clipSelection = await loadClipSelection(db, args.eventId);

  return {
    eventId: args.eventId,
    clipSelection: { mode: clipSelection.mode, rows: clipSelection.rows.map((row) => ({ clipId: row.clipId, selected: row.selected })) },
    clientId: args.clientId,
    eventName: args.eventName,
    eventDate: args.eventDate?.slice(0, 10) ?? null,
    venueName: args.venueName?.trim() || null,
    eventStatus: args.eventStatus,
    clientName,
    voice,
    launchesEnabled: labLaunchesEnabled(),
    saleDatesMissing: !String(args.presaleAt ?? "").trim() && !String(args.generalSaleAt ?? "").trim(),
    longApproved: profile.longApproved,
    paydayLabel: nextPayday(args.now).label,
    daysToEvent: daysUntilEvent(args.eventDate, args.now),
    now: (args.now ?? new Date()).toISOString(),
    lineupRows,
    working,
    facts: factsRow ? { lineup, headliners, allowedDates } : null,
    artists: artists.map((row) => ({
      id: text(row, "id"),
      name: text(row, "name"),
      rightsDocRef: text(row, "rights_doc_ref") || null,
      startingCaption: text(row, "starting_caption") || null,
      metaPageId: text(row, "meta_page_id") || null,
      instagramActorId: text(row, "instagram_actor_id") || null,
      playedCities: Array.isArray(row.played_cities) ? row.played_cities.map((city) => String(city).trim()).filter(Boolean) : [],
      clipFolderUrl: text(row, "clip_folder_url") || null,
      clipSource: ["spark", "file", "instagram", "presskit"].includes(text(row, "clip_source")) ? text(row, "clip_source") : "file",
      clipFolderLastError: text(row, "clip_folder_last_error") || null,
      igLastError: text(row, "ig_last_error") || null,
      igUsername: text(row, "ig_username") || null,
      pronouns: pronounOn(libraryById.get(text(row, "artist_id"))?.profile_jsonb),
      igCandidates: candidateRows
        .filter((candidate) => text(candidate, "artist_id") === text(row, "id"))
        .filter((candidate) => ["candidate", "requested", "skipped", "imported"].includes(text(candidate, "status")))
        .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
        .map((candidate) => ({
          id: text(candidate, "id"),
          igMediaId: text(candidate, "ig_media_id"),
          permalink: text(candidate, "permalink") || null,
          postedAt: text(candidate, "posted_at").slice(0, 10) || null,
          likes: candidate.likes == null ? null : Number(candidate.likes),
          comments: candidate.comments == null ? null : Number(candidate.comments),
          score: candidate.score == null ? null : Number(candidate.score),
          aspect: text(candidate, "aspect") || null,
          hasFile: candidate.has_file === true,
          audioMatch: candidate.audio_match === true ? true : candidate.audio_match === false ? false : null,
          status: text(candidate, "status"),
          reason: text(candidate, "reason") || null,
          thumbnailUrl: publicThumbUrl(text(candidate, "thumbnail_path")),
          lengthSeconds: null,
          overlayOpen: false,
          overlay: overlayOf(candidate.overlay_check),
          caption: typeof candidate.caption === "string" ? candidate.caption : null,
        })),
      rights: rightsState({ rights_doc_ref: text(row, "rights_doc_ref"), approved_at: text(row, "approved_at") || null }),
      rightsLabel: rightsLabel({ rights_doc_ref: text(row, "rights_doc_ref"), approved_at: text(row, "approved_at") || null }),
      approvedAt: text(row, "approved_at") || null,
    })),
    clips: clipRows.map((row) => {
      const asset = assetOf.get(text(row, "creative_asset_id"));
      const fileSeconds = asset?.duration_seconds == null || asset.duration_seconds === "" ? null : Number(asset.duration_seconds);
      const storedIn = row.in_s == null || row.in_s === "" ? null : Number(row.in_s);
      const storedOut = row.out_s == null || row.out_s === "" ? null : Number(row.out_s);
      const window = clipWindow({
        fileSeconds: fileSeconds != null && Number.isFinite(fileSeconds) ? fileSeconds : null,
        inS: storedIn != null && Number.isFinite(storedIn) ? storedIn : null,
        outS: storedOut != null && Number.isFinite(storedOut) ? storedOut : null,
      });
      const seconds = window.outS == null ? null : Math.max(0, window.outS - window.inS);
      const artist = artists.find((item) => text(item, "id") === text(row, "artist_id"));
      const bill = lineupRows.findIndex((line) => line.labArtistId === text(row, "artist_id"));
      const line = bill >= 0 ? lineupRows[bill] : null;
      const renders = renderRows.filter((render) => text(render, "clip_id") === text(row, "id"));
      const rendered = renders.find((render) => text(render, "status") === "done" && text(render, "creative_asset_id"));
      const renderedAsset = rendered ? assetOf.get(text(rendered, "creative_asset_id")) : undefined;
      const renderError = currentRenderError(renders.map((render) => ({
        status: text(render, "status"),
        error: text(render, "error") || null,
        createdAt: String(render.created_at ?? ""),
      })));
      const judgedAds = adRows
        .filter((ad) => text(ad, "clip_id") === text(row, "id"))
        .filter((ad) => text(ad, "verdict") || text(ad, "window_start") || ad.verdict_results != null || ad.verdict_cost_per_result != null)
        .sort((a, b) => Number(rounds.find((round) => text(round, "id") === text(b, "round_id"))?.round_no) - Number(rounds.find((round) => text(round, "id") === text(a, "round_id"))?.round_no));
      const judged = judgedAds[0];
      return {
        id: text(row, "id"),
        artistId: text(row, "artist_id"),
        clipNo: Number(row.clip_no),
        source: text(row, "source"),
        rightsRef: text(row, "rights_ref"),
        filmedEventId: text(row, "event_id") || null,
        durationSeconds: seconds,
        inS: window.inS,
        outS: window.outS,
        sourceWidth: null,
        sourceHeight: null,
        billingOrder: bill >= 0 ? bill : Number.MAX_SAFE_INTEGER,
        isHeadliner: line?.isHeadliner === true,
        thumbnailUrl: text(renderedAsset, "thumbnail_url") || text(asset, "thumbnail_url") || null,
        storagePath: text(asset, "storage_path") || null,
        previewUrl: null,
        hasFile: Boolean(text(asset, "storage_path")),
        artistName: text(artist, "name"),
        cleared: Boolean(artist?.approved_at),
        audioMatch: row.audio_match === true ? true : row.audio_match === false ? false : null,
        cropFocusX: row.crop_focus_x == null ? 0.5 : Number(row.crop_focus_x),
        cropOpen: false,
        renderError,
        judged: judged
          ? {
              verdict: judged.verdict == null || judged.verdict === "" ? null : String(judged.verdict),
              cost: judged.verdict_cost_per_result == null ? null : Number(judged.verdict_cost_per_result),
              results: judged.verdict_results == null ? null : Number(judged.verdict_results),
              metric: text(judged, "result_metric") || null,
              roundNo: Number(rounds.find((round) => text(round, "id") === text(judged, "round_id"))?.round_no) || 0,
            }
          : null,
      };
    }),
    renders: renderRows.map((row) => {
      const clip = clipRows.find((item) => text(item, "id") === text(row, "clip_id"));
      const clipAsset = clip ? assetOf.get(text(clip, "creative_asset_id")) : undefined;
      const artist = artists.find((item) => text(item, "id") === text(clip ?? null, "artist_id"));
      const caption = captions.find((item) => text(item, "id") === text(row, "caption_id"));
      const asset = assetOf.get(text(row, "creative_asset_id"));
      return {
        id: text(row, "id"),
        clipId: text(row, "clip_id"),
        captionId: text(row, "caption_id"),
        label: `${text(artist, "name") || "Clip"} #${clip?.clip_no ?? ""} × ${text(caption, "style").replaceAll("_", " ")}`.trim(),
        status: text(row, "status"),
        error: text(row, "error") || null,
        renderMs: row.render_ms == null ? null : Number(row.render_ms),
        updatedAt: String(row.updated_at ?? row.created_at ?? ""),
        previewUrl: text(asset, "public_url") || null,
        posterUrl: text(asset, "thumbnail_url") || null,
        clipPreviewUrl: text(clipAsset, "public_url") || text(clipAsset, "thumbnail_url") || null,
        lines: [],
        playing: false,
        roundOpen: renderRoundOpen(
          adRows
            .filter((ad) => text(ad, "render_id") === text(row, "id"))
            .map((ad) => text(rounds.find((round) => text(round, "id") === text(ad, "round_id")) ?? null, "status")),
        ),
      };
    }),
    assets: videos.map((row) => ({
      id: text(row, "id"),
      filename: text(row, "filename"),
      durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
      thumbnailUrl: text(row, "thumbnail_url") || null,
    })),
    clientEvents: clientEvents.map((row) => ({
      id: text(row, "id"),
      name: text(row, "name"),
      eventDate: text(row, "event_date").slice(0, 10) || null,
    })),
    captions: captions
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .map((row) => {
        const style = text(row, "style");
        const sizeVariant = text(row, "size_variant") || "default";
        const overlay = text(row, "text");
        const primary = text(row, "primary_text");
        const mode = text(row, "mode") === "quote" || style === "quote" ? "quote" as const : "caption" as const;
        const source = text(row, "quote_source");
        const quoteSource = source === "press_kit" || source === "post" || source === "typed" ? source : null;
        const quoteWeight = Number(row.quote_weight) === 400 ? 400 as const : Number(row.quote_weight) === 700 ? 700 as const : null;
        if (mode === "quote") {
          const check = facts ? validateQuote(overlay, facts) : null;
          const stored = Array.isArray(row.lines) ? (row.lines as string[]).map((line) => String(line)) : quoteLines(overlay);
          return {
            id: text(row, "id"),
            style,
            status: text(row, "status"),
            lines: stored.length ? stored : quoteLines(overlay),
            primaryText: primary,
            sizeVariant,
            validatorOk: check?.ok ?? false,
            validatorDetail: check ? (check.sentence ?? "") : "No event facts.",
            awaitingLong: false,
            mode,
            quoteSource,
            quoteSourceRef: text(row, "quote_source_ref") || null,
            quoteSourceNote: text(row, "quote_source_note") || null,
            quoteWeight,
            artistId: text(row, "artist_id") || null,
            clipId: text(row, "clip_id") || null,
          };
        }
        const check = facts && isCaptionStyle(style)
          ? validateCaption(overlay, style, (row.declared_names as string[] | undefined) ?? [], facts, { version: text(row, "style_version") }, { primaryText: primary })
          : null;
        return {
          id: text(row, "id"),
          style,
          status: text(row, "status"),
          lines: check?.lines ?? (Array.isArray(row.lines) ? (row.lines as string[]) : [overlay]),
          primaryText: primary,
          sizeVariant,
          validatorOk: check?.ok ?? false,
          validatorDetail: check ? failedCheckSentence(check.ok, check.errors.map((error) => error.detail)) ?? "" : "No event facts.",
          awaitingLong: sizeVariant === "long" && !profile.longApproved,
          mode,
          clipId: text(row, "clip_id") || null,
        };
      }),
    adSets: adSets.map((row) => ({
      metaAdSetId: text(row, "meta_adset_id"),
      adAccountId: text(row, "ad_account_id"),
      name: text(row, "source_name") || text(row, "meta_adset_id"),
      status: text(row, "phase_at_launch") || "recorded",
      adCount: counts.get(text(row, "meta_adset_id")) ?? 0,
      cap: 50 as const,
    })),
    adAccountId,
    rounds: rounds
      .sort((a, b) => Number(b.round_no) - Number(a.round_no))
      .map((round) => {
        const artist = artists.find((row) => text(row, "id") === text(round, "artist_id"));
        const ads = adRows.filter((row) => text(row, "round_id") === text(round, "id"));
        return {
          id: text(round, "id"),
          roundNo: Number(round.round_no),
          artistId: text(round, "artist_id"),
          artistName: text(artist, "name"),
          status: text(round, "status"),
          artistApproved: Boolean(artist?.approved_at),
          rendersPending: ads.some((ad) => text(ad, "launch_state") === "pending"),
          ads: ads.map((ad) => {
            const launch = launchRows.find((row) => text(row, "round_ad_id") === text(ad, "id"));
            const clip = clipRows.find((row) => text(row, "id") === text(ad, "clip_id"));
            const asset = assetOf.get(text(clip, "creative_asset_id"));
            const account = text(launch, "ad_account_id").replace(/^act_/, "");
            const metaAdId = text(launch, "meta_ad_id") || null;
            return {
              id: text(ad, "id"),
              adName: text(ad, "ad_name"),
              role: text(ad, "role"),
              launchState: text(ad, "launch_state"),
              thumbnailUrl: text(asset, "thumbnail_url") || null,
              metaAdId,
              adsManagerUrl: metaAdId && account
                ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${account}&selected_ad_ids=${metaAdId}`
                : null,
              clipId: text(ad, "clip_id"),
              captionId: text(ad, "caption_id"),
              verdict: ad.verdict == null || ad.verdict === "" ? null : String(ad.verdict),
              cost: ad.verdict_cost_per_result == null ? null : Number(ad.verdict_cost_per_result),
              results: ad.verdict_results == null ? null : Number(ad.verdict_results),
              metric: text(ad, "result_metric") || null,
            };
          }),
        };
      }),
  };
}
