/**
 * lib/mcp/tools/topline.ts — morning_topline (read-only).
 *
 * The morning brief's "Performance topline" query (scratch/mcp/morning-topline.sql,
 * 24 Nov; sha256 0fb2c72a535431b5…) step for step over PostgREST, since the
 * app can't run raw SQL. Each CTE is one function below with its name:
 *   y      yesterday in London;
 *   ev     upcoming shows of live clients, with the query's phase;
 *   ins    ad_daily_insights for y-7..y, matched to a show by campaign id
 *          (events.meta_campaign_id), else by the [CODE] in the name;
 *   spend  spend and checkouts yesterday vs the 7-day average, and the
 *          misnamed campaigns (name code ≠ the matched show's code);
 *   sig    CIRQLIN signups: signup_source_snapshots.signups_day, else the
 *          day's cirqlin_page_audience difference;
 *   tix    the latest ticket count and the one before (listAllSnapshotsForEvent);
 * then the query's WHERE and ORDER BY. On top: the "next 72 hours" moments
 * (announce / presale / general sale) the brief writes first. Data, not prose.
 */
import { loadAllPaged } from "../../db/paged-read.ts";
import { addDays } from "../../learning/findings/observed-tests.ts";
import { chunks } from "../../learning/findings/read-all.ts";
import type { McpTool, ToolContext } from "../tool-types.ts";
import { loadEvents, type EventRow } from "./shared.ts";

