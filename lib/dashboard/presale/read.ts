/**
 * lib/dashboard/presale/read.ts
 *
 * HE4's read helper: one show's presale log (E3), every figure naming its
 * source (counted | entered | derived | est.). The rules are in ./model.ts;
 * this file only reads.
 *
 * Reads, all paged (`loadAllPaged`, the 1,000-row PostgREST cap) except the
 * single-row ones:
 *   events                    presale_at, code, client, linked campaigns.
 *   presale_logs, presale_relaunches, community_member_counts  (migration 249).
 *   signup_source_snapshots   CIRQLIN's daily signups (sentinel rows dropped).
 *   internal_count_blocks + internal_count_reports
 *                             HD1's written counts, landed at the email's
 *                             Date header (sent_at), else received_at.
 *   ad_daily_insights         the show's Meta registration-objective spend:
 *                             campaigns the dashboard's rule gives the show
 *                             (metaCampaignOwners: an override, then the id
 *                             in events.meta_campaign_id, then "[CODE]" in
 *                             the name), whose ad-day phaseFromMetaObjective
 *                             says "presale" (Complete Registration or leads).
 *                             TikTok and Google spend aren't in it.
 *
 * Before migration 249 is applied, its three tables read as empty, not an
 * error, so the log shows the counted half and "Add the window figures".
 *
 * Read only. Never writes.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadCampaignOverrides } from "../../attribution/campaign-owner.ts";
import { isCirqlinSentinelRow } from "../../cirqlin/tracker-signups.ts";
import type { CirqlinSnapshotRow } from "../../cirqlin/types.ts";
import { loadAllPaged, type PagedQuery } from "../../db/paged-read.ts";
import { phaseFromMetaObjective } from "../../launched-ad-sets/snapshot.ts";
import { metaCampaignOwners } from "../sales-calc/figures.ts";
import {
  buildPresaleLog,
  type InternalCount,
  type MemberCountRow,
  type PresaleLog,
  type PresaleLogRow,
  type RelaunchRow,
  type SignupDay,
} from "./model.ts";

type Db = Pick<SupabaseClient, "from">;

export const PRESALE_LOG_TABLES = ["presale_logs", "presale_relaunches", "community_member_counts"] as const;

export const PRESALE_LOG_COLUMNS =
  "event_id,window_start_at,window_start_entered_by,window_start_entered_at,sold_in_window,sold_in_window_entered_by,sold_in_window_entered_at,avg_ticket_price,avg_ticket_price_entered_by,avg_ticket_price_entered_at,presale_day_tickets,presale_day_tickets_entered_by,presale_day_tickets_entered_at";
export const RELAUNCH_COLUMNS = "id,event_id,relaunched_on,what_we_did,entered_by,entered_at,result,result_entered_by,result_entered_at";
export const MEMBER_COUNT_COLUMNS = "event_id,counted_on,members,entered_by,entered_at";

/** A 249 table that isn't there yet. */
export function isMissingPresaleTable(message: string | undefined): boolean {
  if (!message) return false;
  return PRESALE_LOG_TABLES.some((t) => message.includes(t)) && /(does not exist|schema cache|not find)/i.test(message);
}

async function orEmpty<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (error) {
    if (isMissingPresaleTable(error instanceof Error ? error.message : String(error))) return [];
    throw error;
  }
}

async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>, size = 200): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await read(ids.slice(i, i + size))));
  return out;
}

export interface PresaleEventRow {
  id: string;
  client_id: string | null;
  event_code: string | null;
  event_date: string | null;
  presale_at: string | null;
  meta_campaign_id: string | null;
  meta_ad_account_id: string | null;
}

const EVENT_COLUMNS = "id,client_id,event_code,event_date,presale_at,meta_campaign_id,meta_ad_account_id";

// ── the 249 tables ──────────────────────────────────────────────────────

export async function loadPresaleLogRow(db: Db, eventId: string): Promise<PresaleLogRow | null> {
  const rows = await orEmpty(() => loadAllPaged<PresaleLogRow & { event_id: string }>(db, "presale_logs", PRESALE_LOG_COLUMNS, ["event_id"], (q) => q.eq("event_id", eventId)));
  return rows[0] ?? null;
}

export async function loadRelaunches(db: Db, eventId: string): Promise<RelaunchRow[]> {
  return orEmpty(() =>
    loadAllPaged<RelaunchRow & { event_id: string }>(db, "presale_relaunches", RELAUNCH_COLUMNS, ["id"], (q) => q.eq("event_id", eventId), {
      orderBy: [{ column: "relaunched_on", ascending: true }],
    }),
  );
}

