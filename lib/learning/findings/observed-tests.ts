/**
 * RP1 (docs/design-record/2026-11-23-north-star-3.html, §9.1): observed tests.
 *
 * Every ad set in a show test campaign ("{code} · Tests", and the 17 Nov
 * round's "{code} · AB copy test" / "{code} · Artist cards test",
 * `isShowTestCampaign`) is a test, whether or not the app made it. Its
 * variants are its ads. It gets the call the app gives its own tests:
 *
 * - TF2's read (`readTest`) with TF5's benchmark (`showBenchmark`) and TF6's
 *   extension / stop (`readWithBenchmark`), all unchanged;
 * - TF9's cadence (read-job.ts): the end day (day 4, then 8 and 12 after an
 *   extension) decides at its 08:00 London read, a missed end day falls back
 *   to the next morning's read, and the morning after an end day is TF2's
 *   last read. There is no separate 7-day stop (§9.1);
 * - the same words (words.ts, benchmark-call.ts).
 *
 * New cases, before the call: one ad → "One variant: no call"; an ad set
 * whose result event no test reads (Add to cart, Purchase) → "Optimises for
 * {event}: no call".
 *
 * Observed tests are never written to Meta. Where TF6 would extend the app's
 * own ad set, an observed test's next read simply moves to day 8 (or 12): the
 * state machine (extensions, the day-4 / day-8 marks) lives in the finding's
 * evidence, not in creative_tests. One ad set, one finding: an ad set with a
 * creative_tests row is the app's own read's (the loader skips it).
 *
 * The insights are daily, so first delivery is the start of the first London
 * day the ad set spent on (the app's read takes the ad set's start time).
 *
 * Pure: no database, no Meta. load-observed-tests.ts passes the rows in.
 */

import { resultsOf, type AdDay } from "../../creative-tests/approve.ts";
import { showBenchmark, type ShowBenchmark } from "../../creative-tests/benchmark.ts";
import { marks, readWithBenchmark, type BenchmarkRead, type ExtensionEvidence } from "../../creative-tests/benchmark-call.ts";
import { londonDay, type VariantFigures, type VariantRead } from "../../creative-tests/fast-call.ts";
import { isShowTestCampaign } from "../../creative-tests/tests-campaign.ts";
import type { ResultEvent } from "../../creative-tests/words.ts";
import { phaseFromMetaObjective } from "../../launched-ad-sets/snapshot.ts";

// ── Words (new cases, in words.ts's style) ──────────────────────────────────

export const ONE_VARIANT = "One variant: no call";

/** "Optimises for add to cart: no call". */
export function noResultEventText(event: string): string {
  return `Optimises for ${event.trim().toLowerCase().replace(/_/g, " ") || "an unknown event"}: no call`;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

/** One ad_daily_insights row of a test ad set (the columns the loader reads). */
export type ObservedAdDay = AdDay & {
  adset_name: string | null;
  ad_name: string | null;
  ad_account_id: string | null;
  promoted_event: string | null;
  optimization_goal: string | null;
  campaign_objective: string | null;
};

export type ObservedTest = {
  eventCode: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adAccountId: string | null;
  /** Its ads, by spend (then id). */
  ads: { adId: string; label: string }[];
  days: ObservedAdDay[];
};

/** What a test carries between reads (the app keeps it on creative_tests; an observed test in its finding's evidence). */
export type ObservedState = {
  extensions: number;
  evidence: ExtensionEvidence;
  /** London days a read ran on. */
  reads: string[];
  /** The test has ended: its finding stands from here. */
  final: boolean;
};

export const INITIAL_STATE: ObservedState = { extensions: 0, evidence: {}, reads: [], final: false };

/** The stored finding's state: before and after its last read, so a rerun on the same day starts from the same place. */
export type PriorRead = { readOn: string; before: ObservedState; after: ObservedState };

// ── Helpers ─────────────────────────────────────────────────────────────────

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const clean = (name: string | null | undefined): string => (name ?? "").replace(/\s+/g, " ").trim();

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** An hour of a London day as an instant: londonAt("2026-11-23", 8) → "2026-11-23T08:00:00.000Z" (GMT) or 07:00Z (BST). */
export function londonAt(day: string, hour: number): string {
  const guess = Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
  const shown = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(new Date(guess)));
  const offset = ((((shown - hour) % 24) + 36) % 24) - 12;
  return new Date(guess - offset * 3_600_000).toISOString();
}

