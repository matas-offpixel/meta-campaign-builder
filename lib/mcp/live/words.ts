/**
 * lib/mcp/live/words.ts — what the M3b live tools tell Claude.
 *
 * Three kinds of string:
 *   - rows from design's list (scratch/mcp/words-mcp-today-2026-11-25.tsv,
 *     a copy in lib/mcp/__tests__/fixtures), word for word, re-used from
 *     lib/mcp/meta/words.ts or rendered here from their row (pinned by
 *     lib/mcp/__tests__/live-words.test.ts, with the count helpers and
 *     londonWhen's "Thu 26 Nov, 18:00");
 *   - LIVE_RULED: the rows design corrected in its 26 Nov verdict on #1389,
 *     plus its new claude.mcp.live.change.budget.to, word for word;
 *   - PENDING DESIGN: every string with no row yet. Each is in LIVE_FOR_DESIGN
 *     with its key, where it shows and the builder's candidate; the PR body's
 *     "For design" table is that list. When design rules them, the ruled words
 *     replace the candidates here and the entries leave LIVE_FOR_DESIGN.
 *
 * No raw error (an HTTP status, Meta's message, a database error) is ever put
 * in one of these. Claude gets names, counts, ids and links.
 *
 * Relative imports only (node:test).
 */

import { CEILING_WORDS } from "../meta/ceiling-words.ts";

const money = (n: number) => n.toFixed(2);

export interface PendingWord {
  key: string;
  where: string;
  candidate: string;
}

/** Every PENDING DESIGN string, in one list (the PR body's "For design" table). */
export const LIVE_FOR_DESIGN: PendingWord[] = [];

/** Registers a PENDING DESIGN string and returns its candidate. */
function pending(key: string, where: string, candidate: string): string {
  LIVE_FOR_DESIGN.push({ key, where, candidate });
  return candidate;
}

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

// ── Rows from design's list (word for word) ──────────────────────────────────

export const LIVE_ROWS = {
  /** claude.mcp.refused.switch */
  refusedSwitch: "Refused: this is switched off in Off/Pixel. Nothing was sent to Meta.",
  /** claude.mcp.failed */
  failed: (result: string) => `Meta didn’t take it all: ${result}.`,
  /** today.mcp.change.pause */
  changePause: (name: string) => `${name}: live → paused`,
  /** today.mcp.change.resume */
  changeResume: (name: string) => `${name}: paused → live`,
  /** today.mcp.change.move_budget */
  changeMove: (x: number, from: string, to: string) => `£${money(x)} a day: ${from} → ${to}`,
  /** today.mcp.change.add_creatives */
  changeAddCreatives: (stage: string, ads: string, adsets: string) => `${stage}: ${ads} into ${adsets}`,
  /** today.mcp.change.add_audiences */
  changeAddAudiences: (stage: string, audiences: string, adsets: string) => `${stage}: ${audiences} into ${adsets}`,
  /** today.mcp.result.created / .one */
  created: (things: [string, string], ids: readonly string[]) =>
    ids.length === 1 ? `1 ${things[0]} created · ${ids[0]}` : `${ids.length} ${things[1]} created · ${ids.join(", ")}`,
  /** today.mcp.result.partial */
  partial: (n: number, m: number, things: string, ids: readonly string[]) => `${n} of ${m} ${things} changed · ${ids.join(", ")}`,
  /** today.mcp.undo.resume / .pause / .budget / .move (server side only: Today's Undo isn't built yet). */
  undoResume: "Undo resumes it.",
  undoPause: "Undo pauses it.",
  undoBudget: (x: number) => `Undo puts it back to £${money(x)} a day.`,
  undoMove: (x: number, from: string) => `Undo moves £${money(x)} a day back to ${from}.`,
} as const;

/** {thing} / {things}: today.mcp.thing.* rows. */
export const LIVE_THINGS: Record<"campaign" | "adset" | "ad", [string, string]> = {
  campaign: ["campaign", "campaigns"],
  adset: ["ad set", "ad sets"],
  ad: ["ad", "ads"],
};