/** Every entered member count for these shows, keyed by event. */
export async function loadMemberCounts(db: Db, eventIds: readonly string[]): Promise<Map<string, MemberCountRow[]>> {
  const ids = [...new Set(eventIds)].sort();
  const rows = await orEmpty(() =>
    inChunks(ids, (chunk) =>
      loadAllPaged<MemberCountRow & { event_id: string }>(db, "community_member_counts", MEMBER_COUNT_COLUMNS, ["event_id", "counted_on"], (q) => q.in("event_id", chunk)),
    ),
  );
  const out = new Map<string, MemberCountRow[]>();
  for (const r of rows) {
    const list = out.get(r.event_id) ?? [];
    list.push({ counted_on: r.counted_on, members: Number(r.members), entered_by: r.entered_by, entered_at: r.entered_at });
    out.set(r.event_id, list);
  }
  return out;
}

// ── counted inputs ──────────────────────────────────────────────────────

/** CIRQLIN's daily signups for the show; null when it has no live CIRQLIN row. */
export async function loadSignupDays(db: Db, eventId: string): Promise<SignupDay[] | null> {
  const rows = await loadAllPaged<{ id: string; day: string; signups_day: number | null; raw_json: CirqlinSnapshotRow["raw_json"] }>(
    db,
    "signup_source_snapshots",
    "id,day,signups_day,raw_json",
    ["id"],
    (q) => q.eq("event_id", eventId).eq("source", "cirqlin"),
  );
  const live = rows.filter((r) => !isCirqlinSentinelRow(r as unknown as CirqlinSnapshotRow));
  if (live.length === 0) return null;
  const byDay = new Map<string, number>();
  for (const r of live) byDay.set(r.day, Number(r.signups_day ?? 0));
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, signups]) => ({ day, signups }));
}

/** The show's written Internal Counts counts, with when each landed. */
export async function loadInternalCounts(db: Db, eventId: string): Promise<InternalCount[]> {
  const blocks = await loadAllPaged<{
    id: string;
    report_id: string;
    count_date: string | null;
    paid_tickets: number | null;
    paid_revenue_pence: number | string | null;
    revenue_held: boolean | null;
  }>(db, "internal_count_blocks", "id,report_id,count_date,paid_tickets,paid_revenue_pence,revenue_held", ["id"], (q) =>
    q.eq("event_id", eventId).eq("status", "written"),
  );
  if (blocks.length === 0) return [];
  const reportIds = [...new Set(blocks.map((b) => b.report_id))].sort();
  const reports = await inChunks(reportIds, (chunk) =>
    loadAllPaged<{ id: string; sent_at: string | null; received_at: string }>(db, "internal_count_reports", "id,sent_at,received_at", ["id"], (q) => q.in("id", chunk)),
  );
  const landed = new Map(reports.map((r) => [r.id, r.sent_at ?? r.received_at]));
  const out: InternalCount[] = [];
  for (const b of blocks) {
    const at = landed.get(b.report_id);
    if (!at || b.paid_tickets == null) continue;
    const pence = b.paid_revenue_pence == null ? null : Number(b.paid_revenue_pence);
    out.push({
      blockId: b.id,
      landedAt: at,
      countDate: b.count_date,
      paid: Number(b.paid_tickets),
      paidRevenuePence: b.revenue_held ? null : pence,
    });
  }
  return out;
}

function actId(id: string): string {
  return `act_${id.trim().replace(/^act_/, "")}`;
}

const SAFE_CODE = /^[A-Za-z0-9_-]+$/;

/**
 * The show's Meta registration-objective spend, all time: the sum of the
 * ad-days on campaigns the dashboard gives this show whose phase is
 * "presale" by phaseFromMetaObjective. Null when none.
 */
