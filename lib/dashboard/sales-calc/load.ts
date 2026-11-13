/**
 * lib/dashboard/sales-calc/load.ts
 *
 * Reads one client's `SalesCalcInput` from Supabase. Read-only.
 *
 * The internal page passes the owner's session client (RLS scopes it);
 * the share route passes the service-role client with the token's
 * `client_id`, and every read below is filtered to that client's events,
 * so a token reaches its own client's shows only (D11).
 *
 * Every SELECT pages in unique-key order and dedupes (lib/db/paged-read.ts).
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllPaged, type PagedQuery } from "../../db/paged-read.ts";
import { loadEventConfigs } from "../../event-config/read.ts";
import { loadFinalCounts } from "../../internal-counts/final-count.ts";
import { collapseCounts, type SnapshotRow } from "./counts.ts";
import { londonDay } from "./days.ts";
import type { LiftEntry, MetaCampaignDay, SalesCalcInput, ShowInput } from "./types.ts";

type Db = Pick<SupabaseClient, "from">;

const IN_CHUNK = 100;

async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...(await read(ids.slice(i, i + IN_CHUNK))));
  return out;
}

interface EventRow {
  id: string;
  user_id: string | null;
  client_id: string | null;
  event_code: string | null;
  name: string | null;
  event_date: string | null;
  presale_at: string | null;
  general_sale_at: string | null;
  meta_campaign_id: string | null;
  meta_ad_account_id: string | null;
  status: string | null;
}

interface InsightRow {
  id: string;
  meta_campaign_id: string | null;
  campaign_name: string | null;
  date: string;
  spend: number | string | null;
  link_clicks: number | null;
  landing_page_views: number | null;
  actions: { action_type?: string; value?: string | number }[] | null;
}

function actionSum(actions: InsightRow["actions"], type: string): number {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions) if (a?.action_type === type) total += Number(a.value ?? 0) || 0;
  return total;
}

const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Meta ad-level insights summed to campaign × day. Exported for the fixture script. */
export function campaignDays(rows: readonly InsightRow[]): MetaCampaignDay[] {
  const out = new Map<string, MetaCampaignDay>();
  for (const r of rows) {
    if (!r.meta_campaign_id) continue;
    const key = `${r.meta_campaign_id}|${r.date}`;
    let c = out.get(key);
    if (!c) {
      out.set(key, (c = { campaignId: r.meta_campaign_id, campaignName: r.campaign_name ?? "", day: r.date, spend: 0, linkClicks: 0, landingPageViews: 0, initiateCheckouts: 0, addsToCart: 0 }));
    }
    if ((r.campaign_name ?? "") > c.campaignName) c.campaignName = r.campaign_name ?? "";
    c.spend += num(r.spend) ?? 0;
    c.linkClicks += num(r.link_clicks) ?? 0;
    c.landingPageViews += num(r.landing_page_views) ?? 0;
    c.initiateCheckouts += actionSum(r.actions, "initiate_checkout");
    c.addsToCart += actionSum(r.actions, "add_to_cart");
  }
  return [...out.values()];
}

function actId(id: string): string {
  const bare = id.trim().replace(/^act_/, "");
  return `act_${bare}`;
}

export interface LoadOptions {
  /** London today; defaults to now. */
  today?: string;
}

