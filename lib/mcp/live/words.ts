/**
 * lib/mcp/live/words.ts — what the M3b live tools tell Claude.
 *
 * Two kinds of string:
 *   - rows from design's list (scratch/mcp/words-mcp-today-2026-11-25.tsv,
 *     a copy in lib/mcp/__tests__/fixtures), word for word, re-used from
 *     lib/mcp/meta/words.ts or rendered here from their row (pinned by
 *     lib/mcp/__tests__/live-words.test.ts);
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

/** today.mcp.count.ads / .one, today.mcp.count.adsets / .one */
export const countAds = (n: number) => (n === 1 ? "1 ad" : `${n} ads`);
export const countAdSets = (n: number) => (n === 1 ? "1 ad set" : `${n} ad sets`);

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
  sameLive: pending("claude.mcp.live.same.live", "Told to Claude, resume on something already on", "Nothing changed: {name} is already on."),
  pausedOutside: pending(
    "claude.mcp.live.refused.paused_outside",
    "Told to Claude, resume on something paused outside Off/Pixel, when the question didn't say so",
    "Refused: {name} was paused outside Off/Pixel, in Ads Manager. Ask Matas again and say so in the question, then send it with his answer. Nothing was sent to Meta.",
  ),
  parentOff: pending("claude.mcp.live.resume.parent_off", "Told to Claude after a resume, when the campaign or ad set above is still paused", "{name} is on, but its {parent} is paused, so it won’t spend until that’s on too."),
  // Budgets.
  ownBudgetCampaign: pending("claude.mcp.live.refused.budget_on_campaign", "Told to Claude, set_budget on an ad set whose campaign holds the budget", "Refused: {name}’s budget is set on its campaign. Change the campaign’s budget instead. Nothing was sent to Meta."),
  ownBudgetAdSets: pending("claude.mcp.live.refused.budget_on_ad_sets", "Told to Claude, set_budget on a campaign whose ad sets hold the budgets", "Refused: {name}’s budgets are set on its ad sets. Change an ad set’s budget instead. Nothing was sent to Meta."),
  budgetType: pending("claude.mcp.live.refused.budget_type", "Told to Claude, a daily amount on a lifetime budget or the other way round", "Refused: {name} runs on a {type} budget, so give {field}. Nothing was sent to Meta."),
  budgetAmount: pending("claude.mcp.live.refused.budget_amount", "Told to Claude, an amount that isn't money", "Refused: give one amount in £, more than £1.00, as daily_gbp or lifetime_gbp. Nothing was sent to Meta."),
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
  scheduled: pending("claude.mcp.live.scheduled", "Told to Claude, set_budget with at", "Scheduled: {change} at {when} London (change {id}). It runs only if nothing has changed by then; cancel it with cancel_scheduled."),
  schedulePast: pending("claude.mcp.live.refused.at", "Told to Claude, an at that isn't a future time with its zone within 60 days", "Refused: at must be a time with its zone, at least 15 minutes ahead and at most 60 days. Nothing was scheduled."),
  cancelled: pending("claude.mcp.live.cancelled", "Told to Claude, cancel_scheduled", "Cancelled: {change} at {when} London won’t run."),
  cancelUnknown: pending("claude.mcp.live.refused.cancel_unknown", "Told to Claude, cancel_scheduled on an id it can't find", "Refused: there’s no scheduled change {id} for you. Nothing was changed."),
  cancelState: pending("claude.mcp.live.refused.cancel_state", "Told to Claude, cancel_scheduled on a change that already ran or stopped", "Refused: change {id} is already {state}. Nothing was changed."),
  stateScheduled: pending("claude.mcp.live.state.scheduled", "list_scheduled, a change waiting", "scheduled"),
  stateApplied: pending("claude.mcp.live.state.applied", "list_scheduled, a change that ran", "applied"),
  stateSkipped: pending("claude.mcp.live.state.skipped", "list_scheduled, a change skipped", "skipped"),
  stateCancelled: pending("claude.mcp.live.state.cancelled", "list_scheduled, a change cancelled", "cancelled"),
  stateFailed: pending("claude.mcp.live.state.failed", "list_scheduled, Meta refused the change", "failed"),
  skipChanged: pending("claude.mcp.live.skip.budget_changed", "list_scheduled, why a change was skipped", "Skipped: the budget changed in Ads Manager after it was asked."),
  skipPaused: pending("claude.mcp.live.skip.paused", "list_scheduled, why a change was skipped", "Skipped: it was paused after it was asked."),
  skipEnded: pending("claude.mcp.live.skip.ended", "list_scheduled, why a change was skipped", "Skipped: it ended or was deleted after it was asked."),
  skipCeiling: pending("claude.mcp.live.skip.ceiling", "list_scheduled, why a change was skipped", "Skipped: by then it was over the client’s daily ceiling, or the client had none."),
  skipSwitch: pending("claude.mcp.live.skip.switch", "list_scheduled, why a change was skipped", "Skipped: budget changes were switched off in Off/Pixel."),
  skipUnread: pending("claude.mcp.live.skip.unread", "list_scheduled, why a change was skipped", "Skipped: Meta couldn’t be read when it was due."),
  // Moves.
  moveSameCampaign: pending("claude.mcp.live.refused.move_campaign", "Told to Claude, move_budget across campaigns", "Refused: both ad sets must be in the same campaign. Nothing was sent to Meta."),
  moveSame: pending("claude.mcp.live.refused.move_same", "Told to Claude, move_budget from an ad set to itself", "Refused: give two different ad sets. Nothing was sent to Meta."),
  moveNotDaily: pending("claude.mcp.live.refused.move_daily", "Told to Claude, move_budget where a side has no daily budget of its own", "Refused: both ad sets need daily budgets of their own to move money between them. Nothing was sent to Meta."),
  moveFloor: pending("claude.mcp.live.refused.move_floor", "Told to Claude, a move that takes the giving ad set under £1.00 a day", "Refused: that would take {from} under £1.00 a day. Nothing was sent to Meta."),
  movePartial: pending("claude.mcp.live.move.partial", "Told to Claude, a move where only the giving side was written", "Only {from} went down by £{x} a day: {to}’s budget changed or Meta refused it, so it didn’t go up. Read both with get_live."),
  // Rename.
  nameSame: pending("claude.mcp.live.same.name", "Told to Claude, rename to the name it already has", "Nothing changed: it’s already called {name}."),
  // Stage adds.
  noStage: pending("claude.mcp.live.refused.no_stage", "Told to Claude, a stage with no campaign the app can add to", "Refused: {code} has no {stage} campaign Off/Pixel can add to. Nothing was sent to Meta."),
  noAdSets: pending("claude.mcp.live.refused.no_ad_sets", "Told to Claude, none of the given ad sets are in the stage", "Refused: none of those ad sets are in {code}’s {stage} campaigns. Nothing was sent to Meta."),
  creativeUnknown: pending("claude.mcp.live.refused.creative_unknown", "Told to Claude, a draft creative id not on the event's drafts", "Refused: there’s no ad {id} on {code}’s drafts. Nothing was sent to Meta."),
  noCreatives: pending("claude.mcp.live.refused.no_creatives", "Told to Claude, add_creatives_to_stage with nothing to add", "Refused: give draft_creative_ids, file_ids or pairs. Nothing was sent to Meta."),
  tooManyAds: pending("claude.mcp.live.refused.too_many_ads", "Told to Claude, over the tree's caps (8 campaigns, 200 ads)", "Refused: that’s {n} ads across {m} campaigns, over the 200 ads and 8 campaigns one run can add. Narrow ad_set_ids. Nothing was sent to Meta."),
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
  testDates: pending("claude.mcp.live.refused.test_dates", "Told to Claude, bad start or end", "Refused: start and end are times with their zone, start from now, end after start, the test at most 90 days. Nothing was sent to Meta."),
  testNoBusiness: pending("claude.mcp.live.refused.test_business", "Told to Claude, an ad account with no business to hold the test", "Refused: the ad account has no business manager to hold the test. Nothing was sent to Meta."),
  testMetric: pending("claude.mcp.live.refused.test_metric", "Told to Claude, a metric other than cost per result", "Refused: a test here compares cost per result only. Nothing was sent to Meta."),
  testThing: pending("claude.mcp.live.thing.test", "{thing} for create_split_test's result", "test"),
  testThings: pending("claude.mcp.live.thing.test.many", "{things}", "tests"),
  testLine: pending("claude.mcp.live.test.line", "Told to Claude after create_split_test", "{a} and {b} split 50 / 50 from {start} to {end} London, judged on cost per result."),
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
  budgetChange: (name: string, x: number, y: number, lifetime: boolean) => fill(T.budgetChange, { name, x: money(x), y: money(y), per: lifetime ? T.perLifetime : T.perDay }),
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
    ceiling: T.skipCeiling,
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
  tooManyAds: (n: number, m: number) => fill(T.tooManyAds, { n, m }),
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
