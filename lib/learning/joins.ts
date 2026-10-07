/**
 * Learning loop B joins: one ad-day of ad_daily_insights → client, event,
 * funnel stage, result and creative tags. DB-only; zero Meta calls.
 *
 * - Client / event: `resolveAdContext` (launched_ads → launched_ad_sets →
 *   [EVENT_CODE] in campaign_name). A context with an event but no client
 *   takes the event's client.
 * - Tags: creative_tag_assignments by meta_ad_id when any assignment
 *   carries the ad's id, else by (event_id, creative_name = ad_name) —
 *   creative_name holds the Meta AD name (audit two §5).
 * - Stage: 'registration' before the event's general sale (presale when
 *   there is no general sale date), 'ticket_sale' on or after it. With no
 *   dates, the ad set's phase_at_launch; else 'unknown', which is kept.
 * - Result: registrations in registration, purchases in ticket_sale, none
 *   in unknown.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { dropArchivedClientRows, loadArchivedClientIds } from "../db/client-status.ts";
import { clusterKey } from "../analysis/interest-performance.ts";
import { loadAdContextIndex, resolveAdContext, type AdContextIndex, type AdContextSource } from "./ad-facts.ts";
import { currencyResolver, type CurrencyResolver } from "./currency.ts";

export type Stage = "registration" | "ticket_sale" | "unknown";
export const STAGES: readonly Stage[] = ["registration", "ticket_sale", "unknown"];

export type AdDayRow = {
  ad_account_id: string;
  meta_ad_id: string;
  meta_adset_id: string | null;
  date: string;
  ad_name: string | null;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  reach: number;
  link_clicks: number;
  landing_page_views: number;
  video_plays_3s: number;
  video_plays_p100: number;
  registrations: number;
  purchases: number;
};

export type StageEvent = {
  clientId: string | null;
  generalSaleAt: string | null;
  presaleAt: string | null;
};

const REGISTRATION_PHASES = new Set(["presale", "waiting_list", "signup", "registration"]);
const TICKET_PHASES = new Set(["on_sale", "general_sale"]);

export function stageOf(date: string, event: StageEvent | null | undefined, phaseAtLaunch: string | null | undefined): Stage {
  const boundary = (event?.generalSaleAt ?? event?.presaleAt ?? "").slice(0, 10);
  if (boundary) return date < boundary ? "registration" : "ticket_sale";
  const phase = (phaseAtLaunch ?? "").toLowerCase();
  if (REGISTRATION_PHASES.has(phase)) return "registration";
  if (TICKET_PHASES.has(phase)) return "ticket_sale";
  return "unknown";
}

export function resultOf(stage: Stage, row: Pick<AdDayRow, "registrations" | "purchases">): number | null {
  if (stage === "registration") return Number(row.registrations) || 0;
  if (stage === "ticket_sale") return Number(row.purchases) || 0;
  return null;
}

export type TagAssignment = {
  event_id: string;
  creative_name: string;
  tag_id: string;
  meta_ad_id: string | null;
};

export type TagIndex = {
  byAdId: ReadonlyMap<string, ReadonlySet<string>>;
  byEventName: ReadonlyMap<string, ReadonlySet<string>>;
};

function eventNameKey(eventId: string, name: string): string {
  return `${eventId}|${name.trim()}`;
}

/** `knownTags`: taxonomy tag ids; assignments to any other tag are ignored. */
export function buildTagIndex(assignments: readonly TagAssignment[], knownTags?: ReadonlySet<string>): TagIndex {
  const byAdId = new Map<string, Set<string>>();
  const byEventName = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, tag: string) => {
    const set = map.get(key) ?? new Set<string>();
    set.add(tag);
    map.set(key, set);
  };
  for (const a of assignments) {
    if (knownTags && !knownTags.has(a.tag_id)) continue;
    if (a.meta_ad_id) add(byAdId, a.meta_ad_id, a.tag_id);
    if (a.event_id && a.creative_name) add(byEventName, eventNameKey(a.event_id, a.creative_name), a.tag_id);
  }
  return { byAdId, byEventName };
}

export type TagVia = "meta_ad_id" | "name";

export function tagsForAd(
  metaAdId: string,
  eventId: string | null,
  adName: string | null,
  index: TagIndex,
): { tagIds: string[]; via: TagVia | null } {
  const byId = index.byAdId.get(metaAdId);
  if (byId?.size) return { tagIds: [...byId].sort(), via: "meta_ad_id" };
  const byName = eventId && adName ? index.byEventName.get(eventNameKey(eventId, adName)) : undefined;
  if (byName?.size) return { tagIds: [...byName].sort(), via: "name" };
  return { tagIds: [], via: null };
}

export type LearningFact = {
  row: AdDayRow;
  clientId: string | null;
  eventId: string | null;
  contextSource: AdContextSource | null;
  stage: Stage;
  /** Stage result; null in 'unknown'. */
  result: number | null;
  spendGbp: number;
  tagIds: string[];
  tagVia: TagVia | null;
};

export type JoinContext = {
  context: AdContextIndex;
  events: ReadonlyMap<string, StageEvent>;
  /** meta_adset_id → phase_at_launch. */
  adSetPhase: ReadonlyMap<string, string | null>;
  tags: TagIndex;
  currency: CurrencyResolver;
};

export function joinAdDay(row: AdDayRow, ctx: JoinContext): LearningFact {
  const resolved = resolveAdContext(row, ctx.context);
  const event = resolved.eventId ? ctx.events.get(resolved.eventId) : undefined;
  const clientId = resolved.clientId ?? event?.clientId ?? null;
  const stage = stageOf(row.date, event, row.meta_adset_id ? ctx.adSetPhase.get(row.meta_adset_id) : null);
  const { tagIds, via } = tagsForAd(row.meta_ad_id, resolved.eventId, row.ad_name, ctx.tags);
  return {
    row,
    clientId,
    eventId: resolved.eventId,
    contextSource: resolved.source,
    stage,
    result: resultOf(stage, row),
    spendGbp: (Number(row.spend) || 0) * ctx.currency.rate(row.ad_account_id),
    tagIds,
    tagVia: via,
  };
}

