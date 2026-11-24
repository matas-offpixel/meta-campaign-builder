/**
 * lib/mcp/tools/topline.ts — morning_topline (read-only).
 *
 * The morning brief's "Performance topline" query (scratch/mcp/morning-topline.sql,
 * 24 Nov; sha256 0fb2c72a535431b5…) step for step over PostgREST, since the
 * app can't run raw SQL. Each CTE is one step below; ins / spend / sig live in
 * ./figures.ts so get_event reads the same numbers:
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
import { addDays } from "../../learning/findings/observed-tests.ts";
import { chunks } from "../../learning/findings/read-all.ts";
import type { McpTool, ToolContext } from "../tool-types.ts";
import { loadEvents, type EventRow } from "./shared.ts";
import { eventMatcher, loadInsightsWindow, signupsByEvent, spendByEvent } from "./figures.ts";

export { NAME_CODE } from "./figures.ts";

export type ToplinePhase = "show week" | "on sale" | "presale" | "announced" | "teaser";

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

  // ins → spend, and sigd → sig (lib/mcp/tools/figures.ts, shared with get_event)
  const [insights, sig] = await Promise.all([loadInsightsWindow(ctx.db, from, y), signupsByEvent(ctx.db, ids, from, y)]);
  const spend = spendByEvent(insights, eventMatcher(ev), y);

  // WHERE
  const t = now.getTime();
  const near = (iso: string | null) => iso != null && Date.parse(iso) >= t - 2 * 86_400_000 && Date.parse(iso) <= t + 3 * 86_400_000;
  const kept = ev.filter((e) => {
    const s = spend.get(e.id);
    return (s?.spend_y ?? 0) > 0 || (s?.spend_7d ?? 0) > 2 || (sig.get(e.id)?.sig_y ?? 0) > 0 || near(e.announcement_at) || near(e.presale_at) || near(e.general_sale_at);
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
    return {
      event_code: e.event_code,
      phase: toplinePhase(e, y, now),
      event_date: e.event_date,
      announce: londonLabel(e.announcement_at),
      presale: londonLabel(e.presale_at),
      gen_sale: londonLabel(e.general_sale_at),
      spend_y: s?.spend_y ?? null,
      spend_7d: s?.spend_7d ?? null,
      sig_total: g?.sig_total ?? null,
      sig_y: g?.sig_y ?? null,
      sig_7d: g?.sig_7d ?? null,
      tix_total: x?.total ?? null,
      tix_date: x?.date ?? null,
      tix_since_prev: x?.total != null && x?.prev != null ? x.total - x.prev : null,
      tix_prev_date: x?.prevDate ?? null,
      chk_y: s?.chk_y ?? null,
      chk_7d: s?.chk_7d ?? null,
      misnamed: s?.misnamed ?? null,
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
