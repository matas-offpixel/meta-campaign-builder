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
 *     rights; an ad whose ad name (or ad set name) names the artist is the
 *     client's (held). An ad naming no artist is a general ad: it goes to
 *     the show's headliners (the artist the show's code or name names, or
 *     both co-headliners when it names two; matched_by event_artists, held
 *     like any client ad) and to no one else. A show naming none, or three
 *     or more, keeps it in the general bucket (planGeneral). Supports never
 *     get general ads. A co-headline row carries no mark of its own (269's
 *     CHECK has no value for it): isCoHeadline derives it from the show's
 *     headliners, and show / client totals count a shared ad once
 *     (view.ts showTotals).
 * Spend and results are never stored: readers take them from
 * ad_daily_insights by meta_ad_id. Archived clients are left out.
 *
 * planArtistAssets is pure; loadBackfillInputs reads prod (service role,
 * paged); writeArtistAssets is the --apply write, upserting on
 * (artist_id, asset_key). planRemovals says which of an artist's stored
 * rows the plan no longer gives them; deleteArtistAssets removes those
 * (--apply, named artists only). A row of a file the source map makes
 * shareable, and a Drive drop (drive:), are never removed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { isArchivedClientStatus } from "../db/client-status.ts";
import { loadAllPaged } from "../db/paged-read.ts";
import { loadAdContextIndex, resolveAdContext, type AdContextIndex } from "../learning/ad-facts.ts";
import { AD_NAME_ONLY, ALIASES, BRANDS, OTHER_ACTS, type AliasEntry, type NameMark, type OtherAct } from "./aliases.ts";
import { artistsOfAd, buildRoster, fold, headlinerOf, isClipIdentity, kindFromAd, type Headliners, type MatchedBy, type NamedField, type Roster } from "./match.ts";
import { clientAdRights, clipRights, renderRights, rightsProblem, type Rights } from "./rights.ts";
import type { AssetRow, EventLite, InsightRow } from "./view.ts";
import { EVENT_LITE_COLUMNS } from "./load.ts";
import { SOURCE_MAP, sourceMapShareableFiles, type SourceEntry } from "./source-map.ts";

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
  /** The Lab's artists; `name` is what the operator called them for that client (an alias when it differs). */
  labArtists: { id: string; client_id: string; artist_id: string | null; name?: string | null }[];
  clips: { id: string; artist_id: string | null; owner: string | null; event_id: string | null; shown_on_event_id: string | null; creative_asset_id: string | null; created_at: string; ig_posted_at: string | null }[];
  clipFeatures: { clip_id: string; artist_id: string }[];
  creativeAssets: { id: string; filename: string | null; drive_file_id: string | null }[];
  renders: { id: string; clip_id: string; caption_id: string | null; status: string; drive_file_id: string | null; drive_file_name: string | null; created_at: string }[];
  captions: { id: string; event_id: string | null }[];
  roundAds: { id: string; render_id: string | null; round_id: string }[];
  rounds: { id: string; event_id: string }[];
  launches: { round_ad_id: string; meta_ad_id: string }[];
  launchedAds: { id: string; meta_ad_id: string; media_type: string | null }[];
  ads: AdSummary[];
  insights: InsightRow[];
  context: AdContextIndex;
  /** Confirmed sources (source-map.ts). */
  sources: readonly SourceEntry[];
  /** Confirmed aliases (aliases.ts ALIASES; never the proposals list). */
  aliases: readonly AliasEntry[];
  /** Brands, ad-name-only names and other acts (aliases.ts). */
  marks: { brands: readonly NameMark[]; adNameOnly: readonly NameMark[]; otherActs: readonly OtherAct[] };
}

/** The marks the loader uses: aliases.ts as checked in. */
export const NAME_MARKS: BackfillInputs["marks"] = { brands: BRANDS, adNameOnly: AD_NAME_ONLY, otherActs: OTHER_ACTS };

export interface ArtistPlan {
  artist: { id: string; name: string };
  rows: PlannedAsset[];
  skipped: { archived: number; noClient: number };
  /** Which field named the artist, per ad row matched by name (ad or ad set): for the dry run. */
  namedIn: Map<string, NamedField>;
}

