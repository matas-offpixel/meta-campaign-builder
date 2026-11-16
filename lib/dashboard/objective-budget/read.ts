/**
 * lib/dashboard/objective-budget/read.ts
 *
 * HE6's read helper (no UI): E6's objective × channel rows and the
 * budget picture for a show or a client, over any period, each figure
 * with its source.
 *
 *   readObjectiveBudget(db, { clientId, eventId?, from?, to? })
 *
 * `to` defaults to yesterday (London): spend runs to yesterday, as the
 * sales calc's does. `from` null = since launch. Read-only.
 *
 * The internal page passes the owner's session client; a share route
 * passes the service-role client, and every read below is filtered to
 * the client's own events, so a token reaches its own client only.
 * d2c_broadcast_stats has no authenticated read (246), so a session
 * client gets no D2C rows: D2C then reads as not set.
 *
 * Every SELECT pages with `.range()` in unique-key order and dedupes
 * (lib/db/paged-read.ts). Archived clients read as null.
 *
 * Relative imports only (node --test).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadCampaignOverrides } from "../../attribution/campaign-owner.ts";
import { loadArchivedClientIds } from "../../db/client-status.ts";
import { loadAllPaged, type PagedQuery } from "../../db/paged-read.ts";
import { loadMessageRate, loadStatsRows } from "../../d2c/stats-ingest/read.ts";
import type { StoredStatsRow } from "../../d2c/stats-ingest/summary.ts";
import { addDays, londonDay } from "../sales-calc/days.ts";
import { computeObjectiveBudget, type Scope } from "./compute.ts";
import type { BudgetEntry, BudgetEntryKind, ObjectiveBudgetInput, ObjectiveBudgetResult, ScopeEvent } from "./types.ts";

type Db = Pick<SupabaseClient, "from">;

const IN_CHUNK = 100;

async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...(await read(ids.slice(i, i + IN_CHUNK))));
  return out;
}

const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const n0 = (v: unknown): number => num(v) ?? 0;

function actId(id: string): string {
  return `act_${id.trim().replace(/^act_/, "")}`;
}

function missingTable(error: unknown, table: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(table) && /(does not exist|schema cache|not find)/i.test(message);
}

interface EventRow {
  id: string;
  event_code: string | null;
  name: string | null;
  event_date: string | null;
  kind: string | null;
  status: string | null;
  meta_campaign_id: string | null;
  meta_ad_account_id: string | null;
  budget_marketing: number | string | null;
}

interface AdRow {
  id: string;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  campaign_name: string | null;
  date: string;
  spend: number | string | null;
  impressions: number | string | null;
  reach: number | string | null;
  link_clicks: number | string | null;
  landing_page_views: number | string | null;
  registrations: number | string | null;
  leads: number | string | null;
  purchases: number | string | null;
  campaign_objective: string | null;
  optimization_goal: string | null;
  promoted_event: string | null;
}

const AD_COLUMNS =
  "id,meta_campaign_id,meta_adset_id,campaign_name,date,spend,impressions,reach,link_clicks,landing_page_views,registrations,leads,purchases,campaign_objective,optimization_goal,promoted_event";

/** Scope events: dated shows and brand campaigns (dated or not), cancelled ones left out. */
export function scopeEvents(rows: readonly EventRow[]): ScopeEvent[] {
  return rows
    .filter((e) => e.event_code && e.status !== "cancelled" && (e.event_date || e.kind === "brand_campaign"))
    .map((e) => ({
      eventId: e.id,
      code: e.event_code!,
      name: e.name ?? e.event_code!,
      showDate: e.event_date ? e.event_date.slice(0, 10) : null,
      kind: e.kind === "brand_campaign" ? "brand_campaign" : "event",
      linkedCampaignIds: (e.meta_campaign_id ?? "").split(",").map((id) => id.trim()).filter(Boolean),
      budgetMarketing: num(e.budget_marketing),
    }));
}

