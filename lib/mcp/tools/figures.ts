/**
 * lib/mcp/tools/figures.ts
 *
 * Spend, checkouts and CIRQLIN signups, the morning brief's way
 * (scratch/mcp/morning-topline.sql). morning_topline and get_event both read
 * through these, so one show on one day gives the same numbers in both
 * (Matas, 24 Nov).
 *   spend   ad_daily_insights, matched to a show by its campaign id
 *           (events.meta_campaign_id, first show by id) or else the [CODE]
 *           in the campaign name;
 *   signups signup_source_snapshots.signups_day (latest snapshot of the day),
 *           else that day's cirqlin_page_audience difference (signups − the
 *           previous fetch's);
 *   total   the larger of the snapshots' signups_total and the page audience.
 */
import { loadAllPaged } from "../../db/paged-read.ts";
import { addDays } from "../../learning/findings/observed-tests.ts";
import { all, chunks } from "../../learning/findings/read-all.ts";
import type { Db } from "../tool-types.ts";
import type { EventRow } from "./shared.ts";

export const NAME_CODE = /\[([^\]]+)\]/;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export interface InsightRow {
  meta_ad_id: string;
  date: string;
  spend: number | string | null;
  campaign_name: string | null;
  meta_campaign_id: string | null;
  actions: unknown;
}

const INSIGHT_COLUMNS = "meta_ad_id, date, spend, campaign_name, meta_campaign_id, actions";

export const campaignIdsOf = (e: Pick<EventRow, "meta_campaign_id">) => (e.meta_campaign_id ?? "").replace(/ /g, "").split(",").filter(Boolean);

/** The query's `ins.event_id`: campaign id first, then the name's [CODE]; the first show by id wins. */
export function eventMatcher(events: readonly EventRow[]) {
  const sorted = [...events].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(sorted.map((e) => [e.id, e]));
  const byCampaign = new Map<string, string>();
  const byCode = new Map<string, string>();
  for (const e of sorted) {
    for (const c of campaignIdsOf(e)) if (!byCampaign.has(c)) byCampaign.set(c, e.id);
    if (e.event_code && !byCode.has(e.event_code)) byCode.set(e.event_code, e.id);
  }
  return {
    match(row: Pick<InsightRow, "campaign_name" | "meta_campaign_id">): string | undefined {
      const nameCode = NAME_CODE.exec(row.campaign_name ?? "")?.[1] ?? null;
      return (row.meta_campaign_id ? byCampaign.get(row.meta_campaign_id) : undefined) ?? (nameCode ? byCode.get(nameCode) : undefined);
    },
    codeOf: (id: string) => byId.get(id)?.event_code ?? null,
  };
}

/** Every ad-day in the window (y-7..y). */
export function loadInsightsWindow(db: Db, from: string, y: string): Promise<InsightRow[]> {
  return loadAllPaged<InsightRow>(db, "ad_daily_insights", INSIGHT_COLUMNS, ["date", "meta_ad_id"], (q) => q.gte("date", from).lte("date", y));
}

/** The ad-days that can match these shows: their campaign ids, or [CODE] in the name. A superset; eventMatcher decides. */
export async function loadInsightsForEvents(db: Db, events: readonly EventRow[], from: string, y: string): Promise<InsightRow[]> {
  const ids = [...new Set(events.flatMap(campaignIdsOf))];
  const codes = [...new Set(events.map((e) => e.event_code).filter((c): c is string => Boolean(c)))];
  const order = ["date", "meta_ad_id"];
  const parts = await Promise.all([
    ...chunks(ids, 100).map((part) => all(db, "ad_daily_insights", INSIGHT_COLUMNS, (q) => q.gte("date", from).lte("date", y).in("meta_campaign_id", part), order)),
    ...codes.map((code) => all(db, "ad_daily_insights", INSIGHT_COLUMNS, (q) => q.gte("date", from).lte("date", y).ilike("campaign_name", `%[${code}]%`), order)),
  ]);
  const seen = new Map<string, InsightRow>();
  for (const r of parts.flat() as unknown as InsightRow[]) seen.set(`${r.date}|${r.meta_ad_id}`, r);
  return [...seen.values()];
}

function checkoutsOf(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((s, a) => (a && typeof a === "object" && (a as { action_type?: unknown }).action_type === "omni_initiated_checkout" ? s + num((a as { value?: unknown }).value) : s), 0);
}