export type ToplinePhase = "show week" | "on sale" | "presale" | "announced" | "teaser";

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** to_char(ts at time zone 'Europe/London', 'DD Mon HH24:MI'). */
export function londonLabel(iso: string | null): string | null {
  if (!iso) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${MONTHS[Number(parts.month) - 1]} ${parts.hour}:${parts.minute}`;
}
export function londonDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** ev.phase, exactly as the query's CASE. */
export function toplinePhase(e: Pick<EventRow, "event_date" | "announcement_at" | "presale_at" | "general_sale_at">, y: string, now: Date): ToplinePhase {
  const t = now.getTime();
  const passed = (iso: string | null) => iso != null && Date.parse(iso) <= t;
  if (e.event_date && dayDiff(e.event_date, y) >= 0 && dayDiff(e.event_date, y) <= 7) return "show week";
  if (passed(e.general_sale_at)) return "on sale";
  if (passed(e.presale_at)) return "presale";
  if (passed(e.announcement_at)) return "announced";
  return "teaser";
}

export const NAME_CODE = /\[([^\]]+)\]/;

interface InsightRow {
  meta_ad_id: string;
  date: string;
  spend: number | string | null;
  campaign_name: string | null;
  meta_campaign_id: string | null;
  actions: unknown;
}

function checkoutsOf(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((s, a) => (a && typeof a === "object" && (a as { action_type?: unknown }).action_type === "omni_initiated_checkout" ? s + num((a as { value?: unknown }).value) : s), 0);
}

export interface ToplineRow {
  event_code: string | null;
  phase: ToplinePhase;
  event_date: string | null;
  announce: string | null;
  presale: string | null;
  gen_sale: string | null;
  spend_y: number | null;
  spend_7d: number | null;
  sig_total: number | null;
  sig_y: number | null;
  sig_7d: number | null;
  tix_total: number | null;
  tix_date: string | null;
  tix_since_prev: number | null;
  tix_prev_date: string | null;
  chk_y: number | null;
  chk_7d: number | null;
  misnamed: string | null;
}

export interface Moment {
  event_code: string | null;
  moment: "announce" | "presale" | "general_sale";
  at: string;
  london: string | null;
  hoursFromNow: number;
}

export async function morningTopline(ctx: ToolContext): Promise<{ yesterday: string; rows: ToplineRow[]; next72Hours: Moment[]; shows: number }> {
  const now = ctx.now;
  const y = addDays(ctx.today, -1);
  const from = addDays(y, -7);

  // ev
  const ev = (await loadEvents(ctx.db, (q) => q.or(`event_date.is.null,event_date.gte.${y}`))).sort((a, b) => a.id.localeCompare(b.id));
  const ids = ev.map((e) => e.id);
  const byId = new Map(ev.map((e) => [e.id, e]));
  const byCampaign = new Map<string, string>();
  const byCode = new Map<string, string>();
  for (const e of ev) {
    for (const c of (e.meta_campaign_id ?? "").replace(/ /g, "").split(",").filter(Boolean)) if (!byCampaign.has(c)) byCampaign.set(c, e.id);
    if (e.event_code && !byCode.has(e.event_code)) byCode.set(e.event_code, e.id);
  }

  // ins → spend
  const insights = await loadAllPaged<InsightRow>(
    ctx.db,
    "ad_daily_insights",
    "meta_ad_id, date, spend, campaign_name, meta_campaign_id, actions",
    ["date", "meta_ad_id"],
    (q) => q.gte("date", from).lte("date", y),
  );
  const spend = new Map<string, { spendY: number; spendPrior: number; chkY: number; chkPrior: number; hasY: boolean; hasPrior: boolean; misnamed: Set<string> }>();
  for (const i of insights) {
    const nameCode = NAME_CODE.exec(i.campaign_name ?? "")?.[1] ?? null;
    const eventId = (i.meta_campaign_id ? byCampaign.get(i.meta_campaign_id) : undefined) ?? (nameCode ? byCode.get(nameCode) : undefined);
    if (!eventId) continue;
    const s = spend.get(eventId) ?? { spendY: 0, spendPrior: 0, chkY: 0, chkPrior: 0, hasY: false, hasPrior: false, misnamed: new Set<string>() };
    const chk = checkoutsOf(i.actions);
    if (i.date === y) {
      s.spendY += num(i.spend);
      s.chkY += chk;
      s.hasY = true;
    } else {
      s.spendPrior += num(i.spend);
      s.chkPrior += chk;
      s.hasPrior = true;
    }
    if (nameCode !== (byId.get(eventId)?.event_code ?? null) && i.campaign_name) s.misnamed.add(i.campaign_name);
    spend.set(eventId, s);
  }

  // sig: signup_source_snapshots and cirqlin_page_audience for every show in ev.
  type Snap = { id: string; event_id: string; day: string; signups_day: number | null; signups_total: number | null; snapshot_at: string };
  type Cpa = { page_id: string; fetch_day: string; event_id: string | null; signups: number | null };
  const snaps: Snap[] = [];
  const cpaRows: Cpa[] = [];
  for (const part of chunks(ids, 100)) {
    const [s, c] = await Promise.all([
      loadAllPaged<Snap>(ctx.db, "signup_source_snapshots", "id, event_id, day, signups_day, signups_total, snapshot_at", ["id"], (q) => q.eq("source", "cirqlin").in("event_id", part)),
      loadAllPaged<Cpa>(ctx.db, "cirqlin_page_audience", "page_id, fetch_day, event_id, signups", ["page_id", "fetch_day"], (q) => q.in("event_id", part)),
    ]);
    snaps.push(...s);
    cpaRows.push(...c);
  }
  // Latest snapshot per (event, day); max total per event.
  const snapDay = new Map<string, Snap>();
  const snapMax = new Map<string, number>();
  for (const s of snaps) {
    const k = `${s.event_id}|${s.day}`;
    const prev = snapDay.get(k);
    if (!prev || s.snapshot_at > prev.snapshot_at) snapDay.set(k, s);
    if (s.signups_total != null) snapMax.set(s.event_id, Math.max(snapMax.get(s.event_id) ?? -Infinity, num(s.signups_total)));
  }
  // cpa: signups - lag(signups) over (partition by event_id order by fetch_day).
  const cpaDiff = new Map<string, number | null>();
  const cpaMax = new Map<string, number>();
  const cpaByEvent = new Map<string, Cpa[]>();
  for (const c of cpaRows) {
    if (!c.event_id) continue;
    (cpaByEvent.get(c.event_id) ?? cpaByEvent.set(c.event_id, []).get(c.event_id)!).push(c);
    if (c.signups != null) cpaMax.set(c.event_id, Math.max(cpaMax.get(c.event_id) ?? -Infinity, num(c.signups)));
  }
  for (const [eventId, rows] of cpaByEvent) {
    rows.sort((a, b) => a.fetch_day.localeCompare(b.fetch_day));
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      cpaDiff.set(`${eventId}|${r.fetch_day}`, prev && r.signups != null && prev.signups != null ? num(r.signups) - num(prev.signups) : null);
    });
  }
  const sig = new Map<string, { y: number | null; prior: number | null }>();
  for (const e of ev) {
    let sy: number | null = null;
    let prior: number | null = null;
    for (let d = from; d <= y; d = addDays(d, 1)) {
      const snap = snapDay.get(`${e.id}|${d}`);
      const n = snap ? num(snap.signups_day) : cpaDiff.get(`${e.id}|${d}`) ?? null;
      if (n == null) continue;
      if (d === y) sy = (sy ?? 0) + n;
      else prior = (prior ?? 0) + n;
    }
    sig.set(e.id, { y: sy, prior });
  }

  // WHERE
  const t = now.getTime();
  const near = (iso: string | null) => iso != null && Date.parse(iso) >= t - 2 * 86_400_000 && Date.parse(iso) <= t + 3 * 86_400_000;
  const kept = ev.filter((e) => {
    const s = spend.get(e.id);
    const spendY = s?.hasY ? s.spendY : 0;
    const spend7 = s?.hasPrior ? s.spendPrior / 7 : 0;
    return spendY > 0 || spend7 > 2 || (sig.get(e.id)?.y ?? 0) > 0 || near(e.announcement_at) || near(e.presale_at) || near(e.general_sale_at);
  });

  // tix, for the kept shows only (it decides nothing in the WHERE).
  const tix = new Map<string, { total: number | null; date: string | null; prev: number | null; prevDate: string | null }>();
  for (const part of chunks(kept, 8)) {
    await Promise.all(
      part.map(async (e) => {
        const rows = (await ctx.readers.ticketSnapshots(ctx.db, e.id)).sort((a, b) => b.snapshot_at.localeCompare(a.snapshot_at));
        const [a, b] = rows;
        tix.set(e.id, { total: a?.tickets_sold ?? null, date: a ? londonDate(a.snapshot_at) : null, prev: b?.tickets_sold ?? null, prevDate: b ? londonDate(b.snapshot_at) : null });
      }),
    );
  }

  const rows: ToplineRow[] = kept.map((e) => {
    const s = spend.get(e.id);
    const g = sig.get(e.id);
    const x = tix.get(e.id);
    const totals = [snapMax.get(e.id), cpaMax.get(e.id)].filter((v): v is number => v != null && Number.isFinite(v));
    return {
      event_code: e.event_code,
      phase: toplinePhase(e, y, now),
      event_date: e.event_date,
      announce: londonLabel(e.announcement_at),
      presale: londonLabel(e.presale_at),
      gen_sale: londonLabel(e.general_sale_at),
      spend_y: s?.hasY ? round(s.spendY, 2) : null,
      spend_7d: s?.hasPrior ? round(s.spendPrior / 7, 2) : null,
      sig_total: totals.length ? Math.max(...totals) : null,
      sig_y: g?.y ?? null,
      sig_7d: g?.prior != null ? round(g.prior / 7, 1) : null,
      tix_total: x?.total ?? null,
      tix_date: x?.date ?? null,
      tix_since_prev: x?.total != null && x?.prev != null ? x.total - x.prev : null,
      tix_prev_date: x?.prevDate ?? null,
      chk_y: s?.hasY ? s.chkY : null,
      chk_7d: s?.hasPrior ? round(s.chkPrior / 7, 1) : null,
      misnamed: s && s.misnamed.size ? [...s.misnamed].sort().join(" | ") : null,
    };
  });
  rows.sort((a, b) => (b.spend_y ?? 0) - (a.spend_y ?? 0) || String(a.event_code).localeCompare(String(b.event_code)));

  const next72Hours: Moment[] = [];
  for (const e of ev) {
    for (const [moment, at] of [
      ["announce", e.announcement_at],
      ["presale", e.presale_at],
      ["general_sale", e.general_sale_at],
    ] as const) {
      if (!at) continue;
      const ms = Date.parse(at) - t;
      if (ms >= 0 && ms <= 72 * 3_600_000) next72Hours.push({ event_code: e.event_code, moment, at, london: londonLabel(at), hoursFromNow: round(ms / 3_600_000, 1) });
    }
  }
  next72Hours.sort((a, b) => a.at.localeCompare(b.at));
  return { yesterday: y, rows, next72Hours, shows: ev.length };
}

export const morningToplineTool: McpTool = {
  name: "morning_topline",
  title: "Morning topline",
  kind: "read",
  description: [
    "The morning brief's performance topline for every upcoming show that spent, got signups, or has a moment near: phase, spend yesterday vs the 7-day daily average, CIRQLIN signups, tickets since the last count, checkouts, and campaigns whose [CODE] doesn't match their show (misnamed).",
    "Also lists the announce / presale / general-sale moments in the next 72 hours. Returns data; write the brief from it, judging each show on its phase's goal (teaser / announced → signups; presale / on sale / show week → tickets and checkouts).",
    "Example: morning_topline({}).",
  ].join(" "),
  inputSchema: {},
  async run(ctx) {
    const out = await morningTopline(ctx);
    return {
      data: { today: ctx.today, ...out },
      summary: { rows: out.rows.length, next72Hours: out.next72Hours.length, shows: out.shows, misnamed: out.rows.filter((r) => r.misnamed).length },
    };
  },
};
