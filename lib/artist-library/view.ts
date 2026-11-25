/**
 * lib/artist-library/view.ts — one artist, as AL2 and AL5 read it.
 *
 * Shows across clients (spend on the artist's matched ads only), the files
 * grouped and ranked per stage, captions, and the rights for an event.
 * get_artist and the backfill's dry run both print from this, so the dry
 * run shows exactly what a thread would get.
 *
 * Pure: the rows come in, nothing goes out.
 */
import { phaseOf } from "../learning/findings/phase.ts";
import { isShowWeek } from "../onsale-refresh/on-sale.ts";
import { codeInName, rankedStageOf, stageResult } from "./match.ts";
import { usableOn, type AssetKind, type HeldReason, type OwnerKind } from "./rights.ts";
import { RANKED_STAGES, type RankedStage, type ShowPhase } from "./words.ts";

/** An artist_assets row (migration 269), or one the backfill plans. */
export interface AssetRow {
  asset_key: string;
  kind: AssetKind;
  name: string | null;
  drive_file_id: string | null;
  caption_text: string | null;
  source_event_id: string | null;
  source_client_id: string | null;
  owner_kind: OwnerKind;
  shareable: boolean;
  held_reason: HeldReason | null;
  approved_by: string | null;
  approved_at: string | null;
  lab_clip_id: string | null;
  lab_render_id: string | null;
  meta_ad_id: string | null;
  material_at: string | null;
}

/** One ad-day of ad_daily_insights: the columns the library reads. */
export interface InsightRow {
  meta_ad_id: string;
  date: string;
  spend: number | string | null;
  registrations: number | string | null;
  purchases: number | string | null;
  campaign_name: string | null;
  campaign_objective: string | null;
}

export interface EventLite {
  id: string;
  name: string | null;
  event_code: string | null;
  client_id: string | null;
  event_date: string | null;
  venue_name: string | null;
  venue_city: string | null;
  announcement_at: string | null;
  presale_at: string | null;
  general_sale_at: string | null;
  status: string | null;
}

export interface ClientLite {
  id: string;
  name: string;
}

/** An ad under this spend at a stage isn't ranked (AL2's note: "An ad under £{min} spent isn't ranked"). */
export const MIN_RANK_SPEND_GBP = 20;
/** Results of prior weight when shrinking a cost per result towards the stage's pooled cost. */
export const SHRINK_RESULTS = 5;
/** Newest material older than this sends the thread to Instagram first (AL5). */
export const STALE_MONTHS = 6;

export interface StageFigures {
  spend: number;
  results: number;
  ads: number;
}

export interface AssetGroup {
  key: string;
  kind: Exclude<AssetKind, "caption">;
  name: string;
  driveFileId: string | null;
  eventId: string | null;
  code: string | null;
  clientId: string | null;
  ownerKind: OwnerKind;
  shareable: boolean;
  heldReason: HeldReason | null;
  byStage: Partial<Record<RankedStage, StageFigures>>;
  /** It ran as at least one ad. */
  ran: boolean;
  /** The clients whose shows its ads ran on: a shareable file's results can come from another client's show. */
  resultClientIds: string[];
  newestAt: string | null;
}

export interface RankedEntry {
  group: AssetGroup;
  stage: RankedStage;
  cost: number;
  shrunk: number;
  ads: number;
}

export interface ShowRow {
  eventId: string | null;
  code: string;
  name: string | null;
  clientId: string | null;
  venue: string | null;
  date: string | null;
  /** Null when no phase is known (no dates), or for a code with no event. */
  phase: ShowPhase | null;
  spend: number;
  signups: number;
  purchases: number;
  /** A show still to come with no spend: listed, not counted (AL2). */
  comingUp: boolean;
  /** A code found only in ad names: its first and last delivery days. */
  adsOnly: { first: string; last: string } | null;
}

export interface CaptionRow {
  text: string;
  approvedBy: string;
  approvedAt: string;
  clientId: string | null;
  shareable: boolean;
  heldReason: HeldReason | null;
}

export interface ArtistView {
  shows: ShowRow[];
  /** Shows with spend on the artist's ads, and their clients (AL2's counts). */
  counted: { shows: number; clients: number };
  groups: AssetGroup[];
  ranked: Record<RankedStage, RankedEntry[]>;
  captions: CaptionRow[];
  newestAt: string | null;
}

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);

/**
 * A show's phase: "done" once its date has passed (from the next London day),
 * whatever its stored phase; show week from its Monday to the show day; else
 * phaseOf. Null for an upcoming show with no dates to say (the part is left out).
 */
export function showPhase(event: EventLite, today: string): ShowPhase | null {
  const day = event.event_date?.slice(0, 10);
  if (day && day < today) return "done";
  if (day && isShowWeek(day, today)) return "show_week";
  const phase = phaseOf(event, today);
  return phase === "unknown" ? null : phase;
}