/** Everything the calc needs for one client. Throws on a read error; a missing migration-238 table is read as an empty library. */
export async function loadSalesCalcInput(sb: Db, clientId: string, opts: LoadOptions = {}): Promise<SalesCalcInput | null> {
  const today = opts.today ?? londonDay(new Date());
  const { data: client, error: clientError } = await sb.from("clients").select("id,name,meta_ad_account_id").eq("id", clientId).maybeSingle();
  if (clientError) throw new Error(`clients read failed: ${clientError.message}`);
  if (!client) return null;
  const c = client as { id: string; name: string | null; meta_ad_account_id: string | null };

  const events = (
    await loadAllPaged<EventRow>(
      sb,
      "events",
      "id,user_id,client_id,event_code,name,event_date,presale_at,general_sale_at,meta_campaign_id,meta_ad_account_id,status",
      ["id"],
      (q) => q.eq("client_id", clientId),
    )
  ).filter((e) => e.event_code && e.event_date && e.status !== "cancelled");
  const eventIds = events.map((e) => e.id);
  const codes = events.map((e) => e.event_code!);

  const accounts = [...new Set([c.meta_ad_account_id, ...events.map((e) => e.meta_ad_account_id)].filter((a): a is string => !!a).map(actId))];

  const byEvent = (chunk: string[]) => (q: PagedQuery) => q.in("event_id", chunk);
  const [configs, finals, snapshots, rollups, signups, insights, google, library] = await Promise.all([
    loadEventConfigs(sb, eventIds),
    loadFinalCounts(sb, eventIds),
    inChunks(eventIds, (chunk) =>
      loadAllPaged<SnapshotRow & { id: string; event_id: string }>(
        sb,
        "ticket_sales_snapshots",
        "id,event_id,snapshot_at,tickets_sold,source,created_at,comps:raw_payload->comps",
        ["id"],
        byEvent(chunk),
      ),
    ),
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
        sb,
        "event_daily_rollups",
        "id,event_id,date,ad_spend,tiktok_spend,google_ads_spend,source_meta_at,source_tiktok_at,source_google_ads_at",
        ["id"],
        byEvent(chunk),
      ),
    ),
    inChunks(eventIds, (chunk) =>
      loadAllPaged<{ id: string; event_id: string; day: string; signups_day: number | null; reason: string | null }>(
        sb,
        "signup_source_snapshots",
        "id,event_id,day,signups_day,reason:raw_json->>reason",
        ["id"],
        (q) => q.in("event_id", chunk).eq("source", "cirqlin"),
      ),
    ),
    accounts.length
      ? loadAllPaged<InsightRow>(
          sb,
          "ad_daily_insights",
          "id,meta_campaign_id,campaign_name,date,spend,link_clicks,landing_page_views,actions",
          ["id"],
          (q) => q.in("ad_account_id", accounts),
        )
      : Promise.resolve([] as InsightRow[]),
    codes.length
      ? inChunks(codes, (chunk) =>
          loadAllPaged<{ id: string; event_code: string; date: string; cost_micros: number | string | null }>(
            sb,
            "google_ads_daily_snapshots",
            "id,event_code,date,cost_micros",
            ["id"],
            (q) => q.in("event_code", chunk),
          ),
        )
      : Promise.resolve([]),
    loadLibrary(sb, clientId),
  ]);

  const snapsByEvent = new Map<string, SnapshotRow[]>();
  for (const s of snapshots) {
    const list = snapsByEvent.get(s.event_id) ?? [];
    list.push({ ...s, comps: num(s.comps) });
    snapsByEvent.set(s.event_id, list);
  }

  const shows: ShowInput[] = events.map((e) => {
    const config = configs.get(e.id);
    const final = finals.get(e.id);
    const presale = e.presale_at ?? e.general_sale_at;
    return {
      eventId: e.id,
      code: e.event_code!,
      name: e.name ?? e.event_code!,
      showDate: e.event_date!.slice(0, 10),
      presaleDate: presale ? londonDay(presale) : null,
      capacity: config?.capacity ?? null,
      allocation: config?.sellable.allocation ?? null,
      allocationFromTiers: config?.sellable.source === "tiers",
      isUmbrella: config?.isUmbrella ?? false,
      cirqlinPageId: config?.cirqlinPageId ?? null,
      linkedCampaignIds: (e.meta_campaign_id ?? "").split(",").map((id) => id.trim()).filter(Boolean),
      referenceEventIds: config?.referenceEventIds ?? [],
      counts: collapseCounts(snapsByEvent.get(e.id) ?? []),
      finalCount: final
        ? { day: final.countDate, paid: final.paid, comps: final.comps, source: "internal_counts", blockId: final.blockId }
        : null,
    };
  });

  return {
    client: { id: c.id, name: c.name ?? "" },
    today,
    shows,
    metaCampaignDays: campaignDays(insights),
    googleCampaignDays: google.map((g) => ({ eventCode: g.event_code, day: g.date, spend: (num(g.cost_micros) ?? 0) / 1_000_000 })),
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
    signups: signups
      .filter((s) => s.reason == null && s.day >= "2000-01-01")
      .map((s) => ({ eventId: s.event_id, day: s.day, signups: num(s.signups_day) ?? 0 })),
    library,
  };
}

interface LibraryRow {
  id: string;
  event_id: string;
  event_code: string;
  show_date: string;
  d21_day: string;
  d21_sold: number | string;
  d7_day: string;
  d7_sold: number | string;
  final_day: string;
  final_paid: number;
  comps_excluded: number;
  per_day_before: number | string;
  per_day_final_week: number | string;
  lift: number | string;
  final_block_id: string | null;
  computed_at: string;
}

const LIBRARY_COLUMNS =
  "id,event_id,event_code,show_date,d21_day,d21_sold,d7_day,d7_sold,final_day,final_paid,comps_excluded,per_day_before,per_day_final_week,lift,final_block_id,computed_at";

/** Stored entries for the client. Migration 238 not applied yet → empty, and the calc computes in memory. */
export async function loadLibrary(sb: Db, clientId: string): Promise<LiftEntry[]> {
  let rows: LibraryRow[];
  try {
    rows = await loadAllPaged<LibraryRow>(sb, "reference_lift_library", LIBRARY_COLUMNS, ["id"], (q) => q.eq("client_id", clientId));
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return rows.map((r) => ({
    eventId: r.event_id,
    code: r.event_code,
    name: r.event_code,
    showDate: r.show_date,
    d21Day: r.d21_day,
    d21Sold: Number(r.d21_sold),
    d7Day: r.d7_day,
    d7Sold: Number(r.d7_sold),
    finalDay: r.final_day,
    finalPaid: r.final_paid,
    compsExcluded: r.comps_excluded,
    perDayBefore: Number(r.per_day_before),
    perDayFinalWeek: Number(r.per_day_final_week),
    lift: Number(r.lift),
    finalBlockId: r.final_block_id,
    computedAt: r.computed_at,
  }));
}

export function isMissingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /reference_lift_library/.test(message) && /(does not exist|schema cache|not find)/i.test(message);
}

/** Owner of each event, for the library insert. */
export async function loadEventOwners(sb: Db, eventIds: readonly string[]): Promise<Map<string, string>> {
  const rows = await inChunks([...eventIds], (chunk) =>
    loadAllPaged<{ id: string; user_id: string | null }>(sb, "events", "id,user_id", ["id"], (q) => q.in("id", chunk)),
  );
  return new Map(rows.filter((r) => r.user_id).map((r) => [r.id, r.user_id!]));
}