/** The Monday of a London day's ISO week. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

/** The event code a test campaign is named with: "EBR26-KREAM · AB copy test" → "EBR26-KREAM". Null when the name isn't a show test campaign. */
export function eventCodeOf(campaignName: string | null | undefined): string | null {
  const name = (campaignName ?? "").trim();
  const code = name.split(" · ")[0]?.trim() ?? "";
  return code && isShowTestCampaign(name, code) ? code : null;
}

/**
 * The result a test is read on, from the ad set's optimisation (as joins.ts's
 * resultOf reads it): Initiate Checkout, Complete Registration (or a lead), or
 * landing-page views. Anything else (Add to cart, Purchase) is no test result.
 */
export function resultEventOf(promotedEvent: string | null | undefined, optimizationGoal: string | null | undefined): ResultEvent | null {
  const event = (promotedEvent ?? "").trim().toUpperCase();
  const goal = (optimizationGoal ?? "").trim().toUpperCase();
  if (event === "INITIATED_CHECKOUT") return "initiate_checkout";
  if (event === "COMPLETE_REGISTRATION" || event === "LEAD" || goal === "LEAD_GENERATION") return "complete_registration";
  if (!event && goal === "LANDING_PAGE_VIEWS") return "landing_page_view";
  return null;
}

/** The finding's stage, from what Meta says the ad set is for (joins.ts's meta_objective rung). */
export function stageOfTest(day: Pick<ObservedAdDay, "campaign_objective" | "optimization_goal" | "promoted_event"> | undefined): "registration" | "ticket_sale" | "unknown" {
  const phase = day ? phaseFromMetaObjective({ campaignObjective: day.campaign_objective, optimizationGoal: day.optimization_goal, promotedEvent: day.promoted_event }) : null;
  if (phase === "presale" || phase === "waiting_list") return "registration";
  if (phase === "on_sale") return "ticket_sale";
  return "unknown";
}

/** ad_daily_insights rows of show test campaigns → one test per ad set. Rows of any other campaign are ignored. */
export function groupObservedTests(rows: readonly ObservedAdDay[]): ObservedTest[] {
  const byAdSet = new Map<string, ObservedTest>();
  for (const row of rows) {
    const code = eventCodeOf(row.campaign_name);
    if (!code || !row.meta_adset_id || !row.meta_ad_id) continue;
    let test = byAdSet.get(row.meta_adset_id);
    if (!test) {
      test = { eventCode: code, campaignId: row.meta_campaign_id, campaignName: clean(row.campaign_name), adsetId: row.meta_adset_id, adsetName: clean(row.adset_name), adAccountId: row.ad_account_id, ads: [], days: [] };
      byAdSet.set(row.meta_adset_id, test);
    }
    test.days.push(row);
    if (!test.adsetName && row.adset_name) test.adsetName = clean(row.adset_name);
  }
  for (const test of byAdSet.values()) {
    const spend = new Map<string, number>();
    const label = new Map<string, string>();
    for (const d of test.days) {
      spend.set(d.meta_ad_id, (spend.get(d.meta_ad_id) ?? 0) + num(d.spend));
      // The latest name wins: a rename in Ads Manager is the ad's name now.
      if (d.ad_name) label.set(d.meta_ad_id, clean(d.ad_name));
    }
    test.ads = [...spend.keys()].sort((a, b) => (spend.get(b)! - spend.get(a)!) || a.localeCompare(b)).map((adId) => ({ adId, label: label.get(adId) || adId }));
    test.days.sort((a, b) => a.date.localeCompare(b.date) || a.meta_ad_id.localeCompare(b.meta_ad_id));
  }
  return [...byAdSet.values()].sort((a, b) => a.eventCode.localeCompare(b.eventCode) || a.campaignName.localeCompare(b.campaignName) || a.adsetId.localeCompare(b.adsetId));
}

