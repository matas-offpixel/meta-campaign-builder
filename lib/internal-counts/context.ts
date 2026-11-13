/**
 * lib/internal-counts/context.ts
 *
 * What a run needs to plan emails: events, the sheet-name decisions Matas
 * made, price ceilings, the counts already stored and the threads that
 * hold a count. Loaded once per run (cron, backfill, upload, review-list
 * action), then kept current in memory as the run writes, so a dry run and
 * a real run see the same history.
 *
 * Every whole-table read pages in unique-key order (lib/db/paged-read.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { pageAll } from "../db/paged-read.ts";
import { closestEvent, CONFIRMED_COUNT_ALIASES, PROPOSED_COUNT_ALIASES } from "./aliases.ts";
import type { EventRef, PlanContext } from "./plan.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, any, any>;

export interface StoredCount {
  eventId: string;
  countDate: string;
  total: number;
  blockId: string | null;
  /** The storing email's Date header (ISO). */
  sentAt: string | null;
}

export interface RunContext {
  events: EventRef[];
  eventsByCode: Map<string, EventRef>;
  eventsById: Map<string, EventRef>;
  /** Name → event code: the code map plus Matas's matches. */
  aliases: Record<string, string>;
  notOurs: Set<string>;
  ceilings: Map<string, number>;
  counts: StoredCount[];
  /** Gmail thread id → the count report stored for it. */
  countThreads: Map<string, string>;
  /** sha256 of every counts sheet already read: the same PDF is one count, however many emails carry it. */
  pdfShas: Set<string>;
  /** M3 keys (sentence + count date) already raised. */
  mentionKeys: Set<string>;
  /** True when built without the database (offline dry run). */
  offline: boolean;
}

interface EventRow {
  id: string;
  event_code: string | null;
  name: string | null;
  event_date: string | null;
  user_id: string;
  client_id: string | null;
}

function toRef(e: EventRow): EventRef {
  return {
    id: e.id,
    eventCode: e.event_code ?? "",
    name: e.name ?? e.event_code ?? "",
    eventDate: e.event_date,
    userId: e.user_id,
    clientId: e.client_id,
  };
}

function indexEvents(ctx: RunContext): void {
  ctx.eventsByCode = new Map(ctx.events.filter((e) => e.eventCode).map((e) => [e.eventCode, e]));
  ctx.eventsById = new Map(ctx.events.map((e) => [e.id, e]));
}

export function offlineContext(confirmed: Readonly<Record<string, string>> = CONFIRMED_COUNT_ALIASES): RunContext {
  const codes = new Set([...Object.values(confirmed), ...Object.values(PROPOSED_COUNT_ALIASES)]);
  const ctx: RunContext = {
    events: [...codes].map((code) => ({
      id: `offline:${code}`,
      eventCode: code,
      name: code,
      eventDate: null,
      userId: "offline",
      clientId: "offline",
    })),
    eventsByCode: new Map(),
    eventsById: new Map(),
    aliases: { ...confirmed },
    notOurs: new Set(),
    ceilings: new Map(),
    counts: [],
    countThreads: new Map(),
    pdfShas: new Set(),
    mentionKeys: new Set(),
    offline: true,
  };
  indexEvents(ctx);
  return ctx;
}

async function loadCeilings(sb: Db, eventIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (eventIds.length === 0) return out;
  const bump = (eventId: string, price: number | null) => {
    if (price === null || !(price > 0)) return;
    const pence = Math.round(Number(price) * 100);
    out.set(eventId, Math.max(out.get(eventId) ?? 0, pence));
  };
  const tiers = await pageAll<{ id: string; event_id: string; price: number | null }>(
    (from, to) =>
      sb.from("event_ticket_tiers").select("id,event_id,price").in("event_id", eventIds).order("id", { ascending: true }).range(from, to),
    ["id"],
    "event_ticket_tiers",
  );
  for (const t of tiers) bump(t.event_id, t.price);
  const releases = await pageAll<{ id: string; event_id: string; price: number | null }>(
    (from, to) =>
      sb.from("event_releases").select("id,event_id,price").in("event_id", eventIds).order("id", { ascending: true }).range(from, to),
    ["id"],
    "event_releases",
  );
  for (const r of releases) bump(r.event_id, r.price);
  return out;
}

