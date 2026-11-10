/**
 * Build one Creative Lab round and queue its renders.
 *
 * Goes through createRound, so an artist without approved rights never
 * gets a round. Nothing here calls Meta. The target ad set is stored for
 * M3b, which is what launches, paused.
 *
 * Round 1: the operator's ad set, the artist's first short clip with the
 * starting caption as the control, then challengers. Later rounds follow
 * nextRoundPlan and copy the target.
 */

import { styleVersion } from "../../src/remotion/caption-style/profile.ts";
import { crowdBlock, normaliseCaption } from "./caption-facts.ts";
import { captionAllowsClip } from "./footage-owner.ts";
import { nextRoundPlan, type RoundPlanInput } from "./judge.ts";
import type { ServiceRoleDb } from "./load.ts";
import { sizesForClipFiles } from "./clip-preview.ts";
import { TOO_SMALL_FOR_916, tooSmallFor916 } from "./import-quality.ts";
import { noSelectedClipsSentence, selectedIdSet } from "./selection.ts";
import { loadClipSelection } from "./selection-store.ts";
import { assertArtistCleared, buildAdName, createRound, type LabArtist } from "./rounds.ts";
import { clipWindow, renderRefusalSentence, renderRetryable, renderRoundOpen } from "./surface.ts";
import type { CaptionStyle } from "./tags.ts";

export const MAX_ADS_PER_AD_SET = 50;
const MAX_CLIP_SECONDS = 30;
/** Support (on the bill, not a headliner) gets this many ads per event, across rounds. */
const SUPPORT_AD_CAP = 2;

export class RoundBuildError extends Error {
  readonly code:
    | "no_ad_set_record"
    | "no_destination"
    | "no_page"
    | "no_objective"
    | "no_ad_set_name"
    | "no_clips"
    | "no_selected_clips"
    | "ad_set_full"
    | "no_previous_target"
    | "ad_set_changed"
    | "support_cap";

  constructor(code: RoundBuildError["code"], message: string) {
    super(message);
    this.name = "RoundBuildError";
    this.code = code;
  }
}

export type RoundTarget = {
  adAccountId: string;
  metaCampaignId: string;
  metaAdsetId: string;
  pageId: string;
  instagramActorId: string | null;
  destinationUrl: string;
  cta: string;
  campaignObjective: string;
  adSetName: string;
  adSetStatus: string;
};

export type ProposedAd = {
  id: string;
  adName: string;
  role: "control" | "challenger";
  clipId: string;
  captionId: string;
  renderId: string;
  launchState: "pending" | "ready";
};

export type ProposeRoundResult = {
  roundId: string;
  roundNo: number;
  status: "draft" | "rendering";
  target: RoundTarget;
  ads: ProposedAd[];
  skipped: { reason: string }[];
};

type Row = Record<string, unknown>;

async function list(db: ServiceRoleDb, table: string, column: string, value: string): Promise<Row[]> {
  const res = await db.from(table).select("*").eq(column, value);
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data ?? []) as Row[];
}

function clipSeconds(clip: Row, asset: Row | undefined): number | null {
  const file = asset?.duration_seconds == null ? null : Number(asset.duration_seconds);
  const window = clipWindow({
    fileSeconds: file != null && Number.isFinite(file) ? file : null,
    inS: clip.in_s == null ? null : Number(clip.in_s),
    outS: clip.out_s == null ? null : Number(clip.out_s),
  });
  if (window.outS == null) return null;
  return window.outS - window.inS;
}

type DraftJson = {
  creatives?: { identity?: { pageId?: string; instagramActorId?: string } }[];
  settings?: {
    objective?: string;
    existingMetaCampaign?: { objective?: string };
    existingMetaAdSets?: { id?: string; name?: string; status?: string }[];
  };
  existingMetaAdSets?: { id?: string; name?: string; status?: string }[];
};

function asDraft(draft: unknown): DraftJson {
  return (draft ?? {}) as DraftJson;
}

function pageFromDraft(draft: unknown): { pageId: string | null; instagramActorId: string | null } {
  const creatives = asDraft(draft).creatives ?? [];
  for (const creative of creatives) {
    const pageId = creative.identity?.pageId?.trim();
    if (pageId) return { pageId, instagramActorId: creative.identity?.instagramActorId?.trim() || null };
  }
  return { pageId: null, instagramActorId: null };
}

