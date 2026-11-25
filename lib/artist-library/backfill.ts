/**
 * lib/artist-library/backfill.ts — what artist_assets should hold (AL2).
 *
 * From what is already stored:
 *   - Lab clips by owner: the artist's own clips (shareable), and promoter
 *     clips that feature the artist (held: "Filmed by {client}");
 *   - Lab renders: shareable only when every clip in them is artist-owned;
 *   - files in the source map (source-map.ts): footage someone confirmed is
 *     the artist's, with the ads it ran as. The footage is shareable; the
 *     ads keep their own show and client;
 *   - ads matched to the artist (match.ts): a Lab render's ads take its
 *     rights; any other ad is the client's (held).
 * Spend and results are never stored: readers take them from
 * ad_daily_insights by meta_ad_id. Archived clients are left out.
 *
 * planArtistAssets is pure; loadBackfillInputs reads prod (service role,
 * paged); writeArtistAssets is the --apply write, upserting on
 * (artist_id, asset_key).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { isArchivedClientStatus } from "../db/client-status.ts";
import { loadAllPaged } from "../db/paged-read.ts";
import { loadAdContextIndex, resolveAdContext, type AdContextIndex } from "../learning/ad-facts.ts";
import { hasFullName, kindFromAd, matchAd, type MatchedBy } from "./match.ts";
import { clientAdRights, clipRights, renderRights, rightsProblem, type Rights } from "./rights.ts";
import type { AssetRow, EventLite, InsightRow } from "./view.ts";
import { EVENT_LITE_COLUMNS } from "./load.ts";
import { SOURCE_MAP, type SourceEntry } from "./source-map.ts";

type Db = Pick<SupabaseClient, "from">;

export interface PlannedAsset extends AssetRow {
  artist_id: string;
  matched_by: MatchedBy;
  launched_ad_id: string | null;
}

/** One ad, from its ad-days: names, account and its last delivery. */
export interface AdSummary {
  meta_ad_id: string;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  ad_account_id: string | null;
  last_date: string;
}

export interface BackfillInputs {
  artists: { id: string; name: string }[];
  links: { event_id: string; artist_id: string }[];
  events: (EventLite & { meta_campaign_id?: string | null })[];
  clients: { id: string; name: string; status: string | null }[];
  labArtists: { id: string; client_id: string; artist_id: string | null }[];
  clips: { id: string; artist_id: string | null; owner: string | null; event_id: string | null; shown_on_event_id: string | null; creative_asset_id: string | null; created_at: string; ig_posted_at: string | null }[];
  clipFeatures: { clip_id: string; artist_id: string }[];
  creativeAssets: { id: string; filename: string | null; drive_file_id: string | null }[];
  renders: { id: string; clip_id: string; caption_id: string | null; status: string; drive_file_id: string | null; drive_file_name: string | null; created_at: string }[];
  captions: { id: string; event_id: string | null }[];
  roundAds: { id: string; render_id: string | null; round_id: string }[];
  rounds: { id: string; event_id: string }[];
  launches: { round_ad_id: string; meta_ad_id: string }[];
  launchedAds: { id: string; meta_ad_id: string; media_type: string | null }[];
  tags: { meta_ad_id: string | null; creative_name: string }[];
  ads: AdSummary[];
  insights: InsightRow[];
  context: AdContextIndex;
  /** Confirmed sources (source-map.ts). */
  sources: readonly SourceEntry[];
}

export interface ArtistPlan {
  artist: { id: string; name: string };
  rows: PlannedAsset[];
  skipped: { archived: number; noClient: number };
}

const blank = (artistId: string): Omit<PlannedAsset, "asset_key" | "kind" | "owner_kind" | "shareable" | "held_reason" | "matched_by"> => ({
  artist_id: artistId,
  name: null,
  drive_file_id: null,
  caption_text: null,
  source_event_id: null,
  source_client_id: null,
  approved_by: null,
  approved_at: null,
  lab_clip_id: null,
  lab_render_id: null,
  meta_ad_id: null,
  launched_ad_id: null,
  material_at: null,
});

const withRights = (r: Rights) => ({ owner_kind: r.ownerKind, shareable: r.shareable, held_reason: r.heldReason, source_client_id: r.clientId });