/** Which group a row belongs to: a render and its ads are one file; a client ad is one per show and name. */
function groupKey(row: AssetRow): string {
  if (row.lab_render_id) return `render:${row.lab_render_id}`;
  if (row.lab_clip_id) return `clip:${row.lab_clip_id}`;
  if (row.drive_file_id) return `drive:${row.drive_file_id}`;
  return `name:${row.source_event_id ?? row.source_client_id ?? ""}:${(row.name ?? row.asset_key).trim()}`;
}

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

export function buildArtistView(input: {
  assets: readonly AssetRow[];
  insights: readonly InsightRow[];
  events: readonly EventLite[];
  /** Events linked to the artist (event_artists), so a show still to come is listed. */
  linkedEventIds: readonly string[];
  /** The code of a campaign with no event row, by ad: from the campaign name. */
  today: string;
}): ArtistView {
  const eventById = new Map(input.events.map((e) => [e.id, e]));
  const insightsByAd = new Map<string, InsightRow[]>();
  for (const r of input.insights) (insightsByAd.get(r.meta_ad_id) ?? insightsByAd.set(r.meta_ad_id, []).get(r.meta_ad_id)!).push(r);

  // ─── Files ────────────────────────────────────────────────────────────
  const groups = new Map<string, AssetGroup & { adIds: Map<RankedStage, Set<string>> }>();
  const captions: CaptionRow[] = [];
  let newestAt: string | null = null;
  for (const row of input.assets) {
    if (row.kind === "caption") {
      if (row.caption_text && row.approved_by && row.approved_at) {
        captions.push({ text: row.caption_text, approvedBy: row.approved_by, approvedAt: row.approved_at, clientId: row.source_client_id, shareable: row.shareable, heldReason: row.held_reason });
        newestAt = later(newestAt, row.approved_at);
      }
      continue;
    }
    const key = groupKey(row);
    const event = row.source_event_id ? eventById.get(row.source_event_id) : undefined;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        kind: row.kind,
        name: (row.name ?? "").trim() || row.asset_key,
        driveFileId: row.drive_file_id,
        eventId: row.source_event_id,
        code: event?.event_code ?? null,
        clientId: row.source_client_id,
        ownerKind: row.owner_kind,
        shareable: row.shareable,
        heldReason: row.held_reason,
        byStage: {},
        ran: false,
        resultClientIds: [],
        newestAt: null,
        adIds: new Map(),
      };
      groups.set(key, group);
    }
    // A file row (no ad) names the file; an ad row only fills what's missing.
    if (!row.meta_ad_id) {
      if (row.name?.trim()) group.name = row.name.trim();
      if (row.drive_file_id) group.driveFileId = row.drive_file_id;
    } else if (!group.driveFileId && row.drive_file_id) group.driveFileId = row.drive_file_id;
    // The least permissive row of a group decides its rights.
    if (!row.shareable && group.shareable) {
      group.shareable = false;
      group.heldReason = row.held_reason;
      group.clientId = row.source_client_id ?? group.clientId;
      group.ownerKind = row.owner_kind;
    }
    group.newestAt = later(group.newestAt, row.material_at);
    if (!row.meta_ad_id) continue;
    group.ran = true;
    const resultClient = row.source_client_id ?? (event?.client_id ?? null);
    if (resultClient && !group.resultClientIds.includes(resultClient)) group.resultClientIds.push(resultClient);
    for (const day of insightsByAd.get(row.meta_ad_id) ?? []) {
      const stage = rankedStageOf(day.campaign_name, day.campaign_objective);
      if (!group.code) group.code = codeInName(day.campaign_name);
      group.newestAt = later(group.newestAt, day.date);
      if (!stage) continue;
      const f = (group.byStage[stage] ??= { spend: 0, results: 0, ads: 0 });
      f.spend += num(day.spend);
      f.results += stageResult(stage, { registrations: num(day.registrations), purchases: num(day.purchases) });
      const ads = group.adIds.get(stage) ?? group.adIds.set(stage, new Set()).get(stage)!;
      ads.add(row.meta_ad_id);
      f.ads = ads.size;
    }
  }
  for (const g of groups.values()) newestAt = later(newestAt, g.newestAt);

  // ─── Ranking: shrunk towards the stage's pooled cost; the actual cost is shown ─
  const ranked = {} as Record<RankedStage, RankedEntry[]>;
  for (const stage of RANKED_STAGES) {
    const eligible = [...groups.values()].filter((g) => {
      const f = g.byStage[stage];
      return f && f.spend >= MIN_RANK_SPEND_GBP && f.results > 0;
    });
    const spend = eligible.reduce((s, g) => s + g.byStage[stage]!.spend, 0);
    const results = eligible.reduce((s, g) => s + g.byStage[stage]!.results, 0);
    const pool = results > 0 ? spend / results : 0;
    ranked[stage] = eligible
      .map((g) => {
        const f = g.byStage[stage]!;
        return { group: g, stage, cost: f.spend / f.results, shrunk: (f.spend + SHRINK_RESULTS * pool) / (f.results + SHRINK_RESULTS), ads: f.ads };
      })
      .sort((a, b) => a.shrunk - b.shrunk || a.cost - b.cost || a.group.key.localeCompare(b.group.key));
  }

  // ─── Shows ────────────────────────────────────────────────────────────
  const shows = new Map<string, ShowRow>();
  const showFor = (eventId: string | null, code: string | null, clientId: string | null): ShowRow | null => {
    const event = eventId ? eventById.get(eventId) : undefined;
    const key = event ? `event:${event.id}` : code ? `code:${code}` : null;
    if (!key) return null;
    let show = shows.get(key);
    if (!show) {
      show = {
        eventId: event?.id ?? null,
        code: event?.event_code ?? code ?? "",
        name: event?.name ?? null,
        clientId: event?.client_id ?? clientId,
        venue: event ? [event.venue_name, event.venue_city].filter(Boolean).join(", ") || null : null,
        date: event?.event_date ?? null,
        phase: event ? showPhase(event, input.today) : null,
        spend: 0,
        signups: 0,
        purchases: 0,
        comingUp: false,
        adsOnly: event ? null : { first: "", last: "" },
      };
      shows.set(key, show);
    }
    return show;
  };
  for (const id of input.linkedEventIds) showFor(id, null, null);
  const seenAd = new Set<string>();
  for (const row of input.assets) {
    if (!row.meta_ad_id || seenAd.has(row.meta_ad_id)) continue;
    seenAd.add(row.meta_ad_id);
    for (const day of insightsByAd.get(row.meta_ad_id) ?? []) {
      const show = showFor(row.source_event_id, codeInName(day.campaign_name), row.source_client_id);
      if (!show) continue;
      show.spend += num(day.spend);
      show.signups += num(day.registrations);
      show.purchases += num(day.purchases);
      if (show.adsOnly) {
        if (!show.adsOnly.first || day.date < show.adsOnly.first) show.adsOnly.first = day.date;
        if (!show.adsOnly.last || day.date > show.adsOnly.last) show.adsOnly.last = day.date;
      }
    }
  }
  const list = [...shows.values()].filter((s) => s.code);
  for (const s of list) s.comingUp = s.spend < 0.5 && Boolean(s.date && s.date.slice(0, 10) >= input.today);
  // Newest first: a dated show by its date, an ads-only one by its last delivery.
  list.sort((a, b) => (b.date ?? b.adsOnly?.last ?? "").localeCompare(a.date ?? a.adsOnly?.last ?? "") || a.code.localeCompare(b.code));
  const counted = list.filter((s) => s.spend >= 0.5);
  return {
    shows: list.filter((s) => s.spend >= 0.5 || s.comingUp),
    counted: { shows: counted.length, clients: new Set(counted.map((s) => s.clientId).filter(Boolean)).size },
    groups: [...groups.values()].map((g) => {
      const out: AssetGroup & { adIds?: unknown } = { ...g };
      delete out.adIds;
      return out;
    }),
    ranked,
    captions,
    newestAt,
  };
}