function adSetFromDraft(draft: unknown, adsetMetaId: string): { name: string | null; status: string | null } {
  const json = asDraft(draft);
  const sets = [...(json.settings?.existingMetaAdSets ?? []), ...(json.existingMetaAdSets ?? [])];
  const hit = sets.find((row) => row.id === adsetMetaId);
  return { name: hit?.name?.trim() || null, status: hit?.status?.trim() || null };
}

function objectiveFromRecord(adSet: Row, draft: unknown): string | null {
  const recorded = String(adSet.objective ?? "").trim();
  if (recorded) return recorded;
  const json = asDraft(draft);
  const fromSettings = json.settings?.objective?.trim();
  if (fromSettings) return fromSettings;
  const fromCampaign = json.settings?.existingMetaCampaign?.objective?.trim();
  return fromCampaign || null;
}

async function resolveTarget(db: ServiceRoleDb, adsetMetaId: string): Promise<RoundTarget> {
  const adSetRes = await db.from("launched_ad_sets").select("*").eq("meta_adset_id", adsetMetaId).maybeSingle();
  if (adSetRes.error) throw new Error(`launched_ad_sets: ${adSetRes.error.message}`);
  const adSet = adSetRes.data as Row | null;
  if (!adSet?.ad_account_id || !adSet.meta_campaign_id) {
    throw new RoundBuildError("no_ad_set_record", `The app has no launched_ad_sets record for ad set ${adsetMetaId}.`);
  }
  const ads = (await list(db, "launched_ads", "meta_adset_id", adsetMetaId)).sort((a, b) =>
    String(b.launched_at ?? "").localeCompare(String(a.launched_at ?? "")),
  );
  const withCopy = ads.find((ad) => String(ad.destination_url ?? "").trim() && String(ad.cta ?? "").trim());
  if (!withCopy) {
    throw new RoundBuildError("no_destination", `Ad set ${adsetMetaId} has no launched ad with a destination URL and a CTA.`);
  }
  let pageId: string | null = null;
  let instagramActorId: string | null = null;
  let draftJson: unknown = null;
  if (adSet.draft_id) {
    const draftRes = await db.from("campaign_drafts").select("draft_json").eq("id", String(adSet.draft_id)).maybeSingle();
    if (draftRes.error) throw new Error(`campaign_drafts: ${draftRes.error.message}`);
    const json = (draftRes.data as { draft_json?: unknown } | null)?.draft_json;
    const found = pageFromDraft(json);
    pageId = found.pageId;
    instagramActorId = found.instagramActorId;
    draftJson = json;
  }
  if (!pageId) {
    throw new RoundBuildError("no_page", `Ad set ${adsetMetaId} has no Page on the draft that launched it.`);
  }
  const campaignObjective = objectiveFromRecord(adSet, draftJson);
  if (!campaignObjective) {
    throw new RoundBuildError("no_objective", `Ad set ${adsetMetaId} has no recorded objective.`);
  }
  const named = adSetFromDraft(draftJson, adsetMetaId);
  const adSetName = String(adSet.source_name ?? "").trim() || named.name;
  if (!adSetName) {
    throw new RoundBuildError("no_ad_set_name", `Ad set ${adsetMetaId} has no name on the launched record.`);
  }
  return {
    adAccountId: String(adSet.ad_account_id),
    metaCampaignId: String(adSet.meta_campaign_id),
    metaAdsetId: adsetMetaId,
    pageId,
    instagramActorId,
    destinationUrl: String(withCopy.destination_url).trim(),
    cta: String(withCopy.cta).trim(),
    campaignObjective,
    adSetName,
    adSetStatus: named.status || "ACTIVE",
  };
}

function targetFromRound(row: Row): RoundTarget {
  const target = {
    adAccountId: String(row.ad_account_id ?? ""),
    metaCampaignId: String(row.meta_campaign_id ?? ""),
    metaAdsetId: String(row.meta_adset_id ?? ""),
    pageId: String(row.page_id ?? ""),
    instagramActorId: row.instagram_actor_id ? String(row.instagram_actor_id) : null,
    destinationUrl: String(row.destination_url ?? ""),
    cta: String(row.cta ?? ""),
    campaignObjective: String(row.meta_campaign_objective ?? "").trim(),
    adSetName: String(row.meta_adset_name ?? "").trim(),
    adSetStatus: String(row.meta_adset_status ?? "").trim() || "ACTIVE",
  };
  if (!target.adAccountId || !target.metaCampaignId || !target.metaAdsetId || !target.pageId || !target.destinationUrl || !target.cta) {
    throw new RoundBuildError("no_previous_target", "The previous round has no stored ad set target to copy.");
  }
  if (!target.campaignObjective) throw new RoundBuildError("no_objective", "The previous round has no recorded objective.");
  if (!target.adSetName) throw new RoundBuildError("no_ad_set_name", "The previous round has no ad set name.");
  return target;
}

