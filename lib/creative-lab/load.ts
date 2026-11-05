/**
 * Creative Lab loaders. Service role only: ad_daily_insights,
 * launched_ads, launched_ad_sets and tag_performance are written by crons
 * and read here across clients; event_ticket_tiers has no user policy.
 * Zero Meta calls.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveAdContext, type AdContext, type AdContextIndex, type CodedEvent } from "../learning/ad-facts.ts";
import { currencyResolver, type CurrencyResolver } from "../learning/currency.ts";
import type { Stage, StageEvent } from "../learning/joins.ts";
import { normalizeAdAccountId, resolveEventAdAccountId } from "../meta/ad-account.ts";

export type ServiceRoleDb = Pick<SupabaseClient, "from">;

type Rows<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

type Query = {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
  not(column: string, operator: string, value: unknown): Query;
  lte(column: string, value: unknown): Query;
  order(column: string, options: { ascending: boolean }): Query;
  range(from: number, to: number): Rows<unknown>;
  limit(n: number): Rows<unknown>;
};

function table(db: ServiceRoleDb, name: string): Query {
  return db.from(name) as unknown as Query;
}

async function pagedRows<T>(build: () => Query, label: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(`${label}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** The ad-day columns the judge reads. */
export type JudgeAdDayRow = {
  ad_account_id: string;
  meta_ad_id: string;
  meta_adset_id: string | null;
  date: string;
  ad_name: string | null;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  link_clicks: number;
  landing_page_views: number;
  registrations: number;
  purchases: number;
  actions: unknown;
  result_action_type: string | null;
  campaign_objective: string | null;
  optimization_goal: string | null;
  promoted_event: string | null;
};

const JUDGE_AD_DAY_COLUMNS =
  "id, ad_account_id, meta_ad_id, meta_adset_id, date, ad_name, campaign_name, spend, impressions, link_clicks, landing_page_views, registrations, purchases, actions, result_action_type, campaign_objective, optimization_goal, promoted_event";

/** Every ad-day in these ad sets up to `through` (inclusive). Earlier days tell the judge when an ad first delivered. */
export async function loadAdSetRows(db: ServiceRoleDb, adSetIds: readonly string[], through: string): Promise<JudgeAdDayRow[]> {
  if (!adSetIds.length) return [];
  const rows = await pagedRows<JudgeAdDayRow>(
    () =>
      table(db, "ad_daily_insights")
        .select(JUDGE_AD_DAY_COLUMNS)
        .in("meta_adset_id", adSetIds)
        .lte("date", through)
        .order("id", { ascending: true }),
    "ad_daily_insights",
  );
  return rows.map((r) => ({
    ...r,
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    link_clicks: Number(r.link_clicks) || 0,
    landing_page_views: Number(r.landing_page_views) || 0,
    registrations: Number(r.registrations) || 0,
    purchases: Number(r.purchases) || 0,
  }));
}

/** The latest date ad_daily_insights holds for any of these accounts; null when none. */
export async function loadDataThrough(db: ServiceRoleDb, adAccountIds: readonly string[]): Promise<string | null> {
  if (!adAccountIds.length) return null;
  const { data, error } = await table(db, "ad_daily_insights")
    .select("date")
    .in("ad_account_id", adAccountIds)
    .order("date", { ascending: false })
    .limit(1);
  if (error) throw new Error(`ad_daily_insights data-through: ${error.message}`);
  const row = (data ?? [])[0] as { date?: string } | undefined;
  return row?.date ?? null;
}

export async function loadCurrency(db: ServiceRoleDb): Promise<CurrencyResolver> {
  const rows = await pagedRows<{ ad_account_id: string; currency: string | null }>(
    () => table(db, "bm_ad_accounts").select("id, ad_account_id, currency").order("id", { ascending: true }),
    "bm_ad_accounts",
  );
  return currencyResolver(new Map(rows.filter((r) => r.currency).map((r) => [r.ad_account_id, r.currency as string])));
}

/**
 * The join sources `resolveAdContext` reads, limited to these ads and ad
 * sets. Coded events are every event with an event_code, as in
 * `loadAdContextIndex` (lib/learning/ad-facts.ts), so a code shared by
 * two events is narrowed by ad account the same way.
 */