/** The count rows, word for word: {n} {things}, and its .one form at 1. */
const counted = (one: string, many: string) => (n: number) => (n === 1 ? one : many.replace("{n}", String(n)));
/** today.mcp.count.ads / .one */
export const countAds = counted("1 ad", "{n} ads");
/** today.mcp.count.adsets / .one */
export const countAdSets = counted("1 ad set", "{n} ad sets");
/** {campaigns}: "1 campaign" / "{n} campaigns", the today.mcp.thing.campaign nouns (no count row exists). */
export const countCampaigns = counted(`1 ${LIVE_THINGS.campaign[0]}`, `{n} ${LIVE_THINGS.campaign[1]}`);
/** today.mcp.count.tiers / .one */
export const countTiers = counted("1 tier", "{n} tiers");
/** today.mcp.count.changes / .one (Today's section header: "{n} today"). */
export const countChanges = counted("1 today", "{n} today");

// ── Design's corrected rows (26 Nov verdict on #1389, word for word) ─────────

/**
 * Rows design ruled on 26 Nov, key → words, copied character for character
 * (typographic ’). Pinned word for word by lib/mcp/__tests__/live-words.test.ts.
 * They are no longer PENDING DESIGN, so LIVE_FOR_DESIGN doesn't list them.
 */
export const LIVE_RULED = {
  "claude.mcp.live.same.live": "Nothing changed: {name} is already live.",
  "claude.mcp.live.resume.parent_off": "{name} is live, but its {parent} is paused, so it won’t spend until that’s live too.",
  "claude.mcp.live.refused.paused_outside": "Refused: {name} was paused outside Off/Pixel. Ask Matas again, say so in the question, and send it with his answer. Nothing was sent to Meta.",
  "claude.mcp.live.refused.budget_amount": "Refused: give one amount in £, from £1.00 to £100,000.00, as daily_gbp or lifetime_gbp. Nothing was sent to Meta.",
  "claude.mcp.live.scheduled": "Scheduled for {when} London time: {change} (change {id}). It runs only if nothing has changed by then. Cancel it with cancel_scheduled.",
  "claude.mcp.live.refused.at": "Refused: give at as a time with its zone, at least 15 minutes and at most 60 days ahead. Nothing was scheduled.",
  "claude.mcp.live.cancelled": "Cancelled the change due {when} London time: {change}. It won’t run.",
  "claude.mcp.live.refused.cancel_state": "Refused: change {id} is no longer scheduled ({state}). Nothing was changed.",
  "claude.mcp.live.skip.budget_changed": "Skipped: the budget changed after it was scheduled.",
  "claude.mcp.live.skip.paused": "Skipped: it was paused after it was scheduled.",
  "claude.mcp.live.skip.ended": "Skipped: it ended or was deleted after it was scheduled.",
  "claude.mcp.live.skip.ceiling": "Skipped: by then it would have gone over the client’s daily ceiling, or the client had no ceiling.",
  "claude.mcp.live.move.partial": "{from} went down by £{x} a day, but {to} didn’t go up: its budget changed or Meta refused it. Read both with get_live.",
  "claude.mcp.live.refused.too_many_ads": "Refused: that’s {ads} across {campaigns}, over the 200 ads and 8 campaigns one run can add. Narrow ad_set_ids. Nothing was sent to Meta.",
  "claude.mcp.live.refused.test_dates": "Refused: give start and end as times with their zone: start now or later, end after start, at most 90 days apart. Nothing was sent to Meta.",
  "claude.mcp.live.refused.test_business": "Refused: the ad account isn’t in a business portfolio, and Meta needs one to hold a test. Nothing was sent to Meta.",
  "claude.mcp.live.test.line": "{a} and {b} split 50/50 from {start} to {end} London time, judged on cost per result.",
  /** New row: a budget change with no recorded old amount (never "£0.00 → £y"). */
  "claude.mcp.live.change.budget.to": "{name}: to £{y} {per}",
} as const;

const R = LIVE_RULED;

// ── PENDING DESIGN ───────────────────────────────────────────────────────────

