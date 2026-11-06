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
import { nextRoundPlan, type RoundPlanInput } from "./judge.ts";
import type { ServiceRoleDb } from "./load.ts";
import { assertArtistCleared, buildAdName, createRound, type LabArtist } from "./rounds.ts";
import type { CaptionStyle } from "./tags.ts";

export const MAX_ADS_PER_AD_SET = 50;
const MAX_CLIP_SECONDS = 30;

export class RoundBuildError extends Error {
  readonly code: "no_ad_set_record" | "no_destination" | "no_page" | "ad_set_full" | "no_previous_target" | "ad_set_changed";

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
  const start = clip.in_s == null ? 0 : Number(clip.in_s);
  const end = clip.out_s == null ? (asset?.duration_seconds == null ? null : Number(asset.duration_seconds)) : Number(clip.out_s);
  if (end == null || Number.isNaN(end)) return null;
  return end - start;
}

function pageFromDraft(draft: unknown): { pageId: string | null; instagramActorId: string | null } {
  const creatives = (draft as { creatives?: { identity?: { pageId?: string; instagramActorId?: string } }[] } | null)?.creatives ?? [];
  for (const creative of creatives) {
    const pageId = creative.identity?.pageId?.trim();
    if (pageId) return { pageId, instagramActorId: creative.identity?.instagramActorId?.trim() || null };
  }
  return { pageId: null, instagramActorId: null };
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
  if (adSet.draft_id) {
    const draftRes = await db.from("campaign_drafts").select("draft_json").eq("id", String(adSet.draft_id)).maybeSingle();
    if (draftRes.error) throw new Error(`campaign_drafts: ${draftRes.error.message}`);
    const found = pageFromDraft((draftRes.data as { draft_json?: unknown } | null)?.draft_json);
    pageId = found.pageId;
    instagramActorId = found.instagramActorId;
  }
  if (!pageId) {
    throw new RoundBuildError("no_page", `Ad set ${adsetMetaId} has no Page on the draft that launched it.`);
  }
  return {
    adAccountId: String(adSet.ad_account_id),
    metaCampaignId: String(adSet.meta_campaign_id),
    metaAdsetId: adsetMetaId,
    pageId,
    instagramActorId,
    destinationUrl: String(withCopy.destination_url).trim(),
    cta: String(withCopy.cta).trim(),
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
  };
  if (!target.adAccountId || !target.metaCampaignId || !target.metaAdsetId || !target.pageId || !target.destinationUrl || !target.cta) {
    throw new RoundBuildError("no_previous_target", "The previous round has no stored ad set target to copy.");
  }
  return target;
}

type Clip = Row & { seconds: number | null };
type Caption = Row;

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