export function planArtistAssets(inputs: BackfillInputs, artist: { id: string; name: string }): ArtistPlan {
  const archived = new Set(inputs.clients.filter((c) => isArchivedClientStatus(c.status)).map((c) => c.id));
  const eventById = new Map(inputs.events.map((e) => [e.id, e]));
  const labOf = new Map(inputs.labArtists.map((l) => [l.id, l]));
  const assetById = new Map(inputs.creativeAssets.map((a) => [a.id, a]));
  const clipById = new Map(inputs.clips.map((c) => [c.id, c]));
  const captionEvent = new Map(inputs.captions.map((c) => [c.id, c.event_id]));
  const linked = new Set(inputs.links.filter((l) => l.artist_id === artist.id).map((l) => l.event_id));
  const rows: PlannedAsset[] = [];
  const skipped = { archived: 0, noClient: 0 };
  const keep = (row: PlannedAsset) => {
    if (row.source_client_id && archived.has(row.source_client_id)) {
      skipped.archived += 1;
      return;
    }
    const problem = rightsProblem({ ownerKind: row.owner_kind, shareable: row.shareable, heldReason: row.held_reason, clientId: row.source_client_id });
    if (problem) {
      skipped.noClient += 1;
      return;
    }
    rows.push(row);
  };

  // ─── Confirmed sources: the footage itself ──────────────────────────────
  const sources = inputs.sources.filter((e) => e.artistId === artist.id);
  const sourceByFile = new Map(sources.map((e) => [e.driveFileId, e]));
  for (const entry of sources) {
    keep({
      ...blank(artist.id),
      asset_key: `drive:${entry.driveFileId}`,
      kind: entry.kind,
      name: entry.name,
      drive_file_id: entry.driveFileId,
      matched_by: "drive",
      ...withRights({ ownerKind: entry.ownerKind, shareable: true, heldReason: null, clientId: null }),
    });
  }

  // ─── Lab clips: the artist's own, and promoter clips featuring them ─────
  const ownLab = new Set(inputs.labArtists.filter((l) => l.artist_id === artist.id).map((l) => l.id));
  const featured = new Set(inputs.clipFeatures.filter((f) => ownLab.has(f.artist_id)).map((f) => f.clip_id));
  const artistClips = new Set<string>();
  const confirmedClips = new Set<string>();
  for (const clip of inputs.clips) {
    const own = clip.artist_id != null && ownLab.has(clip.artist_id);
    if (!own && !featured.has(clip.id)) continue;
    artistClips.add(clip.id);
    const lab = clip.artist_id ? labOf.get(clip.artist_id) : null;
    const eventId = clip.event_id ?? clip.shown_on_event_id;
    const clientId = lab?.client_id ?? (eventId ? eventById.get(eventId)?.client_id ?? null : null);
    const file = clip.creative_asset_id ? assetById.get(clip.creative_asset_id) : undefined;
    // A clip whose file is in the source map is the artist's, whatever the Lab recorded.
    const confirmed = Boolean(file?.drive_file_id && sourceByFile.has(file.drive_file_id));
    if (confirmed) confirmedClips.add(clip.id);
    keep({
      ...blank(artist.id),
      asset_key: `clip:${clip.id}`,
      kind: "clip",
      name: file?.filename ?? null,
      drive_file_id: file?.drive_file_id ?? null,
      source_event_id: eventId,
      lab_clip_id: clip.id,
      material_at: clip.ig_posted_at ?? clip.created_at,
      matched_by: "lab",
      ...withRights(clipRights(confirmed ? "artist" : own ? clip.owner : "promoter", clientId)),
    });
  }

  // ─── Lab renders of those clips ─────────────────────────────────────────
  const renderRightsById = new Map<string, { rights: Rights; eventId: string | null }>();
  for (const render of inputs.renders) {
    if (!artistClips.has(render.clip_id) || render.status !== "done") continue;
    const clip = clipById.get(render.clip_id)!;
    const eventId = (render.caption_id ? captionEvent.get(render.caption_id) : null) ?? clip.event_id ?? clip.shown_on_event_id;
    const lab = clip.artist_id ? labOf.get(clip.artist_id) : null;
    const clientId = (eventId ? eventById.get(eventId)?.client_id : null) ?? lab?.client_id ?? null;
    // A render is shareable only when every clip in it is the artist's own (one clip per render today).
    const ownerOfClip = confirmedClips.has(clip.id) ? "artist" : clip.artist_id && ownLab.has(clip.artist_id) ? clip.owner : "promoter";
    const rights = renderRights([ownerOfClip], clientId);
    renderRightsById.set(render.id, { rights, eventId });
    keep({
      ...blank(artist.id),
      asset_key: `render:${render.id}`,
      kind: "render",
      name: render.drive_file_name,
      drive_file_id: render.drive_file_id,
      source_event_id: eventId,
      lab_render_id: render.id,
      material_at: render.created_at,
      matched_by: "lab",
      ...withRights(rights),
    });
  }

  // ─── Ads ────────────────────────────────────────────────────────────────
  const roundEvent = new Map(inputs.rounds.map((r) => [r.id, r.event_id]));
  const renderOfAd = new Map<string, string>();
  const roundAdById = new Map(inputs.roundAds.map((r) => [r.id, r]));
  for (const l of inputs.launches) {
    const ra = roundAdById.get(l.round_ad_id);
    if (ra?.render_id) renderOfAd.set(l.meta_ad_id, ra.render_id);
  }
  const launched = new Map(inputs.launchedAds.map((a) => [a.meta_ad_id, a]));
  const linkedCampaigns = campaignEvents(inputs.events);
  const tagged = new Set(inputs.tags.filter((t) => t.meta_ad_id && hasFullName(t.creative_name, artist.name)).map((t) => t.meta_ad_id!));
  for (const ad of inputs.ads) {
    const context = adEvent(ad, inputs.context, linkedCampaigns, eventById);
    const renderId = renderOfAd.get(ad.meta_ad_id);
    const lab = renderId ? renderRightsById.get(renderId) : undefined;
    const ledger = launched.get(ad.meta_ad_id);
    if (lab) {
      const ra = inputs.roundAds.find((r) => r.render_id === renderId);
      keep({
        ...blank(artist.id),
        asset_key: `ad:${ad.meta_ad_id}`,
        kind: "render",
        name: ad.ad_name,
        source_event_id: context.eventId ?? lab.eventId ?? (ra ? roundEvent.get(ra.round_id) ?? null : null),
        lab_render_id: renderId!,
        meta_ad_id: ad.meta_ad_id,
        launched_ad_id: ledger?.id ?? null,
        material_at: ad.last_date,
        matched_by: "lab",
        ...withRights(lab.rights),
      });
      continue;
    }
    const how = matchAd(ad, artist.name, { linked: Boolean(context.eventId && linked.has(context.eventId)), tagged: tagged.has(ad.meta_ad_id) });
    // An ad that ran a confirmed file: the footage's rights, the ad's own show and client.
    const code = context.eventId ? eventById.get(context.eventId)?.event_code ?? null : null;
    const ranFile = sources.find((e) => e.ranAs.eventCode === code && ad.ad_name != null && e.ranAs.adNames.includes(ad.ad_name));
    if (ranFile) {
      keep({
        ...blank(artist.id),
        asset_key: `ad:${ad.meta_ad_id}`,
        kind: ranFile.kind,
        name: ad.ad_name,
        drive_file_id: ranFile.driveFileId,
        source_event_id: context.eventId,
        meta_ad_id: ad.meta_ad_id,
        launched_ad_id: ledger?.id ?? null,
        material_at: ad.last_date,
        matched_by: how ?? "drive",
        ...withRights({ ownerKind: ranFile.ownerKind, shareable: true, heldReason: null, clientId: context.clientId }),
      });
      continue;
    }
    if (!how) continue;
    const clientId = context.clientId;
    const kind = kindFromAd(ledger?.media_type, ad.ad_name);
    keep({
      ...blank(artist.id),
      asset_key: `ad:${ad.meta_ad_id}`,
      kind,
      name: ad.ad_name,
      source_event_id: context.eventId,
      meta_ad_id: ad.meta_ad_id,
      launched_ad_id: ledger?.id ?? null,
      material_at: ad.last_date,
      matched_by: how,
      ...withRights(clientAdRights(kind, clientId)),
    });
  }
  return { artist, rows, skipped };
}