// ── The read ────────────────────────────────────────────────────────────────

export type EndDayPhase = "before" | "end_day" | "after_end";

export type ObservedVariant = VariantRead & { adId: string };

export type ObservedRead = {
  /** "one_variant", "no_result_event", TF2's state, or TF6's "extended" / "stopped" (as creative_test_reads.state). */
  state: string;
  text: string;
  readOn: string;
  /** Days since first delivery at this read: 4, 8 and 12 are end days. */
  readDay: number | null;
  hours: number | null;
  result: ResultEvent | null;
  promotedEvent: string | null;
  firstDeliveryDay: string | null;
  /** Figures run from first delivery to this day (the day before the read). */
  figuresTo: string;
  endDay: string | null;
  phase: EndDayPhase | null;
  /** This read makes TF6's call (the end day, or the missed end day's fallback). */
  decides: boolean;
  action: "none" | "extend" | "stop";
  /** Why TF6's decision didn't move the state, when it didn't. */
  pending: string | null;
  spendTotal: number;
  results: number;
  variants: ObservedVariant[];
  leaderId: string | null;
  winnerId: string | null;
  cheaperId: string | null;
  benchmark: ShowBenchmark | null;
  before: ObservedState;
  after: ObservedState;
};

export type ReadInput = {
  test: ObservedTest;
  /** The show's ad-days on [first delivery, the day before the read]: every campaign named with its code (TF5). */
  showDays: readonly Pick<AdDay, "date" | "campaign_name" | "spend" | "landing_page_views" | "registrations" | "actions">[];
  /** The London day of the read. */
  readOn: string;
  prior?: PriorRead | null;
  /** TF9: yesterday's insights are restated (today's ad-daily-insights run). A read that isn't moves no state. */
  covered?: boolean;
  currency?: string | null;
};

/**
 * One observed test's read on `readOn`, or null when its finding already
 * stands (it ended on an earlier read). Mirrors read-job.ts's readOne, with
 * the state machine kept in the finding instead of creative_tests, and no
 * writes.
 */