const T = {
  // Object and event refusals.
  notFound: pending("claude.mcp.live.refused.not_found", "Told to Claude, a Meta id this connection can't read", "Refused: Meta has no {thing} {id} that this connection can read. Nothing was sent to Meta."),
  notOnEvent: pending("claude.mcp.live.refused.not_on_event", "Told to Claude, an object outside the event's campaign tree", "Refused: {thing} {id} isn’t in {code}’s campaigns. Nothing was sent to Meta."),
  noDraft: pending(
    "claude.mcp.live.refused.no_draft",
    "Told to Claude, a campaign with no published draft on the event (RC10's rule: the write ledger is per draft)",
    "Refused: {name} has no published draft on {code}, so a change to it can’t be recorded. Nothing was sent to Meta.",
  ),
  otherAccount: pending("claude.mcp.live.refused.other_ad_account", "Told to Claude, an object in another ad account than its campaign tree's", "Refused: {name} is in ad account {account}, not {code}’s. Nothing was sent to Meta."),
  gone: pending("claude.mcp.live.refused.gone", "Told to Claude, an object Meta shows as deleted or archived", "Refused: {name} is deleted or archived on Meta, so it can’t be changed. Nothing was sent to Meta."),
  ended: pending("claude.mcp.live.refused.ended", "Told to Claude, an object whose end time has passed", "Refused: {name} ended on {date}, so it can’t be changed. Nothing was sent to Meta."),
  notWired: pending("claude.mcp.live.refused.unavailable", "Told to Claude, Meta can't be reached from this connection", "Refused: Meta can’t be reached from this connection right now. Try again. Nothing was sent to Meta."),
  metaFailed: pending("claude.mcp.live.failed", "Told to Claude, Meta refused or didn't answer a write", "Meta didn’t take it, so nothing changed. Try again, or make the change in Ads Manager."),
  currency: pending("claude.mcp.live.refused.currency", "Told to Claude, a spend-raising change on an account not in £", "Refused: {name}’s ad account spends in {currency}, and ceilings are in £. Nothing was sent to Meta."),
  readFailed: pending("claude.mcp.live.refused.read_failed", "Told to Claude, Meta couldn't be read before a change", "Refused: Meta couldn’t be read, so nothing was changed. Try again."),
  // Pause / resume.
  samePaused: pending("claude.mcp.live.same.paused", "Told to Claude, pause on something already paused", "Nothing changed: {name} is already paused."),
  sameLive: R["claude.mcp.live.same.live"],
  pausedOutside: R["claude.mcp.live.refused.paused_outside"],
  parentOff: R["claude.mcp.live.resume.parent_off"],
  // Budgets.
  ownBudgetCampaign: pending("claude.mcp.live.refused.budget_on_campaign", "Told to Claude, set_budget on an ad set whose campaign holds the budget", "Refused: {name}’s budget is set on its campaign. Change the campaign’s budget instead. Nothing was sent to Meta."),
  ownBudgetAdSets: pending("claude.mcp.live.refused.budget_on_ad_sets", "Told to Claude, set_budget on a campaign whose ad sets hold the budgets", "Refused: {name}’s budgets are set on its ad sets. Change an ad set’s budget instead. Nothing was sent to Meta."),
  budgetType: pending("claude.mcp.live.refused.budget_type", "Told to Claude, a daily amount on a lifetime budget or the other way round", "Refused: {name} runs on a {type} budget, so give {field}. Nothing was sent to Meta."),
  budgetAmount: R["claude.mcp.live.refused.budget_amount"],
  budgetSame: pending("claude.mcp.live.same.budget", "Told to Claude, a budget already at the amount", "Nothing changed: {name} is already at £{x} {per}."),
  budgetChange: pending("claude.mcp.live.change.budget", "Told to Claude (and the change line Today would show), a budget change", "{name}: £{x} → £{y} {per}"),
  perDay: pending("claude.mcp.live.per.day", "{per} for a daily budget", "a day"),
  perLifetime: pending("claude.mcp.live.per.lifetime", "{per} for a lifetime budget", "lifetime"),
  typeDaily: pending("claude.mcp.live.type.daily", "{type}", "daily"),
  typeLifetime: pending("claude.mcp.live.type.lifetime", "{type}", "lifetime"),
  underfoot: pending(
    "claude.mcp.live.refused.underfoot",
    "Told to Claude, the budget changed between the ask and the write",
    "Refused: {name}’s budget changed since it was read, to £{x}. Read it again with get_live and ask Matas again. Nothing was sent to Meta.",
  ),
  // Scheduling.
  scheduled: R["claude.mcp.live.scheduled"],
  schedulePast: R["claude.mcp.live.refused.at"],
  cancelled: R["claude.mcp.live.cancelled"],
  cancelUnknown: pending("claude.mcp.live.refused.cancel_unknown", "Told to Claude, cancel_scheduled on an id it can't find", "Refused: there’s no scheduled change {id} for you. Nothing was changed."),
  cancelState: R["claude.mcp.live.refused.cancel_state"],
  stateScheduled: pending("claude.mcp.live.state.scheduled", "list_scheduled, a change waiting", "scheduled"),
  stateApplied: pending("claude.mcp.live.state.applied", "list_scheduled, a change that ran", "applied"),
  stateSkipped: pending("claude.mcp.live.state.skipped", "list_scheduled, a change skipped", "skipped"),
  stateCancelled: pending("claude.mcp.live.state.cancelled", "list_scheduled, a change cancelled", "cancelled"),
  stateFailed: pending("claude.mcp.live.state.failed", "list_scheduled, Meta refused the change", "failed"),
  skipChanged: R["claude.mcp.live.skip.budget_changed"],
  skipPaused: R["claude.mcp.live.skip.paused"],
  skipEnded: R["claude.mcp.live.skip.ended"],
  skipCeiling: R["claude.mcp.live.skip.ceiling"],
  skipSwitch: pending("claude.mcp.live.skip.switch", "list_scheduled, why a change was skipped", "Skipped: budget changes were switched off in Off/Pixel."),
  skipUnread: pending("claude.mcp.live.skip.unread", "list_scheduled, why a change was skipped", "Skipped: Meta couldn’t be read when it was due."),
  // Moves.
  moveSameCampaign: pending("claude.mcp.live.refused.move_campaign", "Told to Claude, move_budget across campaigns", "Refused: both ad sets must be in the same campaign. Nothing was sent to Meta."),
  moveSame: pending("claude.mcp.live.refused.move_same", "Told to Claude, move_budget from an ad set to itself", "Refused: give two different ad sets. Nothing was sent to Meta."),
  moveNotDaily: pending("claude.mcp.live.refused.move_daily", "Told to Claude, move_budget where a side has no daily budget of its own", "Refused: both ad sets need daily budgets of their own to move money between them. Nothing was sent to Meta."),
  moveFloor: pending("claude.mcp.live.refused.move_floor", "Told to Claude, a move that takes the giving ad set under £1.00 a day", "Refused: that would take {from} under £1.00 a day. Nothing was sent to Meta."),
  movePartial: R["claude.mcp.live.move.partial"],
  // Rename.
  nameSame: pending("claude.mcp.live.same.name", "Told to Claude, rename to the name it already has", "Nothing changed: it’s already called {name}."),
  // Stage adds.
  noStage: pending("claude.mcp.live.refused.no_stage", "Told to Claude, a stage with no campaign the app can add to", "Refused: {code} has no {stage} campaign Off/Pixel can add to. Nothing was sent to Meta."),
  noAdSets: pending("claude.mcp.live.refused.no_ad_sets", "Told to Claude, none of the given ad sets are in the stage", "Refused: none of those ad sets are in {code}’s {stage} campaigns. Nothing was sent to Meta."),
  creativeUnknown: pending("claude.mcp.live.refused.creative_unknown", "Told to Claude, a draft creative id not on the event's drafts", "Refused: there’s no ad {id} on {code}’s drafts. Nothing was sent to Meta."),
  noCreatives: pending("claude.mcp.live.refused.no_creatives", "Told to Claude, add_creatives_to_stage with nothing to add", "Refused: give draft_creative_ids, file_ids or pairs. Nothing was sent to Meta."),
  tooManyAds: R["claude.mcp.live.refused.too_many_ads"],
  addFailed: pending("claude.mcp.live.add.failed", "Told to Claude, Meta made none of the ads", "Meta didn’t make any of the ads, so nothing was added. Try again: an ad already made won’t be made twice."),
  notAdded: pending("claude.mcp.live.add.not_added", "Told to Claude, ad sets the run didn't reach", "Not added to {adsets}: {names}."),
  audienceUnknown: pending("claude.mcp.live.refused.audience_unknown", "Told to Claude, an audience id Off/Pixel doesn't know for this client", "Refused: audience {id} isn’t one of this client’s audiences in Off/Pixel. Nothing was sent to Meta."),
  noAudiences: pending("claude.mcp.live.refused.no_audiences", "Told to Claude, add_audience_to_stage with no audience", "Refused: give audience_ids or a template. Nothing was sent to Meta."),
  templateUnknown: pending("claude.mcp.live.refused.template_unknown", "Told to Claude, a template name not found for the client", "Refused: {client} has no audience template called {template}. Nothing was sent to Meta."),
  templateUnconfirmed: pending("claude.mcp.live.refused.template_unconfirmed", "Told to Claude, an unconfirmed template", "Refused: {template} isn’t confirmed yet. Matas confirms a template before it’s used. Nothing was sent to Meta."),
  templateEmpty: pending("claude.mcp.live.refused.template_empty", "Told to Claude, a template with no audience made in this account", "Refused: none of {template}’s audiences are made in this ad account yet. Nothing was sent to Meta."),
  suggestions: pending("claude.mcp.live.audience.suggestions", "Told to Claude after adding audiences, when an ad set runs Advantage+", "On the Advantage+ ad sets the audiences go in as suggestions; Advantage+ stays on."),
  audienceSkipped: pending("claude.mcp.live.audience.skipped", "Told to Claude, ad sets an audience didn't reach", "{audience} didn’t go into {adsets}."),
  // Split test.
  testTwo: pending("claude.mcp.live.refused.test_two", "Told to Claude, create_split_test without two different campaigns", "Refused: a test takes two different campaigns. Nothing was sent to Meta."),
  testAccounts: pending("claude.mcp.live.refused.test_accounts", "Told to Claude, campaigns on different ad accounts", "Refused: {a} and {b} are on different ad accounts, and a test needs both on one. Nothing was sent to Meta."),
  testInStudy: pending("claude.mcp.live.refused.test_in_study", "Told to Claude, a campaign already in a running test", "Refused: {name} is already in a running test ({study}). Nothing was sent to Meta."),
  testDates: R["claude.mcp.live.refused.test_dates"],
  testNoBusiness: R["claude.mcp.live.refused.test_business"],
  testMetric: pending("claude.mcp.live.refused.test_metric", "Told to Claude, a metric other than cost per result", "Refused: a test here compares cost per result only. Nothing was sent to Meta."),
  testThing: pending("claude.mcp.live.thing.test", "{thing} for create_split_test's result", "test"),
  testThings: pending("claude.mcp.live.thing.test.many", "{things}", "tests"),
  testLine: R["claude.mcp.live.test.line"],
  // get_live.
  strictFlag: pending("claude.mcp.live.flag.strict", "get_live, an ad set that runs strict while its draft asked for suggestions", "Runs strict: the draft asked for Advantage+ suggestions, and Meta shows Advantage+ off."),
  liveNotRead: pending("claude.mcp.live.not_read", "get_live, Meta couldn't be read", "Meta couldn’t be read, so this shows what Off/Pixel knows without live figures. Try again."),
} as const;

