/**
 * RP2 / RP3's loader: variant pairs and phase curves, read in the same
 * /api/cron/learning-findings run, after observed tests.
 *
 * Reads (zero Meta calls):
 *   - ad_daily_insights in the last DISCOVERY_DAYS days, for the ad sets and
 *     shows that delivered (one narrow read);
 *   - every day of those ad sets, for pairs (show test campaigns left out:
 *     their call is RP1's);
 *   - every day of each show's campaigns with any phase boundary ("[CODE]" in
 *     the name), for its curve;
 *   - events (code → client and phase dates), archived clients
 *     (lib/db/client-status.ts).
 *
 * Shows are matched by the first [CODE] in a campaign name, exactly as written,
 * to an events row. Pure work is in variant-pairs.ts and phase-curve.ts.
 */

import { GBP_PER_UNIT } from "../currency.ts";
import { addDays, eventCodeOf } from "./observed-tests.ts";
import { curveRows, phaseCurve, type CurveDay, type CurveFindingRow, type PhaseCurve } from "./phase-curve.ts";
import { hasPhaseData, type PhaseEvent } from "./phase.ts";
import { all, chunks, str, type Db } from "./read-all.ts";
import { campaignEventCode, findPairs, pairRow, type ComparedPair, type NotCompared, type PairAdDay, type PairFindingRow } from "./variant-pairs.ts";

const PAIR_COLUMNS =
  "date, meta_ad_id, meta_adset_id, meta_campaign_id, campaign_name, adset_name, ad_name, ad_account_id, spend, landing_page_views, registrations, purchases, actions, promoted_event, optimization_goal, campaign_objective";
const CURVE_COLUMNS = "date, meta_ad_id, campaign_name, ad_account_id, spend, landing_page_views, registrations, purchases, actions, promoted_event, optimization_goal, campaign_objective";

export type ShowContext = { eventId: string; clientId: string | null; phase: PhaseEvent };

export type PairsCurvesRead = {
  pairs: ComparedPair[];
  notCompared: NotCompared[];
  curves: PhaseCurve[];
  pairRows: PairFindingRow[];
  curveRows: CurveFindingRow[];
  shows: number;
  skippedArchived: number;
  timings: { discoverMs: number; pairsMs: number; curvesMs: number };
};