export type JoinRate = { adDays: number; tagged: number; byAdId: number; byName: number; rate: number };

/** Tagged ad-days ÷ ad-days, per client (facts with no client under ''). */
export function joinRates(facts: readonly LearningFact[]): Map<string, JoinRate> {
  const out = new Map<string, JoinRate>();
  for (const f of facts) {
    const key = f.clientId ?? "";
    const r = out.get(key) ?? { adDays: 0, tagged: 0, byAdId: 0, byName: 0, rate: 0 };
    r.adDays += 1;
    if (f.tagVia) r.tagged += 1;
    if (f.tagVia === "meta_ad_id") r.byAdId += 1;
    if (f.tagVia === "name") r.byName += 1;
    r.rate = r.tagged / r.adDays;
    out.set(key, r);
  }
  return out;
}

// ─── Loading (service role) ───────────────────────────────────────────────────

type Db = Pick<SupabaseClient, "from">;

type Query = {
  not(column: string, operator: string, value: unknown): Query;
  order(column: string, options: { ascending: boolean }): Query;
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

async function loadAll<T>(db: Db, table: string, columns: string, filter?: (q: Query) => Query): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    let query = db.from(table).select(columns) as unknown as Query;
    if (filter) query = filter(query);
    const { data, error } = await query.order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

export type LearningClient = {
  id: string;
  name: string;
  vertical: string;
  userId: string | null;
};

export type LaunchedAdSetRow = {
  meta_adset_id: string;
  client_id: string | null;
  event_id: string | null;
  phase_at_launch: string | null;
  interest_ids: unknown;
};

export type CreativeTag = { id: string; dimension: string; value_key: string; value_label: string | null };

export type LearningInputs = {
  /** Active (non-archived) clients. */
  clients: LearningClient[];
  archivedClientIds: ReadonlySet<string>;
  /** Facts whose client is active. */
  facts: LearningFact[];
  /** Facts dropped: no client resolved, or an archived client. */
  dropped: { noClient: number; archived: number };
  adSets: LaunchedAdSetRow[];
  tags: ReadonlyMap<string, CreativeTag>;
  currency: CurrencyResolver;
};

export function interestIdsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (v && typeof v === "object" ? (v as { id?: unknown }).id : v))
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
}

/** Same key rule as the interest-performance report: sorted, deduped ids. */
export function interestKeyOf(value: unknown): string {
  return clusterKey(interestIdsOf(value));
}

const AD_DAY_COLUMNS =
  "id, ad_account_id, meta_ad_id, meta_adset_id, date, ad_name, campaign_name, spend, impressions, reach, link_clicks, landing_page_views, video_plays_3s, video_plays_p100, registrations, purchases";

export async function loadLearningInputs(db: Db): Promise<LearningInputs> {
  const archivedClientIds = await loadArchivedClientIds(db);
  const [clients, events, adSets, assignments, tagRows, bmAccounts, adDays, context] = await Promise.all([
    loadAll<{ id: string; name: string; vertical: string | null; user_id: string | null }>(db, "clients", "id, name, vertical, user_id"),
    loadAll<{ id: string; client_id: string | null; general_sale_at: string | null; presale_at: string | null }>(
      db,
      "events",
      "id, client_id, general_sale_at, presale_at",
    ),
    loadAll<LaunchedAdSetRow>(db, "launched_ad_sets", "id, meta_adset_id, client_id, event_id, phase_at_launch, interest_ids"),
    loadAll<TagAssignment>(db, "creative_tag_assignments", "id, event_id, creative_name, tag_id, meta_ad_id"),
    loadAll<CreativeTag>(db, "creative_tags", "id, dimension, value_key, value_label", (q) => q.not("dimension", "is", null)),
    loadAll<{ ad_account_id: string; currency: string | null }>(db, "bm_ad_accounts", "id, ad_account_id, currency"),
    loadAll<AdDayRow>(db, "ad_daily_insights", AD_DAY_COLUMNS),
    loadAdContextIndex(db as SupabaseClient),
  ]);
  const tags = new Map(tagRows.map((t) => [t.id, t]));
  const currency = currencyResolver(
    new Map(bmAccounts.filter((a) => a.currency).map((a) => [a.ad_account_id, a.currency as string])),
  );
  const ctx: JoinContext = {
    context,
    events: new Map(
      events.map((e) => [e.id, { clientId: e.client_id, generalSaleAt: e.general_sale_at, presaleAt: e.presale_at }]),
    ),
    adSetPhase: new Map(adSets.map((a) => [a.meta_adset_id, a.phase_at_launch])),
    tags: buildTagIndex(assignments, new Set(tags.keys())),
    currency,
  };
  const all = adDays.map((row) => joinAdDay(row, ctx));
  const withClient = all.filter((f) => f.clientId);
  const facts = dropArchivedClientRows(withClient, archivedClientIds, (f) => f.clientId);
  return {
    clients: dropArchivedClientRows(clients, archivedClientIds, (c) => c.id).map((c) => ({
      id: c.id,
      name: c.name,
      vertical: c.vertical ?? "music",
      userId: c.user_id,
    })),
    archivedClientIds,
    facts,
    dropped: { noClient: all.length - withClient.length, archived: withClient.length - facts.length },
    adSets: dropArchivedClientRows(adSets, archivedClientIds),
    tags,
    currency,
  };
}