/** Every name an artist goes by: their own, recorded aliases, and the Lab's names for them. */
export function artistNames(inputs: Pick<BackfillInputs, "aliases" | "labArtists">, artist: { id: string; name: string }): string[] {
  const out = [artist.name, ...inputs.aliases.filter((a) => a.artistId === artist.id).map((a) => a.alias)];
  for (const l of inputs.labArtists) if (l.artist_id === artist.id && l.name) out.push(l.name);
  return [...new Map(out.map((n) => [fold(n), n])).values()];
}

interface NamesIndex {
  roster: Roster;
  byAd: Map<string, { artistIds: string[]; field: NamedField | null }>;
  /** Each show's headliner, or the artists its code or name names when there are two or more. */
  headliners: Map<string, Headliners>;
}
const rosterCache = new WeakMap<object, NamesIndex>();

/**
 * The roster (artists less brands, with their confirmed aliases and Lab
 * names; ad-name-only names marked; other acts with no row), who every ad
 * names, and every show's headliner. Worked out once per inputs.
 */
export function adNamesIndex(inputs: BackfillInputs): NamesIndex {
  let hit = rosterCache.get(inputs);
  if (!hit) {
    const brands = new Set(inputs.marks.brands.map((b) => b.artistId));
    const adNameOnly = new Set(inputs.marks.adNameOnly.map((b) => b.artistId));
    const roster = buildRoster([
      ...inputs.artists
        .filter((a) => !brands.has(a.id))
        .map((a) => ({
          id: a.id,
          names: artistNames(inputs, a),
          adNameOnly: adNameOnly.has(a.id),
          notForShows: inputs.aliases.filter((x) => x.artistId === a.id && x.notForShows).map((x) => x.alias),
        })),
      ...inputs.marks.otherActs.map((o) => ({ id: `act:${fold(o.name).trim()}`, names: [o.name], noRow: true })),
    ]);
    const byAd = new Map(inputs.ads.map((ad) => [ad.meta_ad_id, artistsOfAd(ad, roster)]));
    const headliners = new Map(inputs.events.map((e) => [e.id, headlinerOf(e, roster)]));
    hit = { roster, byAd, headliners };
    rosterCache.set(inputs, hit);
  }
  return hit;
}

/** The Meta ads a Lab round launched, by render: these keep the render's owner link. */
function labAdRenders(inputs: BackfillInputs): Map<string, string> {
  const renderOfAd = new Map<string, string>();
  const roundAdById = new Map(inputs.roundAds.map((r) => [r.id, r]));
  for (const l of inputs.launches) {
    const ra = roundAdById.get(l.round_ad_id);
    if (ra?.render_id) renderOfAd.set(l.meta_ad_id, ra.render_id);
  }
  return renderOfAd;
}

/** The source entry an ad ran, if any: the entry's show, and the ad name is the file's clip identity. */
function sourceOfAd(
  sources: readonly SourceEntry[],
  ad: AdSummary,
  code: string | null,
  clientName: string | null,
  namesOf: (artistId: string) => string[],
): SourceEntry | undefined {
  return sources.find((e) => e.ranAs.eventCode === code && isClipIdentity(ad.ad_name, e.ranAs.clip, namesOf(e.artistId), clientName));
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
  const rows: PlannedAsset[] = [];
  const namedIn = new Map<string, NamedField>();
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
  const renderOfAd = labAdRenders(inputs);
  const launched = new Map(inputs.launchedAds.map((a) => [a.meta_ad_id, a]));
  const linkedCampaigns = campaignEvents(inputs.events);
  const { byAd, headliners } = adNamesIndex(inputs);
  const clientNameOf = new Map(inputs.clients.map((c) => [c.id, c.name]));
  const names = artistNames(inputs, artist);
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
    const named = byAd.get(ad.meta_ad_id);
    const byName: MatchedBy | null = named?.artistIds.includes(artist.id) ? "ad_name" : null;
    // An ad that ran a confirmed file: the footage's rights, the ad's own show and client.
    const code = context.eventId ? eventById.get(context.eventId)?.event_code ?? null : null;
    const ranFile = sourceOfAd(sources, ad, code, context.clientId ? clientNameOf.get(context.clientId) ?? null : null, () => names);
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
        matched_by: byName ?? "drive",
        ...withRights({ ownerKind: ranFile.ownerKind, shareable: true, heldReason: null, clientId: context.clientId }),
      });
      continue;
    }
    // A general ad (naming no one) is the headliner's, and only theirs.
    const how: MatchedBy | null = byName ?? (!named?.artistIds.length && context.eventId && headliners.get(context.eventId)?.artistIds.includes(artist.id) ? "event_artists" : null);
    if (!how) continue;
    if (byName && named?.field) namedIn.set(`ad:${ad.meta_ad_id}`, named.field);
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
  return { artist, rows, skipped, namedIn };
}