/** What one event may use (AL1, AL5): its own client's material and every shareable file. */
export function forEvent(view: ArtistView, eventClientId: string | null) {
  const usable = (x: { shareable: boolean; clientId: string | null }) => usableOn(x, eventClientId);
  const ranked = {} as Record<RankedStage, RankedEntry[]>;
  for (const stage of RANKED_STAGES) ranked[stage] = view.ranked[stage].filter((r) => usable(r.group));
  // Other files: what hasn't run, such as raw clips and press shots (AL2).
  const other = view.groups.filter((g) => usable(g) && !g.ran).sort((a, b) => a.name.localeCompare(b.name));
  const captions = view.captions.filter(usable);
  // Another client's held material: counted per client, never listed.
  const held = new Map<string, number>();
  for (const g of view.groups) if (!usable(g) && g.clientId) held.set(g.clientId, (held.get(g.clientId) ?? 0) + 1);
  for (const c of view.captions) if (!usable(c) && c.clientId) held.set(c.clientId, (held.get(c.clientId) ?? 0) + 1);
  const newestAt = [...view.groups.filter(usable).map((g) => g.newestAt), ...captions.map((c) => c.approvedAt)].reduce<string | null>(later, null);
  return { ranked, other, captions, held, newestAt };
}

/** Over STALE_MONTHS old on `today`. */
export function isStale(newestAt: string | null, today: string): boolean {
  if (!newestAt) return true;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - STALE_MONTHS);
  return newestAt.slice(0, 10) < d.toISOString().slice(0, 10);
}