export function readObservedTest(input: ReadInput): ObservedRead | null {
  const { test, readOn } = input;
  const prior = input.prior ?? null;
  if (prior && prior.after.final && prior.readOn < readOn) return null;
  const before: ObservedState = prior ? (prior.readOn === readOn ? prior.before : prior.after) : INITIAL_STATE;
  const yesterday = addDays(readOn, -1);
  const sample = test.days.find((d) => d.promoted_event || d.optimization_goal) ?? test.days[0];
  const result = resultEventOf(sample?.promoted_event, sample?.optimization_goal);
  const delivered = test.days.filter((d) => num(d.spend) > 0 && d.date <= yesterday);
  const firstDeliveryDay = delivered.length ? delivered.reduce((m, d) => (d.date < m ? d.date : m), delivered[0]!.date) : null;
  const readAt = londonAt(readOn, 8);
  const own = (adId: string) => test.days.filter((d) => d.meta_ad_id === adId && d.date <= yesterday && (!firstDeliveryDay || d.date >= firstDeliveryDay));

  const figures: (VariantFigures & { adId: string })[] = test.ads.map((ad) => {
    const days = own(ad.adId);
    return { id: ad.adId, adId: ad.adId, label: ad.label, spend: Math.round(days.reduce((s, d) => s + num(d.spend), 0) * 100) / 100, results: result ? days.reduce((s, d) => s + resultsOf(d, result), 0) : 0 };
  });
  const spendTotal = Math.round(figures.reduce((s, f) => s + f.spend, 0) * 100) / 100;
  const results = figures.reduce((s, f) => s + f.results, 0);
  const plain = (state: string, text: string): ObservedRead => {
    const share = (f: { spend: number }) => (spendTotal > 0 ? f.spend / spendTotal : 0);
    const variants = figures.map((f) => ({ ...f, share: share(f), judged: share(f) >= 0.1, cost: f.results > 0 ? f.spend / f.results : null }));
    const after: ObservedState = { ...before, reads: [...new Set([...before.reads, readOn])], final: true };
    return { state, text, readOn, readDay: firstDeliveryDay ? daysBetween(firstDeliveryDay, readOn) : null, hours: null, result, promotedEvent: sample?.promoted_event ?? null, firstDeliveryDay, figuresTo: yesterday, endDay: null, phase: null, decides: false, action: "none", pending: null, spendTotal, results, variants, leaderId: null, winnerId: null, cheaperId: null, benchmark: null, before, after };
  };

  // The new cases: no call is made.
  if (test.ads.length < 2) return plain("one_variant", ONE_VARIANT);
  if (!result) return plain("no_result_event", noResultEventText(sample?.promoted_event || sample?.optimization_goal || ""));

  const firstDeliveryAt = firstDeliveryDay ? londonAt(firstDeliveryDay, 0) : null;
  const startDay = firstDeliveryDay ?? readOn;

  // TF9: the end day (day 4, 8 or 12), and whether its read ran.
  const extensions = Math.max(0, Math.floor(before.extensions || 0));
  const endDay = addDays(startDay, 4 * (extensions + 1));
  const phase: EndDayPhase = readOn < endDay ? "before" : readOn === endDay ? "end_day" : "after_end";
  const endDayReadRan = phase === "after_end" && before.reads.includes(endDay);
  const fallback = phase === "after_end" && !endDayReadRan;
  const decides = phase === "end_day" || fallback;
  const tf2Final = phase === "after_end";

  // TF5's benchmark over the test's days. An observed test holds no budget of the app's, so R5's cap is room, except after an
  // end day whose read ran and didn't extend: the ad set ended then, and the call can only stop (read-job's capLeft 0).
  const benchmark = showBenchmark(input.showDays, { eventCode: test.eventCode, result, fromDay: startDay, toDay: yesterday });
  const read: BenchmarkRead = readWithBenchmark({
    firstDeliveryAt,
    startedAt: firstDeliveryAt,
    readAt,
    variants: figures,
    result,
    benchmark: benchmark.cost,
    extensions,
    evidence: before.evidence,
    dailyMinor: 0,
    capLeftMinor: endDayReadRan ? -1 : null,
    currency: input.currency ?? null,
    boundaryReached: phase !== "before",
    tf2Final,
  });

  // The state after this read, as read-job.ts moves creative_tests.
  const covered = input.covered ?? true;
  const action = read.action.kind;
  const whyNot = !decides ? "not an end day" : !covered ? "yesterday's insights aren't restated yet" : null;
  let pending: string | null = null;
  let after: ObservedState = { ...before, reads: [...new Set([...before.reads, readOn])] };
  if (action === "stop" && whyNot && phase === "after_end") {
    after = { ...after, final: true };
  } else if ((action === "extend" || action === "stop") && whyNot) {
    pending = whyNot;
  } else if (read.action.kind === "extend") {
    const kept: ExtensionEvidence = { ...before.evidence, ...(read.action.extension === 1 ? { day4: marks(read.variants) } : { day8: marks(read.variants), second: read.action.earnedBy }) };
    after = { ...after, extensions: read.action.extension, evidence: kept };
  } else if (action === "stop") {
    after = { ...after, final: true };
  } else if (read.state === "no_clear_winner" || read.state === "not_enough_variants") {
    after = { ...after, final: true };
  }

  return {
    state: read.stage !== "tf2" ? read.stage : read.state,
    text: read.text,
    readOn,
    readDay: firstDeliveryDay ? daysBetween(firstDeliveryDay, readOn) : null,
    hours: read.hours,
    result,
    promotedEvent: sample?.promoted_event ?? null,
    firstDeliveryDay,
    figuresTo: yesterday,
    endDay,
    phase,
    decides,
    action,
    pending,
    spendTotal: read.spendTotal,
    results,
    variants: read.variants.map((v) => ({ ...v, adId: v.id })),
    leaderId: read.leaderId,
    winnerId: read.winnerId,
    cheaperId: read.cheaperId,
    benchmark,
    before,
    after,
  };
}