/** One show's general bucket: its ads that name no artist (not Lab, not a source file). */
export interface GeneralBucket {
  eventId: string;
  code: string | null;
  clientId: string | null;
  /** Artists on the bill (event_artists). */
  bill: number;
  ads: number;
  /** Distinct ad names (copies folded), with their ad counts. */
  files: Map<string, number>;
}

/**
 * The general bucket per show: every ad on a show with a bill and no
 * headliner that names no artist (nor another act) in its ad or ad set
 * name. A show with a headliner gives these to the headliner instead. Not
 * stored (artist_assets is per artist): the dry run prints it.
 */
export function planGeneral(inputs: BackfillInputs): GeneralBucket[] {
  const archived = new Set(inputs.clients.filter((c) => isArchivedClientStatus(c.status)).map((c) => c.id));
  const eventById = new Map(inputs.events.map((e) => [e.id, e]));
  const bill = new Map<string, number>();
  for (const l of inputs.links) bill.set(l.event_id, (bill.get(l.event_id) ?? 0) + 1);
  const renderOfAd = labAdRenders(inputs);
  const linkedCampaigns = campaignEvents(inputs.events);
  const { byAd, headliners } = adNamesIndex(inputs);
  const clientNameOf = new Map(inputs.clients.map((c) => [c.id, c.name]));
  const artistById = new Map(inputs.artists.map((a) => [a.id, a]));
  const namesOf = (id: string) => (artistById.get(id) ? artistNames(inputs, artistById.get(id)!) : []);
  const out = new Map<string, GeneralBucket>();
  for (const ad of inputs.ads) {
    if (renderOfAd.has(ad.meta_ad_id) || byAd.get(ad.meta_ad_id)?.artistIds.length) continue;
    const context = adEvent(ad, inputs.context, linkedCampaigns, eventById);
    if (!context.eventId || !bill.has(context.eventId) || headliners.get(context.eventId)?.artistIds.length) continue;
    if (context.clientId && archived.has(context.clientId)) continue;
    const code = eventById.get(context.eventId)?.event_code ?? null;
    if (sourceOfAd(inputs.sources, ad, code, context.clientId ? clientNameOf.get(context.clientId) ?? null : null, namesOf)) continue;
    let b = out.get(context.eventId);
    if (!b) out.set(context.eventId, (b = { eventId: context.eventId, code, clientId: context.clientId, bill: bill.get(context.eventId)!, ads: 0, files: new Map() }));
    b.ads += 1;
    const file = (ad.ad_name ?? "(no name)").replace(/\s+[–-]\s+Copy(?:\s+\d+)?$/gi, "").trim();
    b.files.set(file, (b.files.get(file) ?? 0) + 1);
  }
  return [...out.values()].sort((a, b) => b.ads - a.ads || String(a.code).localeCompare(String(b.code)));
}

type ShowNames = { eventId: string; code: string | null; name: string | null; artistIds: string[] };

/** Shows named for two acts: both co-headline and share the general ads. */
export function coHeadlinedShows(inputs: BackfillInputs): ShowNames[] {
  const { headliners } = adNamesIndex(inputs);
  return inputs.events
    .filter((e) => headliners.get(e.id)?.artistIds.length === 2)
    .map((e) => ({ eventId: e.id, code: e.event_code, name: e.name, artistIds: headliners.get(e.id)!.artistIds }));
}

/** Shows whose code or name names three or more artists: no headliner, their general ads stay general. */
export function crowdedHeadliners(inputs: BackfillInputs): ShowNames[] {
  const { headliners } = adNamesIndex(inputs);
  return inputs.events
    .filter((e) => (headliners.get(e.id)?.crowded.length ?? 0) > 0)
    .map((e) => ({ eventId: e.id, code: e.event_code, name: e.name, artistIds: headliners.get(e.id)!.crowded }));
}

/** A planned or stored row that came to the artist as a co-headliner: derived, never stored. */
export function isCoHeadline(row: Pick<AssetRow, "source_event_id"> & { matched_by?: string | null }, headliners: ReadonlyMap<string, Headliners>): boolean {
  return row.matched_by === "event_artists" && Boolean(row.source_event_id) && headliners.get(row.source_event_id!)?.artistIds.length === 2;
}