export const LIVE_WORDS = {
  ...LIVE_ROWS,
  notFound: (thing: string, id: string) => fill(T.notFound, { thing, id }),
  notOnEvent: (thing: string, id: string, code: string) => fill(T.notOnEvent, { thing, id, code }),
  noDraft: (name: string, code: string) => fill(T.noDraft, { name, code }),
  otherAccount: (name: string, account: string, code: string) => fill(T.otherAccount, { name, account, code }),
  gone: (name: string) => fill(T.gone, { name }),
  ended: (name: string, date: string) => fill(T.ended, { name, date }),
  notWired: T.notWired,
  metaFailed: T.metaFailed,
  currency: (name: string, currency: string) => fill(T.currency, { name, currency }),
  readFailed: T.readFailed,
  samePaused: (name: string) => fill(T.samePaused, { name }),
  sameLive: (name: string) => fill(T.sameLive, { name }),
  pausedOutside: (name: string) => fill(T.pausedOutside, { name }),
  parentOff: (name: string, parent: string) => fill(T.parentOff, { name, parent }),
  ownBudgetCampaign: (name: string) => fill(T.ownBudgetCampaign, { name }),
  ownBudgetAdSets: (name: string) => fill(T.ownBudgetAdSets, { name }),
  budgetType: (name: string, lifetime: boolean) => fill(T.budgetType, { name, type: lifetime ? T.typeLifetime : T.typeDaily, field: lifetime ? "lifetime_gbp" : "daily_gbp" }),
  budgetAmount: T.budgetAmount,
  budgetSame: (name: string, x: number, lifetime: boolean) => fill(T.budgetSame, { name, x: money(x), per: lifetime ? T.perLifetime : T.perDay }),
  /** "{name}: £{x} → £{y} {per}"; with no recorded old amount (x null), claude.mcp.live.change.budget.to: "{name}: to £{y} {per}". */
  budgetChange: (name: string, x: number | null, y: number, lifetime: boolean) =>
    x == null
      ? fill(R["claude.mcp.live.change.budget.to"], { name, y: money(y), per: lifetime ? T.perLifetime : T.perDay })
      : fill(T.budgetChange, { name, x: money(x), y: money(y), per: lifetime ? T.perLifetime : T.perDay }),
  underfoot: (name: string, x: number) => fill(T.underfoot, { name, x: money(x) }),
  scheduled: (change: string, when: string, id: string) => fill(T.scheduled, { change, when, id }),
  schedulePast: T.schedulePast,
  cancelled: (change: string, when: string) => fill(T.cancelled, { change, when }),
  cancelUnknown: (id: string) => fill(T.cancelUnknown, { id }),
  cancelState: (id: string, state: string) => fill(T.cancelState, { id, state }),
  state: {
    scheduled: T.stateScheduled,
    applying: T.stateScheduled,
    applied: T.stateApplied,
    skipped: T.stateSkipped,
    cancelled: T.stateCancelled,
    failed: T.stateFailed,
  } as Record<string, string>,
  skip: {
    budget_changed: T.skipChanged,
    paused: T.skipPaused,
    ended: T.skipEnded,
    // The show's spend ceiling (PR D, PENDING DESIGN in meta/ceiling-words.ts); the ruled client-ceiling row stays in LIVE_RULED as the record.
    ceiling: CEILING_WORDS.skip,
    switch: T.skipSwitch,
    unread: T.skipUnread,
  } as Record<string, string>,
  moveSameCampaign: T.moveSameCampaign,
  moveSame: T.moveSame,
  moveNotDaily: T.moveNotDaily,
  moveFloor: (from: string) => fill(T.moveFloor, { from }),
  movePartial: (from: string, to: string, x: number) => fill(T.movePartial, { from, to, x: money(x) }),
  nameSame: (name: string) => fill(T.nameSame, { name }),
  noStage: (code: string, stage: string) => fill(T.noStage, { code, stage }),
  noAdSets: (code: string, stage: string) => fill(T.noAdSets, { code, stage }),
  creativeUnknown: (id: string, code: string) => fill(T.creativeUnknown, { id, code }),
  noCreatives: T.noCreatives,
  /** {ads} and {campaigns} are counted: never "1 ads" or "1 campaigns". */
  tooManyAds: (ads: number, campaigns: number) => fill(T.tooManyAds, { ads: countAds(ads), campaigns: countCampaigns(campaigns) }),
  addFailed: T.addFailed,
  notAdded: (adsets: string, names: string) => fill(T.notAdded, { adsets, names }),
  audienceUnknown: (id: string) => fill(T.audienceUnknown, { id }),
  noAudiences: T.noAudiences,
  templateUnknown: (client: string, template: string) => fill(T.templateUnknown, { client, template }),
  templateUnconfirmed: (template: string) => fill(T.templateUnconfirmed, { template }),
  templateEmpty: (template: string) => fill(T.templateEmpty, { template }),
  suggestions: T.suggestions,
  audienceSkipped: (audience: string, adsets: string) => fill(T.audienceSkipped, { audience, adsets }),
  testTwo: T.testTwo,
  testAccounts: (a: string, b: string) => fill(T.testAccounts, { a, b }),
  testInStudy: (name: string, study: string) => fill(T.testInStudy, { name, study }),
  testDates: T.testDates,
  testNoBusiness: T.testNoBusiness,
  testMetric: T.testMetric,
  testThings: [T.testThing, T.testThings] as [string, string],
  testLine: (a: string, b: string, start: string, end: string) => fill(T.testLine, { a, b, start, end }),
  strictFlag: T.strictFlag,
  liveNotRead: T.liveNotRead,
};

/** Stage names Claude passes and reads (the tree's stages: lib/campaign-tree/tree.ts stageLabel). */
export const STAGE_ARG = ["signup", "presale", "on_sale", "show_week"] as const;