export async function proposeRound(
  db: ServiceRoleDb,
  args: { userId: string; eventId: string; artistId: string; adsetMetaId: string; maxAds?: number },
): Promise<ProposeRoundResult> {
  const maxAds = args.maxAds ?? 8;
  const artistRes = await db.from("creative_lab_artists").select("id, client_id, name, rights_doc_ref, approved_at, starting_caption").eq("id", args.artistId).maybeSingle();
  if (artistRes.error) throw new Error(`creative_lab_artists: ${artistRes.error.message}`);
  const eventRes = await db.from("events").select("id, client_id").eq("id", args.eventId).maybeSingle();
  if (eventRes.error) throw new Error(`events: ${eventRes.error.message}`);
  const event = eventRes.data as { client_id: string | null } | null;
  if (!event) throw new Error("No event with that id.");
  const artist = artistRes.data as (LabArtist & { starting_caption?: string | null }) | null;
  assertArtistCleared(artist, event.client_id);

  const rounds = (await list(db, "creative_lab_rounds", "event_id", args.eventId))
    .filter((row) => row.artist_id === args.artistId)
    .sort((a, b) => Number(b.round_no) - Number(a.round_no));
  const previous = rounds[0] ?? null;
  const target = previous ? targetFromRound(previous) : await resolveTarget(db, args.adsetMetaId);
  if (previous && target.metaAdsetId !== args.adsetMetaId) {
    throw new RoundBuildError("ad_set_changed", `Round ${Number(previous.round_no) + 1} keeps ad set ${target.metaAdsetId}.`);
  }

  const [clipRows, captionRows, assetRows, artistPages, version] = await Promise.all([
    list(db, "creative_lab_clips", "artist_id", args.artistId),
    list(db, "creative_lab_captions", "event_id", args.eventId),
    list(db, "creative_assets", "user_id", args.userId),
    list(db, "artists", "client_id", artist.client_id),
    styleVersion(),
  ]);
  const assets = new Map(assetRows.map((row) => [String(row.id), row]));
  const clips = clipRows
    .map((clip) => ({ ...clip, seconds: clipSeconds(clip, assets.get(String(clip.creative_asset_id))) }) as Clip)
    .sort((a, b) => Number(a.clip_no) - Number(b.clip_no));
  const approved = captionRows
    .filter((row) => row.status === "approved")
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const artistPage = artistPages.find((row) => String(row.name ?? "").trim().toLowerCase() === artist.name.trim().toLowerCase());
  const hasArtistPage = Boolean(String(artistPage?.meta_page_id ?? "").trim());

  const skipped: { reason: string }[] = [];
  const shortClips = usable(clips, skipped);
  const tickets = await ticketsSoldByEvent(
    db,
    shortClips.flatMap((clip) => (clip.event_id ? [String(clip.event_id)] : [])),
  );
  const pairs = previous
    ? pairsFromPlan(previous, shortClips, approved, hasArtistPage, tickets, skipped, maxAds, db)
    : pairsForFirstRound(artist.starting_caption ?? "", shortClips, approved, hasArtistPage, tickets, skipped, maxAds);

  const planned = await pairs;
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
    })
    .eq("id", round.id);
  if (update.error) throw new Error(`creative_lab_rounds update: ${update.error.message}`);

  return { roundId: round.id, roundNo: round.round_no, status, target, ads: written, skipped };
}

type Pair = { clipId: string; captionId: string; role: "control" | "challenger"; retestOf: string | null };

function allowCaption(caption: Caption, hasArtistPage: boolean, skipped: { reason: string }[]): boolean {
  if (caption.style === "artist_first_person" && !hasArtistPage) {
    skipped.push({ reason: `caption ${caption.caption_no} is artist_first_person and artists.meta_page_id is missing` });
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
  startingCaption: string,
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
  if (!starting) skipped.push({ reason: "the artist's starting caption is not an approved caption" });
  const pairs: Pair[] = [];
  const push = (clip: Clip, caption: Caption, role: Pair["role"]) => {
    if (pairs.length >= maxAds) return;
    if (!allowCaption(caption, hasArtistPage, skipped)) return;
    const blocked = crowdReason(caption, clip, tickets);
    if (blocked) {
      skipped.push({ reason: `caption ${caption.caption_no} on clip ${clip.clip_no}: ${blocked}` });
      return;
    }
    pairs.push({ clipId: String(clip.id), captionId: String(caption.id), role, retestOf: null });
  };
  if (starting) push(controlClip, starting, "control");
  for (const caption of approved) {
    if (pairs.length >= maxAds) break;
    if (starting && caption.id === starting.id) continue;
    if (pairs.filter((pair) => pair.clipId === controlClip.id && pair.role === "challenger").length >= 3) break;
    push(controlClip, caption, "challenger");
  }
  if (starting) {
    for (const clip of clips.slice(1)) {
      if (pairs.length >= maxAds) break;
      push(clip, starting, "challenger");
    }
  }
  return pairs;
}

async function pairsFromPlan(
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
    if (!caption || !allowCaption(caption, hasArtistPage, skipped)) return;
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