/** A stored artist_assets row, as much as a removal needs. */
export interface StoredAsset {
  id: string;
  artist_id: string;
  asset_key: string;
  name: string | null;
  kind: string;
  shareable: boolean;
  drive_file_id: string | null;
}

/** The keys the backfill writes (ad, Lab clip, Lab render). A drive: row may be a library drop (AL4), so it is never the backfill's to remove. */
const BACKFILL_KEY = /^(ad|clip|render):/;

/**
 * Which of an artist's stored rows the new plan no longer gives them. Only
 * backfill keys; never a shareable row of a file the source map makes the
 * artist's, whatever the plan says.
 */
export function planRemovals(stored: readonly StoredAsset[], plan: Pick<ArtistPlan, "artist" | "rows">, sources: readonly SourceEntry[]): StoredAsset[] {
  const planned = new Set(plan.rows.map((r) => r.asset_key));
  const protectedFiles = sourceMapShareableFiles(sources, plan.artist.id);
  return stored.filter(
    (r) =>
      r.artist_id === plan.artist.id &&
      BACKFILL_KEY.test(r.asset_key) &&
      !planned.has(r.asset_key) &&
      !(r.shareable && r.drive_file_id && protectedFiles.has(r.drive_file_id)),
  );
}

/** An artist's stored rows (service role, paged). Reads only. */
export async function loadStoredAssets(db: Db, artistId: string): Promise<StoredAsset[]> {
  return loadAllPaged<StoredAsset>(db, "artist_assets", "id, artist_id, asset_key, name, kind, shareable, drive_file_id", ["id"], (q) => q.eq("artist_id", artistId));
}

/** --apply: delete these rows of one artist from artist_assets, 200 a call. Returns rows deleted. No Drive, no Meta. */
export async function deleteArtistAssets(db: Db, artistId: string, rows: readonly StoredAsset[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const ids = rows.slice(i, i + 200).map((r) => r.id);
    const res = await db.from("artist_assets").delete({ count: "exact" }).eq("artist_id", artistId).in("id", ids);
    if (res.error) throw new Error(`artist_assets delete: ${res.error.message}`);
    deleted += res.count ?? 0;
  }
  return deleted;
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
  const [artists, links, events, clients, labArtists, clips, clipFeatures, creativeAssets, renders, captions, roundAds, rounds, launches, launchedAds, insightDays, context] =
    await Promise.all([
      page<{ id: string; name: string }>("artists", "id, name"),
      page<{ id: string; event_id: string; artist_id: string }>("event_artists", "id, event_id, artist_id"),
      page<EventLite & { meta_campaign_id: string | null }>("events", `${EVENT_LITE_COLUMNS}, meta_campaign_id`),
      page<{ id: string; name: string; status: string | null }>("clients", "id, name, status"),
      page<{ id: string; client_id: string; artist_id: string | null; name: string | null }>("creative_lab_artists", "id, client_id, artist_id, name"),
      page<BackfillInputs["clips"][number]>("creative_lab_clips", "id, artist_id, owner, event_id, shown_on_event_id, creative_asset_id, created_at, ig_posted_at"),
      loadAllPaged<{ clip_id: string; artist_id: string }>(db, "creative_lab_clip_features", "clip_id, artist_id", ["clip_id", "artist_id"]),
      page<BackfillInputs["creativeAssets"][number]>("creative_assets", "id, filename, drive_file_id"),
      page<BackfillInputs["renders"][number]>("creative_lab_renders", "id, clip_id, caption_id, status, drive_file_id, drive_file_name, created_at"),
      page<{ id: string; event_id: string | null }>("creative_lab_captions", "id, event_id"),
      page<BackfillInputs["roundAds"][number]>("creative_lab_round_ads", "id, render_id, round_id"),
      page<BackfillInputs["rounds"][number]>("creative_lab_rounds", "id, event_id"),
      page<{ id: string; round_ad_id: string; meta_ad_id: string }>("creative_lab_round_ad_launches", "id, round_ad_id, meta_ad_id"),
      page<BackfillInputs["launchedAds"][number]>("launched_ads", "id, meta_ad_id, media_type"),
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
    ads: summariseAds(insightDays),
    insights: insightDays,
    context,
    sources: SOURCE_MAP,
    aliases: ALIASES,
    marks: NAME_MARKS,
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