export async function loadRegistrationSpend(db: Db, event: PresaleEventRow): Promise<number | null> {
  if (!event.client_id || !event.event_code || !event.event_date) return null;
  const { data: client, error } = await db.from("clients").select("id,meta_ad_account_id").eq("id", event.client_id).maybeSingle();
  if (error) throw new Error(`clients read failed: ${error.message}`);
  const shows = (
    await loadAllPaged<{ id: string; event_code: string | null; event_date: string | null; meta_campaign_id: string | null; meta_ad_account_id: string | null; status: string | null }>(
      db,
      "events",
      "id,event_code,event_date,meta_campaign_id,meta_ad_account_id,status",
      ["id"],
      (q) => q.eq("client_id", event.client_id!),
    )
  ).filter((e) => e.event_code && e.event_date && e.status !== "cancelled");
  const accounts = [
    ...new Set([(client as { meta_ad_account_id: string | null } | null)?.meta_ad_account_id ?? null, ...shows.map((s) => s.meta_ad_account_id)].filter((a): a is string => !!a).map(actId)),
  ];
  if (accounts.length === 0) return null;
  const overrides = await loadCampaignOverrides(db, "meta");
  const linked = (event.meta_campaign_id ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const overridden = [...overrides.entries()].filter(([, e]) => e === event.id).map(([c]) => c);
  const ids = [...new Set([...linked, ...overridden])].filter((id) => /^\d+$/.test(id));
  const code = event.event_code;

  type Row = {
    id: string;
    meta_campaign_id: string | null;
    campaign_name: string | null;
    spend: number | string | null;
    campaign_objective: string | null;
    optimization_goal: string | null;
    promoted_event: string | null;
  };
  const narrow = (q: PagedQuery): PagedQuery => {
    const base = q.in("ad_account_id", accounts);
    if (!SAFE_CODE.test(code)) return base;
    const parts = [`campaign_name.ilike.*${code}*`];
    if (ids.length) parts.push(`meta_campaign_id.in.(${ids.join(",")})`);
    return base.or(parts.join(","));
  };
  const rows = await loadAllPaged<Row>(
    db,
    "ad_daily_insights",
    "id,meta_campaign_id,campaign_name,spend,campaign_objective,optimization_goal,promoted_event",
    ["id"],
    narrow,
  );

  const names = new Map<string, string>();
  for (const r of rows) {
    if (!r.meta_campaign_id) continue;
    const name = r.campaign_name ?? "";
    const current = names.get(r.meta_campaign_id);
    if (current == null || name > current) names.set(r.meta_campaign_id, name);
  }
  const owners = metaCampaignOwners(
    shows.map((s) => ({
      eventId: s.id,
      code: s.event_code!,
      showDate: s.event_date!,
      linkedCampaignIds: (s.meta_campaign_id ?? "").split(",").map((id) => id.trim()).filter(Boolean),
    })),
    names,
    Object.fromEntries(overrides),
  );

  let spend = 0;
  let any = false;
  for (const r of rows) {
    if (!r.meta_campaign_id || owners.get(r.meta_campaign_id)?.eventId !== event.id) continue;
    const phase = phaseFromMetaObjective({ campaignObjective: r.campaign_objective, optimizationGoal: r.optimization_goal, promotedEvent: r.promoted_event });
    if (phase !== "presale") continue;
    spend += Number(r.spend ?? 0);
    any = true;
  }
  return any ? Math.round(spend * 100) / 100 : null;
}

// ── the log ─────────────────────────────────────────────────────────────

export interface LoadPresaleLogOptions {
  /**
   * Dry-run only: a presale open to use when events.presale_at is unset.
   * Never written anywhere. The live panel passes nothing.
   */
  presaleAtWhenUnset?: string | null;
  timeZone?: string;
}

/** One show's presale log, or null when the event isn't there (or isn't the caller's, under RLS). */
export async function loadPresaleLog(db: Db, eventId: string, opts: LoadPresaleLogOptions = {}): Promise<PresaleLog | null> {
  const { data, error } = await db.from("events").select(EVENT_COLUMNS).eq("id", eventId).maybeSingle();
  if (error) throw new Error(`events read failed: ${error.message}`);
  if (!data) return null;
  const event = data as PresaleEventRow;
  const [log, relaunches, memberCounts, signupDays, internalCounts, registrationSpend] = await Promise.all([
    loadPresaleLogRow(db, eventId),
    loadRelaunches(db, eventId),
    loadMemberCounts(db, [eventId]),
    loadSignupDays(db, eventId),
    loadInternalCounts(db, eventId),
    loadRegistrationSpend(db, event),
  ]);
  return buildPresaleLog({
    eventId,
    presaleAt: event.presale_at ?? opts.presaleAtWhenUnset ?? null,
    timeZone: opts.timeZone,
    log,
    relaunches,
    memberCounts: memberCounts.get(eventId) ?? [],
    signupDays,
    internalCounts,
    registrationSpend,
  });
}

export { buildPresaleLog, ADD_WINDOW_FIGURES, DATED_COMMUNITY_JOINED_NEEDS } from "./model.ts";
export type { Figure, FigureSource, PresaleLog } from "./model.ts";