export interface SpendFigures {
  spend_y: number | null;
  spend_7d: number | null;
  chk_y: number | null;
  chk_7d: number | null;
  misnamed: string | null;
}

/** The query's `spend` CTE, per show. */
export function spendByEvent(insights: readonly InsightRow[], matcher: ReturnType<typeof eventMatcher>, y: string): Map<string, SpendFigures> {
  const acc = new Map<string, { spendY: number; spendPrior: number; chkY: number; chkPrior: number; hasY: boolean; hasPrior: boolean; misnamed: Set<string> }>();
  for (const i of insights) {
    const eventId = matcher.match(i);
    if (!eventId) continue;
    const nameCode = NAME_CODE.exec(i.campaign_name ?? "")?.[1] ?? null;
    const s = acc.get(eventId) ?? { spendY: 0, spendPrior: 0, chkY: 0, chkPrior: 0, hasY: false, hasPrior: false, misnamed: new Set<string>() };
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
    if (nameCode !== matcher.codeOf(eventId) && i.campaign_name) s.misnamed.add(i.campaign_name);
    acc.set(eventId, s);
  }
  const out = new Map<string, SpendFigures>();
  for (const [id, s] of acc) {
    out.set(id, {
      spend_y: s.hasY ? round(s.spendY, 2) : null,
      spend_7d: s.hasPrior ? round(s.spendPrior / 7, 2) : null,
      chk_y: s.hasY ? s.chkY : null,
      chk_7d: s.hasPrior ? round(s.chkPrior / 7, 1) : null,
      misnamed: s.misnamed.size ? [...s.misnamed].sort().join(" | ") : null,
    });
  }
  return out;
}

type Snap = { id: string; event_id: string; day: string; signups_day: number | null; signups_total: number | null; snapshot_at: string };
type Cpa = { page_id: string; fetch_day: string; event_id: string | null; signups: number | null };

export interface SignupFigures {
  sig_y: number | null;
  sig_7d: number | null;
  sig_total: number | null;
}

/** The query's `sigd` + `sig` CTEs, per show. */
export async function signupsByEvent(db: Db, eventIds: readonly string[], from: string, y: string): Promise<Map<string, SignupFigures>> {
  const snaps: Snap[] = [];
  const cpaRows: Cpa[] = [];
  for (const part of chunks([...new Set(eventIds)], 100)) {
    const [s, c] = await Promise.all([
      loadAllPaged<Snap>(db, "signup_source_snapshots", "id, event_id, day, signups_day, signups_total, snapshot_at", ["id"], (q) => q.eq("source", "cirqlin").in("event_id", part)),
      loadAllPaged<Cpa>(db, "cirqlin_page_audience", "page_id, fetch_day, event_id, signups", ["page_id", "fetch_day"], (q) => q.in("event_id", part)),
    ]);
    snaps.push(...s);
    cpaRows.push(...c);
  }
  const snapDay = new Map<string, Snap>();
  const snapMax = new Map<string, number>();
  for (const s of snaps) {
    const k = `${s.event_id}|${s.day}`;
    const prev = snapDay.get(k);
    if (!prev || s.snapshot_at > prev.snapshot_at) snapDay.set(k, s);
    if (s.signups_total != null) snapMax.set(s.event_id, Math.max(snapMax.get(s.event_id) ?? -Infinity, num(s.signups_total)));
  }
  // signups - lag(signups) over (partition by event_id order by fetch_day)
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
  const out = new Map<string, SignupFigures>();
  for (const id of eventIds) {
    let sy: number | null = null;
    let prior: number | null = null;
    for (let d = from; d <= y; d = addDays(d, 1)) {
      const snap = snapDay.get(`${id}|${d}`);
      const n = snap ? num(snap.signups_day) : (cpaDiff.get(`${id}|${d}`) ?? null);
      if (n == null) continue;
      if (d === y) sy = (sy ?? 0) + n;
      else prior = (prior ?? 0) + n;
    }
    const totals = [snapMax.get(id), cpaMax.get(id)].filter((v): v is number => v != null && Number.isFinite(v));
    out.set(id, { sig_y: sy, sig_7d: prior != null ? round(prior / 7, 1) : null, sig_total: totals.length ? Math.max(...totals) : null });
  }
  return out;
}