/**
 * events.meta_campaign_id (comma-separated) links campaigns to an event by
 * hand. A campaign linked to exactly one event goes to it.
 */
export function campaignEvents(events: readonly { id: string; meta_campaign_id?: string | null }[]): Map<string, string> {
  const owners = new Map<string, Set<string>>();
  for (const e of events) {
    for (const id of String(e.meta_campaign_id ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
      (owners.get(id) ?? owners.set(id, new Set()).get(id)!).add(e.id);
    }
  }
  const out = new Map<string, string>();
  for (const [campaign, ids] of owners) if (ids.size === 1) out.set(campaign, [...ids][0]!);
  return out;
}

/**
 * The ad's event: a campaign linked to an event by hand wins (an operator
 * said which show it is), then resolveAdContext's ledger and [CODE] order.
 */
export function adEvent(
  ad: Pick<AdSummary, "meta_ad_id" | "meta_adset_id" | "meta_campaign_id" | "campaign_name" | "ad_account_id">,
  context: AdContextIndex,
  linkedCampaigns: ReadonlyMap<string, string>,
  eventById: ReadonlyMap<string, { client_id: string | null }>,
): { eventId: string | null; clientId: string | null } {
  const byHand = ad.meta_campaign_id ? linkedCampaigns.get(ad.meta_campaign_id) : undefined;
  if (byHand) return { eventId: byHand, clientId: eventById.get(byHand)?.client_id ?? null };
  const resolved = resolveAdContext({ meta_ad_id: ad.meta_ad_id, meta_adset_id: ad.meta_adset_id, campaign_name: ad.campaign_name, ad_account_id: ad.ad_account_id }, context);
  return { eventId: resolved.eventId, clientId: resolved.clientId ?? (resolved.eventId ? eventById.get(resolved.eventId)?.client_id ?? null : null) };
}

/** One summary per ad from its ad-days (names from the latest day). */
export function summariseAds(insights: readonly (InsightRow & { meta_adset_id: string | null; meta_campaign_id?: string | null; ad_name: string | null; adset_name: string | null; ad_account_id: string | null })[]): AdSummary[] {
  const by = new Map<string, AdSummary>();
  for (const r of insights) {
    const have = by.get(r.meta_ad_id);
    if (!have || r.date > have.last_date) {
      by.set(r.meta_ad_id, {
        meta_ad_id: r.meta_ad_id,
        meta_adset_id: r.meta_adset_id ?? have?.meta_adset_id ?? null,
        meta_campaign_id: r.meta_campaign_id ?? have?.meta_campaign_id ?? null,
        ad_name: r.ad_name ?? have?.ad_name ?? null,
        adset_name: r.adset_name ?? have?.adset_name ?? null,
        campaign_name: r.campaign_name ?? have?.campaign_name ?? null,
        ad_account_id: r.ad_account_id ?? have?.ad_account_id ?? null,
        last_date: r.date,
      });
    }
  }
  return [...by.values()];
}

/** Every table the plan reads, paged (service role). Reads only; no Meta call. */
export async function loadBackfillInputs(db: Db): Promise<BackfillInputs> {
  const page = <T extends object>(table: string, columns: string) => loadAllPaged<T>(db, table, columns, ["id"]);
  const [artists, links, events, clients, labArtists, clips, clipFeatures, creativeAssets, renders, captions, roundAds, rounds, launches, launchedAds, tags, insightDays, context] =
    await Promise.all([
      page<{ id: string; name: string }>("artists", "id, name"),
      page<{ id: string; event_id: string; artist_id: string }>("event_artists", "id, event_id, artist_id"),
      page<EventLite & { meta_campaign_id: string | null }>("events", `${EVENT_LITE_COLUMNS}, meta_campaign_id`),
      page<{ id: string; name: string; status: string | null }>("clients", "id, name, status"),
      page<{ id: string; client_id: string; artist_id: string | null }>("creative_lab_artists", "id, client_id, artist_id"),
      page<BackfillInputs["clips"][number]>("creative_lab_clips", "id, artist_id, owner, event_id, shown_on_event_id, creative_asset_id, created_at, ig_posted_at"),
      loadAllPaged<{ clip_id: string; artist_id: string }>(db, "creative_lab_clip_features", "clip_id, artist_id", ["clip_id", "artist_id"]),
      page<BackfillInputs["creativeAssets"][number]>("creative_assets", "id, filename, drive_file_id"),
      page<BackfillInputs["renders"][number]>("creative_lab_renders", "id, clip_id, caption_id, status, drive_file_id, drive_file_name, created_at"),
      page<{ id: string; event_id: string | null }>("creative_lab_captions", "id, event_id"),
      page<BackfillInputs["roundAds"][number]>("creative_lab_round_ads", "id, render_id, round_id"),
      page<BackfillInputs["rounds"][number]>("creative_lab_rounds", "id, event_id"),
      page<{ id: string; round_ad_id: string; meta_ad_id: string }>("creative_lab_round_ad_launches", "id, round_ad_id, meta_ad_id"),
      page<BackfillInputs["launchedAds"][number]>("launched_ads", "id, meta_ad_id, media_type"),
      page<{ id: string; meta_ad_id: string | null; creative_name: string }>("creative_tag_assignments", "id, meta_ad_id, creative_name"),
      page<InsightRow & { id: string; meta_adset_id: string | null; meta_campaign_id: string | null; ad_name: string | null; adset_name: string | null; ad_account_id: string | null }>(
        "ad_daily_insights",
        "id, meta_ad_id, meta_adset_id, meta_campaign_id, ad_name, adset_name, campaign_name, campaign_objective, ad_account_id, date, spend, registrations, purchases",
      ),
      loadAdContextIndex(db),
    ]);
  return {
    artists,
    links,
    events,
    clients,
    labArtists,
    clips,
    clipFeatures,
    creativeAssets,
    renders,
    captions,
    roundAds,
    rounds,
    launches,
    launchedAds,
    tags,
    ads: summariseAds(insightDays),
    insights: insightDays,
    context,
    sources: SOURCE_MAP,
  };
}

/** --apply: upsert the plan's rows on (artist_id, asset_key), 500 a call. Returns rows written. */
export async function writeArtistAssets(db: Db, rows: readonly PlannedAsset[], now: Date): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: now.toISOString() }));
    const res = await db.from("artist_assets").upsert(batch, { onConflict: "artist_id,asset_key" });
    if (res.error) throw new Error(`artist_assets upsert: ${res.error.message}`);
    written += batch.length;
  }
  return written;
}