type Clip = Row & { seconds: number | null };
type Caption = Row;

function rowSize(clip: Row): { width: number; height: number } | null {
  const width = Number(clip.source_width ?? clip.sourceWidth);
  const height = Number(clip.source_height ?? clip.sourceHeight);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Drop a clip whose 9:16 window is under 675 px. The row is kept; it just isn't in the round. */
async function clipsForRound(clips: Clip[], assets: Map<string, Row>, skipped: { reason: string }[]): Promise<Clip[]> {
  const sizes = new Map<string, { width: number; height: number }>();
  const pending: { id: string; storagePath: string | null }[] = [];
  for (const clip of clips) {
    const known = rowSize(clip);
    if (known) {
      sizes.set(String(clip.id), known);
      continue;
    }
    const asset = assets.get(String(clip.creative_asset_id ?? ""));
    const storagePath = asset ? String(asset.storage_path ?? "") : "";
    if (storagePath) pending.push({ id: String(clip.id), storagePath });
  }
  if (pending.length > 0) {
    const measured = await sizesForClipFiles(pending).catch((err: unknown) => {
      console.error("[propose] clip size probe failed:", err instanceof Error ? err.message : err);
      return new Map<string, { width: number; height: number }>();
    });
    for (const [id, size] of measured) sizes.set(id, size);
  }
  const kept: Clip[] = [];
  for (const clip of clips) {
    const size = sizes.get(String(clip.id));
    if (size && tooSmallFor916(size)) {
      skipped.push({ reason: TOO_SMALL_FOR_916 });
      continue;
    }
    kept.push(clip);
  }
  return kept;
}

function usable(clips: Clip[], skipped: { reason: string }[]): Clip[] {
  const ok: Clip[] = [];
  for (const clip of clips) {
    if (clip.seconds != null && clip.seconds > MAX_CLIP_SECONDS) {
      skipped.push({ reason: `clip ${clip.clip_no} is ${clip.seconds}s; clips over ${MAX_CLIP_SECONDS}s are refused` });
      continue;
    }
    ok.push(clip);
  }
  return ok;
}

function artistKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A support artist is capped at SUPPORT_AD_CAP ads for the event, counting
 * every round. Headliners are not. Empty headliners refuses rather than
 * guessing who is support. No facts row: no cap (the writer already refuses).
 */
async function capSupport(
  db: ServiceRoleDb,
  eventId: string,
  artistId: string,
  artistName: string,
  planned: Pair[],
  skipped: { reason: string }[],
): Promise<Pair[]> {
  const res = await db.from("creative_lab_event_facts").select("lineup, headliners").eq("event_id", eventId).maybeSingle();
  if (res.error) throw new Error(`creative_lab_event_facts: ${res.error.message}`);
  const row = res.data as { lineup?: string[] | null; headliners?: string[] | null } | null;
  if (!row) return planned;
  const headliners = (row.headliners ?? []).map((name) => name.trim()).filter(Boolean);
  const lineup = (row.lineup ?? []).map((name) => name.trim()).filter(Boolean);
  if (!headliners.length) throw new Error("headliners not set");
  const key = artistKey(artistName);
  const onBill = lineup.some((name) => artistKey(name) === key);
  const headline = headliners.some((name) => artistKey(name) === key);
  if (!onBill || headline) return planned;
  const rounds = (await list(db, "creative_lab_rounds", "event_id", eventId)).filter((round) => round.artist_id === artistId);
  let used = 0;
  for (const round of rounds) used += (await list(db, "creative_lab_round_ads", "round_id", String(round.id))).length;
  const room = Math.max(0, SUPPORT_AD_CAP - used);
  for (let i = room; i < planned.length; i += 1) skipped.push({ reason: "support_cap" });
  if (room === 0 && planned.length > 0) {
    throw new RoundBuildError("support_cap", "A support artist is capped at 2 ads for this event.");
  }
  return planned.slice(0, room);
}

export async function proposeRound(
  db: ServiceRoleDb,
  args: {
    userId: string;
    eventId: string;
    artistId: string;
    adsetMetaId: string;
    maxAds?: number;
    include?: readonly { clipId: string; captionId: string }[];
  },
): Promise<ProposeRoundResult> {
  const maxAds = args.maxAds ?? 8;
  const artistRes = await db.from("creative_lab_artists").select("*").eq("id", args.artistId).maybeSingle();
  if (artistRes.error) throw new Error(`creative_lab_artists: ${artistRes.error.message}`);
  const eventRes = await db.from("events").select("id, client_id").eq("id", args.eventId).maybeSingle();
  if (eventRes.error) throw new Error(`events: ${eventRes.error.message}`);
  const event = eventRes.data as { client_id: string | null } | null;
  if (!event) throw new Error("No event with that id.");
  const artist = artistRes.data as (LabArtist & {
    starting_caption?: string | null;
    meta_page_id?: string | null;
    instagram_actor_id?: string | null;
  }) | null;
  assertArtistCleared(artist, event.client_id);

  const clipRows = await list(db, "creative_lab_clips", "artist_id", args.artistId);
  const assetRows = await list(db, "creative_assets", "user_id", args.userId);
  const assets = new Map(assetRows.map((row) => [String(row.id), row]));
  const clips = clipRows
    .map((clip) => ({ ...clip, seconds: clipSeconds(clip, assets.get(String(clip.creative_asset_id))) }) as Clip)
    .sort((a, b) => Number(a.clip_no) - Number(b.clip_no));
  const skipped: { reason: string }[] = [];
  const usableClips = usable(clips, skipped);
  const selection = await loadClipSelection(db, args.eventId);
  const selectedIds = selectedIdSet(selection, usableClips.map((clip) => String(clip.id)));
  const shortClips = await clipsForRound(
    usableClips.filter((clip) => selectedIds.has(String(clip.id))),
    assets,
    skipped,
  );
  const featureRows = await list(db, "creative_lab_clip_features", "artist_id", args.artistId);
  const featureIds = featureRows.map((row) => String(row.clip_id ?? "")).filter(Boolean);
  const featuredClips: Clip[] = [];
  if (featureIds.length > 0) {
    const extra = await db.from("creative_lab_clips").select("*").in("id", featureIds);
    if (!extra.error) {
      for (const row of (extra.data ?? []) as Row[]) {
        if (row.owner !== "promoter") continue;
        if (shortClips.some((clip) => clip.id === row.id)) continue;
        const ticked = selection.mode === "all" || selection.rows.some((item) => item.clipId === String(row.id) && item.selected);
        if (!ticked) continue;
        featuredClips.push({ ...row, seconds: clipSeconds(row, assets.get(String(row.creative_asset_id))) } as Clip);
      }
    }
  }
  shortClips.push(...(await clipsForRound(featuredClips, assets, skipped)));

  const rounds = (await list(db, "creative_lab_rounds", "event_id", args.eventId))
    .filter((row) => row.artist_id === args.artistId)
    .sort((a, b) => Number(b.round_no) - Number(a.round_no));
  const previous = rounds[0] ?? null;
  if (!shortClips.length) {
    const roundNo = previous ? Number(previous.round_no) + 1 : 1;
    throw new RoundBuildError(
      usableClips.length ? "no_selected_clips" : "no_clips",
      usableClips.length ? noSelectedClipsSentence(roundNo) : "no clips",
    );
  }
  const target = previous ? targetFromRound(previous) : await resolveTarget(db, args.adsetMetaId);
  if (previous && target.metaAdsetId !== args.adsetMetaId) {
    throw new RoundBuildError("ad_set_changed", `Round ${Number(previous.round_no) + 1} keeps ad set ${target.metaAdsetId}.`);
  }

  const [captionRows, version] = await Promise.all([
    list(db, "creative_lab_captions", "event_id", args.eventId),
    styleVersion(),
  ]);
  const approved = captionRows
    .filter((row) => row.status === "approved")
    .filter((row) => row.mode !== "quote" && row.style !== "quote" || String(row.artist_id ?? "") === args.artistId)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const cleared = Boolean(artist.approved_at);
  const hasArtistVoice = cleared && Boolean(String(artist.meta_page_id ?? "").trim() && String(artist.instagram_actor_id ?? "").trim());
  const tickets = await ticketsSoldByEvent(
    db,
    shortClips.flatMap((clip) => (clip.event_id ? [String(clip.event_id)] : [])),
  );
  const chosen = args.include
    ? args.include
        .filter((pair) => shortClips.some((clip) => clip.id === pair.clipId) && approved.some((caption) => caption.id === pair.captionId))
        .map((pair, index) => ({
          clipId: pair.clipId,
          captionId: pair.captionId,
          role: (index === 0 ? "control" : "challenger") as "control" | "challenger",
          retestOf: null,
        }))
    : null;
  if (chosen && chosen.length === 0) {
    throw new RoundBuildError("no_selected_clips", noSelectedClipsSentence(previous ? Number(previous.round_no) + 1 : 1));
  }
  const pairs = chosen
    ?? (previous
      ? await pairsFromPlan(artist.name, cleared, previous, shortClips, approved, hasArtistVoice, tickets, skipped, maxAds, db)
      : pairsForFirstRound(artist.name, artist.starting_caption ?? "", cleared, shortClips, approved, hasArtistVoice, tickets, skipped, maxAds));

  const featured = new Map<string, string[]>();
  for (const row of featureRows) {
    const clipId = String(row.clip_id ?? "");
    const artistId = String(row.artist_id ?? "");
    if (!clipId || !artistId) continue;
    featured.set(clipId, [...(featured.get(clipId) ?? []), artistId]);
  }
  const planned = (await capSupport(db, args.eventId, args.artistId, artist.name, pairs, skipped)).filter((pair) => {
    const clip = shortClips.find((row) => row.id === pair.clipId);
    const caption = approved.find((row) => row.id === pair.captionId);
    if (!clip || !caption) return false;
    const owner = clip.owner === "promoter" || clip.owner === "artist" ? clip.owner : null;
    return captionAllowsClip(
      {
        id: String(caption.id),
        style: String(caption.style ?? ""),
        mode: caption.mode == null ? null : String(caption.mode),
        artistId: caption.artist_id == null ? null : String(caption.artist_id),
        status: caption.status == null ? null : String(caption.status),
      },
      {
        id: String(clip.id),
        owner,
        artistId: clip.artist_id == null ? null : String(clip.artist_id),
        featuredArtistIds: featured.get(String(clip.id)) ?? [],
      },
    );
  });
  const existingAds = await list(db, "launched_ads", "meta_adset_id", target.metaAdsetId);
  if (existingAds.length + planned.length > MAX_ADS_PER_AD_SET) {
    throw new RoundBuildError(
      "ad_set_full",
      `Ad set ${target.metaAdsetId} has ${existingAds.length} ads; ${planned.length} more would pass ${MAX_ADS_PER_AD_SET}.`,
    );
  }

  const round = await createRound(db, { userId: args.userId, eventId: args.eventId, artistId: args.artistId, channel: "meta" });
  const written: ProposedAd[] = [];
  for (const pair of planned) {
    const caption = approved.find((row) => row.id === pair.captionId);
    if (!caption) continue;
    const adName = buildAdName({
      artistName: artist.name,
      clipNo: Number(shortClips.find((clip) => clip.id === pair.clipId)?.clip_no),
      style: caption.style as CaptionStyle,
      captionNo: Number(caption.caption_no),
    });
    const render = await queueRender(db, {
      userId: args.userId,
      clipId: pair.clipId,
      captionId: pair.captionId,
      styleVersion: String(caption.style_version || version),
    });
    const adRes = await db
      .from("creative_lab_round_ads")
      .insert({
        user_id: args.userId,
        round_id: round.id,
        clip_id: pair.clipId,
        caption_id: pair.captionId,
        ad_name: adName,
        role: pair.role,
        retest_of: pair.retestOf,
        render_id: render.id,
        launch_state: render.ready ? "ready" : "pending",
      })
      .select("id")
      .single();
    if (adRes.error || !adRes.data) throw new Error(`creative_lab_round_ads insert: ${adRes.error?.message ?? "no row"}`);
    written.push({
      id: String((adRes.data as Row).id),
      adName,
      role: pair.role,
      clipId: pair.clipId,
      captionId: pair.captionId,
      renderId: render.id,
      launchState: render.ready ? "ready" : "pending",
    });
  }

  const status = written.length > 0 && written.every((ad) => ad.launchState === "ready") ? "draft" : written.length ? "rendering" : "draft";
  const update = await db
    .from("creative_lab_rounds")
    .update({
      status,
      ad_account_id: target.adAccountId,
      meta_campaign_id: target.metaCampaignId,
      meta_adset_id: target.metaAdsetId,
      page_id: target.pageId,
      instagram_actor_id: target.instagramActorId,
      destination_url: target.destinationUrl,
      cta: target.cta,
      meta_campaign_objective: target.campaignObjective,
      meta_adset_name: target.adSetName,
      meta_adset_status: target.adSetStatus,
    })
    .eq("id", round.id);
  if (update.error) throw new Error(`creative_lab_rounds update: ${update.error.message}`);

  return { roundId: round.id, roundNo: round.round_no, status, target, ads: written, skipped };
}

type Pair = { clipId: string; captionId: string; role: "control" | "challenger"; retestOf: string | null };

function isQuote(caption: Caption): boolean {
  return caption.mode === "quote" || caption.style === "quote";
}

function allowCaption(
  caption: Caption,
  artistName: string,
  cleared: boolean,
  hasArtistPage: boolean,
  skipped: { reason: string }[],
): boolean {
  const voice = caption.style === "artist_first_person" || isQuote(caption);
  if (voice && !cleared) {
    skipped.push({ reason: `not cleared for ${artistName}'s own channels` });
    return false;
  }
  if (caption.style === "artist_first_person" && !hasArtistPage) {
    skipped.push({ reason: `caption ${caption.caption_no} is artist_first_person and the artist has no Page and Instagram account` });
    return false;
  }
  if (isQuote(caption) && !hasArtistPage) {
    skipped.push({ reason: `caption ${caption.caption_no} is a quote and the artist has no Page and Instagram account` });
    return false;
  }
  return true;
}

async function ticketsSoldByEvent(db: ServiceRoleDb, eventIds: string[]): Promise<Map<string, number | null>> {
  const sold = new Map<string, number | null>();
  const ids = [...new Set(eventIds)];
  if (!ids.length) return sold;
  const res = await db.from("events").select("id, tickets_sold").in("id", ids);
  if (res.error) throw new Error(`events: ${res.error.message}`);
  const needSnapshot: string[] = [];
  const seen = new Set<string>();
  for (const row of (res.data ?? []) as { id: string; tickets_sold?: number | null }[]) {
    seen.add(row.id);
    if (row.tickets_sold == null) needSnapshot.push(row.id);
    else sold.set(row.id, Number(row.tickets_sold));
  }
  for (const id of ids) if (!seen.has(id)) needSnapshot.push(id);
  for (const id of needSnapshot) {
    const snap = await db
      .from("ticket_sales_snapshots")
      .select("tickets_sold, snapshot_at")
      .eq("event_id", id)
      .order("snapshot_at", { ascending: false })
      .limit(1);
    if (snap.error) throw new Error(`ticket_sales_snapshots: ${snap.error.message}`);
    const row = ((snap.data ?? []) as { tickets_sold?: number | null }[])[0];
    sold.set(id, row?.tickets_sold == null ? null : Number(row.tickets_sold));
  }
  return sold;
}

function crowdReason(caption: Caption, clip: Clip, tickets: Map<string, number | null>): string | null {
  const eventId = clip.event_id == null ? null : String(clip.event_id);
  const count = eventId == null ? null : (tickets.get(eventId) ?? null);
  return crowdBlock(`${caption.text ?? ""}\n${caption.primary_text ?? ""}`, count);
}

function pairsForFirstRound(
  artistName: string,
  startingCaption: string,
  cleared: boolean,
  clips: Clip[],
  approved: Caption[],
  hasArtistPage: boolean,
  tickets: Map<string, number | null>,
  skipped: { reason: string }[],
  maxAds: number,
): Pair[] {
  const controlClip = clips[0];
  if (!controlClip) return [];
  const starting = approved.find((caption) => normaliseCaption(String(caption.text ?? "")) === normaliseCaption(startingCaption));
  let control: Caption | null = null;
  if (!starting) {
    skipped.push({ reason: "the artist's starting caption is not an approved caption" });
  } else if ((starting.style === "artist_first_person" || isQuote(starting)) && !cleared) {
    skipped.push({ reason: `needs clearance to run on ${artistName}'s channels` });
  } else if (allowCaption(starting, artistName, cleared, hasArtistPage, skipped)) {
    control = starting;
  }
  if (!control) {
    control = approved.find((caption) => caption.style !== "artist_first_person" && !isQuote(caption)) ?? null;
  }
  const pairs: Pair[] = [];
  const push = (clip: Clip, caption: Caption, role: Pair["role"]) => {
    if (pairs.length >= maxAds) return;
    if (!allowCaption(caption, artistName, cleared, hasArtistPage, skipped)) return;
    const blocked = crowdReason(caption, clip, tickets);
    if (blocked) {
      skipped.push({ reason: `caption ${caption.caption_no} on clip ${clip.clip_no}: ${blocked}` });
      return;
    }
    pairs.push({ clipId: String(clip.id), captionId: String(caption.id), role, retestOf: null });
  };
  if (control) push(controlClip, control, "control");
  for (const caption of approved) {
    if (pairs.length >= maxAds) break;
    if (control && caption.id === control.id) continue;
    if (pairs.filter((pair) => pair.clipId === controlClip.id && pair.role === "challenger").length >= 3) break;
    push(controlClip, caption, "challenger");
  }
  if (control) {
    for (const clip of clips.slice(1)) {
      if (pairs.length >= maxAds) break;
      push(clip, control, "challenger");
    }
  }
  return pairs;
}

async function pairsFromPlan(
  artistName: string,
  cleared: boolean,
  previous: Row,
  clips: Clip[],
  approved: Caption[],
  hasArtistPage: boolean,
  tickets: Map<string, number | null>,
  skipped: { reason: string }[],
  maxAds: number,
  db: ServiceRoleDb,
): Promise<Pair[]> {
  const prevAds = await list(db, "creative_lab_round_ads", "round_id", String(previous.id));
  const input: RoundPlanInput[] = prevAds.map((ad) => ({
    clipId: String(ad.clip_id),
    captionId: String(ad.caption_id),
    verdict: (ad.verdict as RoundPlanInput["verdict"]) ?? null,
    confirmed: ad.confirmed === true,
  }));
  const plan = nextRoundPlan(input);
  const prevByPair = new Map(prevAds.map((ad) => [`${ad.clip_id}:${ad.caption_id}`, String(ad.id)]));
  const usedCaptions = new Set(prevAds.map((ad) => String(ad.caption_id)));
  const fresh = approved.filter((caption) => !usedCaptions.has(String(caption.id)));
  const clipById = new Map(clips.map((clip) => [String(clip.id), clip]));
  const captionById = new Map(approved.map((caption) => [String(caption.id), caption]));
  const pairs: Pair[] = [];
  const seen = new Set<string>();
  const push = (clipId: string, captionId: string, role: Pair["role"], retestOf: string | null) => {
    if (pairs.length >= maxAds) return;
    const key = `${clipId}:${captionId}`;
    if (seen.has(key)) return;
    const clip = clipById.get(clipId);
    if (!clip) return;
    const caption = captionById.get(captionId);
    if (!caption || !allowCaption(caption, artistName, cleared, hasArtistPage, skipped)) return;
    const blocked = crowdReason(caption, clip, tickets);
    if (blocked) {
      skipped.push({ reason: `caption ${caption.caption_no} on clip ${clip.clip_no}: ${blocked}` });
      return;
    }
    seen.add(key);
    pairs.push({ clipId, captionId, role, retestOf });
  };
  for (const retest of plan.retest) {
    push(retest.clipId, retest.captionId, "control", prevByPair.get(`${retest.clipId}:${retest.captionId}`) ?? null);
  }
  for (const clipId of plan.newCaptionsOn) {
    for (const caption of fresh) push(clipId, String(caption.id), "challenger", null);
  }
  for (const captionId of plan.newClipsWith) {
    for (const clip of clips) {
      if (plan.dropClips.includes(String(clip.id))) continue;
      push(String(clip.id), captionId, "challenger", null);
    }
  }
  return pairs;
}

/** A retry the route refuses: the status code and one sentence for the row. */
export class RenderRetryError extends Error {
  readonly status: 404 | 409;
  constructor(status: 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Try one failed render again from its row. The owner's render only; it must
 * have failed for a reason a fresh try can fix (the renderer, a timeout, the
 * finished file not saving), and one round holding it must still be draft
 * or rendering — a render in no round can be tried too. It goes back through queueRender, so the same row is
 * re-queued with the next attempt number. Its round ads go back to pending so
 * the finished render reaches them, and a settled draft round reads as
 * rendering again until the queue settles it. No other render, ad or round
 * is touched.
 */
export async function retryRender(db: ServiceRoleDb, args: { renderId: string; userId: string }): Promise<{ renderId: string }> {
  const res = await db.from("creative_lab_renders").select("*").eq("id", args.renderId).maybeSingle();
  if (res.error) throw new Error(`creative_lab_renders: ${res.error.message}`);
  const render = res.data as Row | null;
  if (!render || render.user_id !== args.userId) throw new RenderRetryError(404, "This render isn't on your Lab — reload the page.");
  if (render.status !== "failed") throw new RenderRetryError(409, "This render isn't failed any more — reload the page.");
  const error = typeof render.error === "string" ? render.error : null;
  if (!renderRetryable(error)) {
    throw new RenderRetryError(409, renderRefusalSentence(error) ?? "This render can't be tried again — propose the round again.");
  }
  if (render.aspect !== "9:16") throw new RenderRetryError(409, "This render is an old size — propose the round again.");

  const ads = (await list(db, "creative_lab_round_ads", "render_id", args.renderId)).filter((ad) => ad.user_id === args.userId);
  const roundIds = [...new Set(ads.map((ad) => String(ad.round_id)))];
  const roundsRes = roundIds.length
    ? await db.from("creative_lab_rounds").select("id, status").in("id", roundIds)
    : { data: [] as Row[], error: null };
  if (roundsRes.error) throw new Error(`creative_lab_rounds: ${roundsRes.error.message}`);
  const rounds = (roundsRes.data ?? []) as Row[];
  if (!renderRoundOpen(rounds.map((round) => String(round.status)))) {
    throw new RenderRetryError(409, "This round has moved on — propose the round again.");
  }

  const queued = await queueRender(db, {
    userId: args.userId,
    clipId: String(render.clip_id),
    captionId: String(render.caption_id),
    styleVersion: String(render.style_version),
  });
  if (queued.id !== args.renderId) throw new Error(`render retry queued ${queued.id}, not ${args.renderId}`);

  const open = rounds.filter((round) => round.status === "draft" || round.status === "rendering");
  for (const round of open) {
    const adUpdate = await db
      .from("creative_lab_round_ads")
      .update({ launch_state: "pending", launch_error: null })
      .eq("render_id", args.renderId)
      .eq("round_id", round.id)
      .eq("launch_state", "render_failed")
      .select("id");
    if (adUpdate.error) throw new Error(`creative_lab_round_ads retry: ${adUpdate.error.message}`);
    if (round.status === "draft" && (adUpdate.data ?? []).length > 0) {
      const roundUpdate = await db.from("creative_lab_rounds").update({ status: "rendering" }).eq("id", round.id).eq("status", "draft");
      if (roundUpdate.error) throw new Error(`creative_lab_rounds retry: ${roundUpdate.error.message}`);
    }
  }
  return { renderId: args.renderId };
}

async function queueRender(
  db: ServiceRoleDb,
  args: { userId: string; clipId: string; captionId: string; styleVersion: string },
): Promise<{ id: string; ready: boolean }> {
  const existing = (await list(db, "creative_lab_renders", "clip_id", args.clipId)).find(
    (row) => row.caption_id === args.captionId && row.style_version === args.styleVersion && row.aspect === "9:16",
  );
  if (existing?.status === "done") return { id: String(existing.id), ready: true };
  if (existing && (existing.status === "queued" || existing.status === "rendering")) return { id: String(existing.id), ready: false };
  if (existing?.status === "failed") {
    const attempt = Number(existing.attempt ?? 1) + 1;
    const update = await db.from("creative_lab_renders").update({ status: "queued", attempt, error: null }).eq("id", existing.id);
    if (update.error) throw new Error(`creative_lab_renders retry: ${update.error.message}`);
    return { id: String(existing.id), ready: false };
  }
  const inserted = await db
    .from("creative_lab_renders")
    .insert({
      user_id: args.userId,
      clip_id: args.clipId,
      caption_id: args.captionId,
      style_version: args.styleVersion,
      aspect: "9:16",
      kind: "video",
      status: "queued",
      attempt: 1,
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) throw new Error(`creative_lab_renders insert: ${inserted.error?.message ?? "no row"}`);
  return { id: String((inserted.data as Row).id), ready: false };
}