// ── The finding ─────────────────────────────────────────────────────────────

export type LearningFindingRow = {
  kind: "test_verdict";
  scope: "event";
  scope_id: string;
  event_id: string | null;
  client_id: string | null;
  stage: string;
  week_start: string;
  subject: string;
  metric: string;
  value_a: number | null;
  value_b: number | null;
  ratio: number | null;
  n_shows: number;
  n_pairs: number | null;
  spend_gbp: number;
  results: number;
  confidence: null;
  verdict: string;
  read_day: number | null;
  source: string | null;
  evidence: Record<string, unknown>;
  recommendation: null;
  computed_at: string;
};

const round = (n: number | null, places = 4): number | null => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** places) / 10 ** places);

/**
 * The learning_findings row of a read. One ad set, one row: the subject is the
 * ad set id and the week is its first delivery's, so every later read
 * replaces the row. value_a is the leader's (or the winner's) cost per result,
 * value_b the show's benchmark, ratio a ÷ b.
 */
export function findingRow(test: ObservedTest, read: ObservedRead, ctx: { eventId: string | null; clientId: string | null; gbpRate: number; currency: string | null; computedAt: string }): LearningFindingRow {
  const lead = read.variants.find((v) => v.adId === (read.winnerId ?? read.leaderId)) ?? null;
  const valueA = round(lead?.cost ?? null);
  const valueB = round(read.benchmark?.cost ?? null);
  return {
    kind: "test_verdict",
    scope: "event",
    scope_id: test.eventCode,
    event_id: ctx.eventId,
    client_id: ctx.clientId,
    stage: stageOfTest(test.days.find((d) => d.campaign_objective || d.promoted_event) ?? test.days[0]),
    week_start: weekStart(read.firstDeliveryDay ?? read.readOn),
    subject: test.adsetId,
    metric: read.result ? `cost_per_${read.result}` : "none",
    value_a: valueA,
    value_b: valueB,
    ratio: valueA != null && valueB != null && valueB > 0 ? round(valueA / valueB) : null,
    n_shows: 1,
    n_pairs: null,
    spend_gbp: Math.round(read.spendTotal * ctx.gbpRate * 100) / 100,
    results: read.results,
    confidence: null,
    verdict: read.state,
    read_day: read.readDay,
    source: null,
    evidence: {
      observed: true,
      text: read.text,
      readOn: read.readOn,
      figuresTo: read.figuresTo,
      hours: read.hours == null ? null : Math.round(read.hours * 10) / 10,
      campaignId: test.campaignId,
      campaignName: test.campaignName,
      adsetName: test.adsetName,
      adAccountId: test.adAccountId,
      currency: ctx.currency,
      result: read.result,
      promotedEvent: read.promotedEvent,
      firstDeliveryDay: read.firstDeliveryDay,
      endDay: read.endDay,
      phase: read.phase,
      decides: read.decides,
      action: read.action,
      pending: read.pending,
      // The app writes nothing for an observed test: an "Extended" read means its next read is day 8 (or 12).
      wrote: false,
      leaderAdId: read.leaderId,
      winnerAdId: read.winnerId,
      cheaperAdId: read.cheaperId,
      benchmark: read.benchmark,
      variants: read.variants.map((v) => ({ adId: v.adId, label: v.label, spend: v.spend, share: round(v.share), results: v.results, cost: round(v.cost), judged: v.judged })),
      state: { before: read.before, after: read.after },
    },
    recommendation: null,
    computed_at: ctx.computedAt,
  };
}

/** The stored row's state, for the next read. Null for a row this module didn't write. */
export function priorOf(row: { evidence?: unknown } | null | undefined): PriorRead | null {
  const ev = (row?.evidence ?? null) as { readOn?: unknown; state?: { before?: ObservedState; after?: ObservedState } } | null;
  if (!ev || typeof ev.readOn !== "string" || !ev.state?.before || !ev.state?.after) return null;
  return { readOn: ev.readOn, before: ev.state.before, after: ev.state.after };
}

/** Today's London day. */
export function todayLondon(now: Date = new Date()): string {
  return londonDay(now.toISOString());
}