export async function loadAdContextFor(
  db: ServiceRoleDb,
  ids: { metaAdIds: readonly string[]; metaAdsetIds: readonly string[] },
): Promise<AdContextIndex> {
  type Ledger = { client_id: string | null; event_id: string | null };
  const [ads, adSets, events, clients] = await Promise.all([
    ids.metaAdIds.length
      ? pagedRows<Ledger & { meta_ad_id: string }>(
          () =>
            table(db, "launched_ads")
              .select("id, meta_ad_id, client_id, event_id")
              .in("meta_ad_id", ids.metaAdIds)
              .order("id", { ascending: true }),
          "launched_ads",
        )
      : [],
    ids.metaAdsetIds.length
      ? pagedRows<Ledger & { meta_adset_id: string }>(
          () =>
            table(db, "launched_ad_sets")
              .select("id, meta_adset_id, client_id, event_id")
              .in("meta_adset_id", ids.metaAdsetIds)
              .order("id", { ascending: true }),
          "launched_ad_sets",
        )
      : [],
    pagedRows<{ id: string; client_id: string | null; event_code: string | null; meta_ad_account_id: string | null }>(
      () =>
        table(db, "events")
          .select("id, client_id, event_code, meta_ad_account_id")
          .not("event_code", "is", null)
          .order("id", { ascending: true }),
      "events",
    ),
    pagedRows<{ id: string; meta_ad_account_id: string | null }>(
      () => table(db, "clients").select("id, meta_ad_account_id").order("id", { ascending: true }),
      "clients",
    ),
  ]);
  const clientAccount = new Map(clients.map((c) => [c.id, c.meta_ad_account_id]));
  const codedEvents: CodedEvent[] = events
    .filter((e) => e.event_code?.trim())
    .map((e) => ({
      eventId: e.id,
      clientId: e.client_id,
      eventCode: e.event_code!.trim(),
      adAccountId: normalizeAdAccountId(resolveEventAdAccountId(e, e.client_id ? clientAccount.get(e.client_id) : null)),
    }));
  return {
    launchedAds: new Map(ads.map((r) => [r.meta_ad_id, { clientId: r.client_id, eventId: r.event_id }])),
    launchedAdSets: new Map(adSets.map((r) => [r.meta_adset_id, { clientId: r.client_id, eventId: r.event_id }])),
    codedEvents,
  };
}

/**
 * The event and client an ad reaches, the same way learning resolves it:
 * launched_ads → launched_ad_sets → [EVENT_CODE] in the campaign name.
 * The ad's latest ad-day supplies the ad set, campaign name and account;
 * an ad with no ad-day yet resolves through launched_ads only.
 */
export async function resolveAdEvent(db: ServiceRoleDb, metaAdId: string): Promise<AdContext> {
  const { data, error } = await table(db, "ad_daily_insights")
    .select("meta_ad_id, meta_adset_id, campaign_name, ad_account_id, date")
    .eq("meta_ad_id", metaAdId)
    .order("date", { ascending: false })
    .limit(1);
  if (error) throw new Error(`ad_daily_insights (${metaAdId}): ${error.message}`);
  const day = (data ?? [])[0] as
    | { meta_adset_id: string | null; campaign_name: string | null; ad_account_id: string | null }
    | undefined;
  const index = await loadAdContextFor(db, {
    metaAdIds: [metaAdId],
    metaAdsetIds: day?.meta_adset_id ? [day.meta_adset_id] : [],
  });
  return resolveAdContext(
    {
      meta_ad_id: metaAdId,
      meta_adset_id: day?.meta_adset_id ?? null,
      campaign_name: day?.campaign_name ?? null,
      ad_account_id: day?.ad_account_id ?? null,
    },
    index,
  );
}

export type AdSetLedger = { phaseAtLaunch: string | null; clientId: string | null; eventId: string | null };

export async function loadAdSetLedger(db: ServiceRoleDb, adSetIds: readonly string[]): Promise<Map<string, AdSetLedger>> {
  if (!adSetIds.length) return new Map();
  const rows = await pagedRows<{ meta_adset_id: string; phase_at_launch: string | null; client_id: string | null; event_id: string | null }>(
    () =>
      table(db, "launched_ad_sets")
        .select("id, meta_adset_id, phase_at_launch, client_id, event_id")
        .in("meta_adset_id", adSetIds)
        .order("id", { ascending: true }),
    "launched_ad_sets",
  );
  return new Map(rows.map((r) => [r.meta_adset_id, { phaseAtLaunch: r.phase_at_launch, clientId: r.client_id, eventId: r.event_id }]));
}

export async function loadStageEvents(db: ServiceRoleDb, eventIds: readonly string[]): Promise<Map<string, StageEvent>> {
  if (!eventIds.length) return new Map();
  const rows = await pagedRows<{ id: string; client_id: string | null; general_sale_at: string | null; presale_at: string | null }>(
    () =>
      table(db, "events")
        .select("id, client_id, general_sale_at, presale_at")
        .in("id", eventIds)
        .order("id", { ascending: true }),
    "events",
  );
  return new Map(rows.map((e) => [e.id, { clientId: e.client_id, generalSaleAt: e.general_sale_at, presaleAt: e.presale_at }]));
}

/**
 * tag_performance.baseline_cpr per client and stage: the pooled cost per
 * result over every tagged ad in the client scope (migration 186), the
 * same on every row of a scope and stage. Key `${clientId}|${stage}`.
 */
export async function loadClientBaselines(db: ServiceRoleDb, clientIds: readonly string[]): Promise<Map<string, number>> {
  if (!clientIds.length) return new Map();
  const rows = await pagedRows<{ scope_id: string; stage: Stage; baseline_cpr: number | null }>(
    () =>
      table(db, "tag_performance")
        .select("id, scope_id, stage, baseline_cpr")
        .eq("scope", "client")
        .in("scope_id", clientIds)
        .not("baseline_cpr", "is", null)
        .order("id", { ascending: true }),
    "tag_performance",
  );
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.scope_id}|${r.stage}`;
    if (!out.has(key) && Number(r.baseline_cpr) > 0) out.set(key, Number(r.baseline_cpr));
  }
  return out;
}