export async function readPairsAndCurves(input: {
  db: Db;
  readOn: string;
  discoveryDays: number;
  archived: ReadonlySet<string>;
  accountCurrency: (adAccountId: string | null) => string;
  eventCodes?: string[];
  computedAt: string;
}): Promise<PairsCurvesRead> {
  const { db, readOn } = input;
  const yesterday = addDays(readOn, -1);
  const t0 = Date.now();

  // 1. What delivered in the window: ad sets (not in show test campaigns) and the shows they're named for.
  const recent = await all(db, "ad_daily_insights", "date, meta_ad_id, meta_adset_id, campaign_name", (q) => q.gte("date", addDays(readOn, -input.discoveryDays)).lte("date", yesterday), ["date", "meta_ad_id"]);
  const wanted = (code: string | null) => Boolean(code) && (!input.eventCodes?.length || input.eventCodes.includes(code!));
  const adsetIds = new Set<string>();
  const codes = new Set<string>();
  for (const r of recent) {
    const name = str(r, "campaign_name");
    if (eventCodeOf(name)) continue;
    const code = campaignEventCode(name);
    if (!wanted(code)) continue;
    codes.add(code!);
    if (str(r, "meta_adset_id")) adsetIds.add(str(r, "meta_adset_id"));
  }
  const events = codes.size ? await all(db, "events", "id, event_code, client_id, announcement_at, presale_at, general_sale_at", (q) => q.in("event_code", [...codes]), ["id"]) : [];
  const shows = new Map<string, ShowContext>();
  let skippedArchived = 0;
  for (const e of events) {
    const code = str(e, "event_code");
    if (shows.has(code)) continue;
    const clientId = str(e, "client_id") || null;
    if (clientId && input.archived.has(clientId)) {
      skippedArchived += 1;
      continue;
    }
    shows.set(code, { eventId: str(e, "id"), clientId, phase: { announcement_at: (e.announcement_at as string | null) ?? null, presale_at: (e.presale_at as string | null) ?? null, general_sale_at: (e.general_sale_at as string | null) ?? null } });
  }
  const t1 = Date.now();

  // 2. Pairs: every day of the ad sets, to yesterday; only shows with an active event row.
  const pairDays: PairAdDay[] = [];
  for (const ids of chunks([...adsetIds].sort(), 100)) {
    pairDays.push(...((await all(db, "ad_daily_insights", PAIR_COLUMNS, (q) => q.in("meta_adset_id", ids).lte("date", yesterday), ["date", "meta_ad_id"])) as unknown as PairAdDay[]));
  }
  const showDays = pairDays.filter((d) => shows.has(campaignEventCode(d.campaign_name) ?? ""));
  const phases = new Map([...shows].map(([code, s]) => [code, s.phase]));
  const { pairs, notCompared } = findPairs({ days: showDays, events: phases, gbpRate: (id) => GBP_PER_UNIT[input.accountCurrency(id)] ?? 1 });
  const pairRows = pairs.map((p) => {
    const show = shows.get(p.eventCode);
    const currency = input.accountCurrency(p.adAccountId);
    return pairRow(p, { eventId: show?.eventId ?? null, clientId: show?.clientId ?? null, gbpRate: GBP_PER_UNIT[currency] ?? 1, currency, computedAt: input.computedAt });
  });
  const t2 = Date.now();

  // 3. Curves: every day of each show's campaigns, for shows with phase data; one row for each show without.
  const curves: PhaseCurve[] = [];
  const curveRowsOut: CurveFindingRow[] = [];
  for (const [code, show] of [...shows].sort(([a], [b]) => a.localeCompare(b))) {
    const days = hasPhaseData(show.phase) ? ((await all(db, "ad_daily_insights", CURVE_COLUMNS, (q) => q.ilike("campaign_name", `%[${code}]%`).lte("date", yesterday), ["date", "meta_ad_id"])) as unknown as (CurveDay & { ad_account_id: string | null })[]) : [];
    const curve = phaseCurve({ eventCode: code, event: show.phase, days });
    curves.push(curve);
    const currency = input.accountCurrency(days[0]?.ad_account_id ?? null);
    curveRowsOut.push(...curveRows(curve, { eventId: show.eventId, clientId: show.clientId, gbpRate: GBP_PER_UNIT[currency] ?? 1, currency, computedAt: input.computedAt }));
  }
  const t3 = Date.now();

  return { pairs, notCompared, curves, pairRows, curveRows: curveRowsOut, shows: shows.size, skippedArchived, timings: { discoverMs: t1 - t0, pairsMs: t2 - t1, curvesMs: t3 - t2 } };
}

/** PostgREST's in-list, each value quoted (subjects carry "|"). */
function inList(values: readonly string[]): string {
  return `(${values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",")})`;
}

/** A show's curve rows from an earlier night that this night's curve no longer has (a phase gained data, or the show gained an announcement). */
export async function deleteStaleCurveRows(db: Db, curveRowsByShow: ReadonlyMap<string, readonly string[]>): Promise<string | null> {
  for (const [code, subjects] of curveRowsByShow) {
    if (!subjects.length) continue;
    const q = db.from("learning_findings").delete().eq("kind", "phase_curve").eq("scope", "event").eq("scope_id", code) as unknown as { not(c: string, op: string, v: string): PromiseLike<{ error: { message: string } | null }> };
    const res = await q.not("subject", "in", inList(subjects));
    if (res.error) return `learning_findings: ${res.error.message}`;
  }
  return null;
}