/** Everything HE6 needs for one client. Null for a missing or archived client. */
export async function loadObjectiveBudgetInput(db: Db, clientId: string): Promise<ObjectiveBudgetInput | null> {
  const { data: client, error: clientError } = await db.from("clients").select("id,name,meta_ad_account_id").eq("id", clientId).maybeSingle();
  if (clientError) throw new Error(`clients read failed: ${clientError.message}`);
  if (!client) return null;
  const archived = await loadArchivedClientIds(db as SupabaseClient);
  if (archived.has(clientId)) return null;
  const c = client as { id: string; name: string | null; meta_ad_account_id: string | null };

  const eventRows = await loadAllPaged<EventRow>(
    db,
    "events",
    "id,event_code,name,event_date,kind,status,meta_campaign_id,meta_ad_account_id,budget_marketing",
    ["id"],
    (q) => q.eq("client_id", clientId),
  );
  const events = scopeEvents(eventRows);
  const eventIds = events.map((e) => e.eventId);
  const codes = events.map((e) => e.code);
  const accounts = [
    ...new Set(
      [c.meta_ad_account_id, ...eventRows.filter((e) => eventIds.includes(e.id)).map((e) => e.meta_ad_account_id)]
        .filter((a): a is string => !!a)
        .map(actId),
    ),
  ];
  const byEvent = (chunk: string[]) => (q: PagedQuery) => q.in("event_id", chunk);

  const [ads, google, rollups, additional, entries, metaOverrides, googleOverrides, d2cRows, rate] = await Promise.all([
    accounts.length ? loadAllPaged<AdRow>(db, "ad_daily_insights", AD_COLUMNS, ["id"], (q) => q.in("ad_account_id", accounts)) : Promise.resolve([] as AdRow[]),
    codes.length
      ? inChunks(codes, (chunk) =>
          loadAllPaged<{
            id: string;
            event_code: string;
            date: string;
            cost_micros: number | string | null;
            campaign_resource_name: string | null;
            advertising_channel_type: string | null;
            impressions: number | string | null;
            clicks: number | string | null;
            conversions: number | string | null;
            conversion_value_micros: number | string | null;
          }>(
            db,
            "google_ads_daily_snapshots",
            "id,event_code,date,cost_micros,campaign_resource_name,advertising_channel_type,impressions,clicks,conversions,conversion_value_micros",
            ["id"],
            (q) => q.in("event_code", chunk),
          ),
        )
      : Promise.resolve([]),
    inChunks(eventIds, (chunk) =>
      loadAllPaged<{
        id: string;
        event_id: string;
        date: string;
        ad_spend: number | string | null;
        tiktok_spend: number | string | null;
        google_ads_spend: number | string | null;
        source_meta_at: string | null;
        source_tiktok_at: string | null;
        source_google_ads_at: string | null;
      }>(
        db,
        "event_daily_rollups",
        "id,event_id,date,ad_spend,tiktok_spend,google_ads_spend,source_meta_at,source_tiktok_at,source_google_ads_at",
        ["id"],
        byEvent(chunk),
      ),
    ),
    inChunks(eventIds, (chunk) =>
      loadAllPaged<{ id: string; event_id: string; scope: string | null; date: string; amount: number | string }>(
        db,
        "additional_spend_entries",
        "id,event_id,scope,date,amount",
        ["id"],
        byEvent(chunk),
      ),
    ),
    loadBudgetEntries(db, clientId),
    loadCampaignOverrides(db, "meta"),
    loadCampaignOverrides(db, "google"),
    loadStatsRows(db, { clientId }).catch((error: unknown): StoredStatsRow[] => {
      if (missingTable(error, "d2c_broadcast_stats")) return [];
      throw error;
    }),
    loadMessageRate(db, clientId).catch((error: unknown) => {
      if (/whatsapp_message_rate/.test(String(error))) return { rate: null, currency: "GBP" };
      throw error;
    }),
  ]);

  const own = new Set(eventIds);
  const ownOverrides = (m: Map<string, string>) => Object.fromEntries([...m].filter(([, eventId]) => own.has(eventId)));

  return {
    client: { id: c.id, name: c.name ?? "" },
    events,
    metaAdDays: ads
      .filter((r) => r.meta_campaign_id)
      .map((r) => ({
        campaignId: r.meta_campaign_id!,
        campaignName: r.campaign_name ?? "",
        adSetId: r.meta_adset_id,
        day: r.date,
        spend: n0(r.spend),
        impressions: n0(r.impressions),
        reach: n0(r.reach),
        linkClicks: n0(r.link_clicks),
        landingPageViews: n0(r.landing_page_views),
        registrations: n0(r.registrations),
        leads: n0(r.leads),
        purchases: n0(r.purchases),
        campaignObjective: r.campaign_objective,
        optimizationGoal: r.optimization_goal,
        promotedEvent: r.promoted_event,
      })),
    googleDays: google.map((g) => ({
      eventCode: g.event_code,
      campaignId: g.campaign_resource_name?.split("/").pop() ?? null,
      channelType: g.advertising_channel_type,
      day: g.date,
      spend: n0(g.cost_micros) / 1_000_000,
      impressions: n0(g.impressions),
      clicks: n0(g.clicks),
      conversions: n0(g.conversions),
      conversionValue: n0(g.conversion_value_micros) / 1_000_000,
    })),
    rollups: rollups.map((r) => ({
      eventId: r.event_id,
      day: r.date,
      meta: num(r.ad_spend),
      tiktok: num(r.tiktok_spend),
      google: num(r.google_ads_spend),
      metaSynced: r.source_meta_at != null,
      tiktokSynced: r.source_tiktok_at != null,
      googleSynced: r.source_google_ads_at != null,
    })),
    overrides: { meta: ownOverrides(metaOverrides), google: ownOverrides(googleOverrides) },
    additionalSpend: additional.map((a) => ({ eventId: a.event_id, scope: a.scope === "venue" ? "venue" : "event", day: a.date, amount: n0(a.amount) })),
    entries: entries == null ? null : entries.filter((e) => e.eventId == null || own.has(e.eventId)),
    d2c: { rows: d2cRows, rate },
  };
}