export async function loadRunContext(sb: Db): Promise<RunContext> {
  const events = (
    await pageAll<EventRow>(
      (from, to) =>
        sb.from("events").select("id,event_code,name,event_date,user_id,client_id").order("id", { ascending: true }).range(from, to),
      ["id"],
      "events",
    )
  ).map(toRef);
  const names = await pageAll<{ name: string; event_id: string | null; not_ours: boolean }>(
    (from, to) =>
      sb.from("internal_count_show_names").select("name,event_id,not_ours").order("name", { ascending: true }).range(from, to),
    ["name"],
    "internal_count_show_names",
  );
  const blocks = await pageAll<{ id: string; report_id: string; event_id: string; count_date: string; total_tickets: number }>(
    (from, to) =>
      sb
        .from("internal_count_blocks")
        .select("id,report_id,event_id,count_date,total_tickets")
        .eq("status", "written")
        .order("id", { ascending: true })
        .range(from, to),
    ["id"],
    "internal_count_blocks",
  );
  const reports = await pageAll<{ id: string; gmail_thread_id: string | null; sent_at: string | null; pdf_sha256: string | null }>(
    (from, to) =>
      sb
        .from("internal_count_reports")
        .select("id,gmail_thread_id,sent_at,pdf_sha256")
        .eq("kind", "count")
        .order("id", { ascending: true })
        .range(from, to),
    ["id"],
    "internal_count_reports",
  );
  const mentions = await pageAll<{ id: string; detail: { key?: string } }>(
    (from, to) =>
      sb
        .from("internal_count_review_items")
        .select("id,detail")
        .eq("kind", "sale_mention")
        .order("id", { ascending: true })
        .range(from, to),
    ["id"],
    "internal_count_review_items",
  );
  const sentAtOf = new Map(reports.map((r) => [r.id, r.sent_at]));
  const ctx: RunContext = {
    events,
    eventsByCode: new Map(),
    eventsById: new Map(),
    aliases: { ...CONFIRMED_COUNT_ALIASES },
    notOurs: new Set(names.filter((n) => n.not_ours).map((n) => n.name)),
    ceilings: new Map(),
    counts: blocks.map((b) => ({
      eventId: b.event_id,
      countDate: b.count_date,
      total: b.total_tickets,
      blockId: b.id,
      sentAt: sentAtOf.get(b.report_id) ?? null,
    })),
    countThreads: new Map(reports.filter((t) => t.gmail_thread_id).map((t) => [t.gmail_thread_id!, t.id])),
    pdfShas: new Set(reports.map((r) => r.pdf_sha256).filter((x): x is string => !!x)),
    mentionKeys: new Set(mentions.map((m) => m.detail?.key).filter((k): k is string => !!k)),
    offline: false,
  };
  indexEvents(ctx);
  for (const n of names) {
    const code = n.event_id ? ctx.eventsById.get(n.event_id)?.eventCode : null;
    if (code) ctx.aliases[n.name] = code;
  }
  const aliased = [...new Set(Object.values(ctx.aliases))].map((c) => ctx.eventsByCode.get(c)?.id).filter((x): x is string => !!x);
  ctx.ceilings = await loadCeilings(sb, aliased);
  return ctx;
}

export function planContext(ctx: RunContext, confirmed?: Readonly<Record<string, string>>): PlanContext {
  const aliases = confirmed ? { ...ctx.aliases, ...confirmed } : ctx.aliases;
  return {
    eventsByCode: ctx.eventsByCode,
    confirmedAliases: aliases,
    notOurs: ctx.notOurs,
    closest: (name) => {
      const c = closestEvent(
        name,
        ctx.events.filter((e) => e.eventCode).map((e) => ({ eventCode: e.eventCode, name: e.name, eventDate: e.eventDate })),
      );
      return ctx.offline && c ? { ...c, name: c.eventCode } : c;
    },
    priceCeiling: (eventId) => ctx.ceilings.get(eventId) ?? null,
    previousTotal: (eventId, countDate) =>
      ctx.counts
        .filter((c) => c.eventId === eventId && c.countDate < countDate)
        .sort((a, b) => b.countDate.localeCompare(a.countDate))[0]?.total ?? null,
    storedOn: (eventId, countDate) => {
      const c = ctx.counts.find((x) => x.eventId === eventId && x.countDate === countDate);
      return c ? { total: c.total, sentAt: c.sentAt, blockId: c.blockId } : null;
    },
    mentionSeen: (key) => ctx.mentionKeys.has(key),
    latestStored: (eventId) => {
      const c = ctx.counts.filter((x) => x.eventId === eventId).sort((a, b) => b.countDate.localeCompare(a.countDate))[0];
      return c ? { total: c.total, sentAt: c.sentAt, blockId: c.blockId, countDate: c.countDate } : null;
    },
  };
}

/** Record a write in memory: a later write for the same show and date replaces the earlier one. */
export function rememberCount(ctx: RunContext, count: StoredCount): void {
  ctx.counts = ctx.counts.filter((c) => !(c.eventId === count.eventId && c.countDate === count.countDate));
  ctx.counts.push(count);
}