const KINDS: ReadonlySet<string> = new Set<BudgetEntryKind>(["season_budget", "credit", "sub_budget", "sms_cost"]);

/** marketing_budget_entries for the client. Null when migration 250 isn't applied. */
export async function loadBudgetEntries(db: Db, clientId: string): Promise<BudgetEntry[] | null> {
  try {
    const rows = await loadAllPaged<{
      id: string;
      event_id: string | null;
      kind: string;
      label: string | null;
      amount: number | string;
      spent: number | string | null;
      entry_date: string | null;
    }>(db, "marketing_budget_entries", "id,event_id,kind,label,amount,spent,entry_date", ["id"], (q) => q.eq("client_id", clientId));
    return rows
      .filter((r) => KINDS.has(r.kind))
      .map((r) => ({
        id: r.id,
        eventId: r.event_id,
        kind: r.kind as BudgetEntryKind,
        label: r.label ?? "",
        amount: n0(r.amount),
        spent: num(r.spent),
        day: r.entry_date,
      }));
  } catch (error) {
    if (missingTable(error, "marketing_budget_entries")) return null;
    throw error;
  }
}

export interface ReadOptions {
  clientId: string;
  /** A show or brand campaign of the client; omitted = the whole client. */
  eventId?: string;
  /** Inclusive; omitted = since launch. */
  from?: string | null;
  /** Inclusive; omitted = yesterday (London). */
  to?: string;
  /** For tests and the dry run: London today. */
  today?: string;
}

/** E6 for a show or a client. Null for a missing or archived client, or a show that isn't the client's. */
export async function readObjectiveBudget(db: Db, opts: ReadOptions): Promise<ObjectiveBudgetResult | null> {
  const input = await loadObjectiveBudgetInput(db, opts.clientId);
  if (!input) return null;
  if (opts.eventId && !input.events.some((e) => e.eventId === opts.eventId)) return null;
  const to = opts.to ?? addDays(opts.today ?? londonDay(new Date()), -1);
  const scope: Scope = opts.eventId ? { kind: "show", eventId: opts.eventId } : { kind: "client" };
  return computeObjectiveBudget(input, scope, { from: opts.from ?? null, to });
}
