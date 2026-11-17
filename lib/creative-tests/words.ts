/**
 * Creative testing's words, from the records only:
 * docs/design-record/2026-11-16-creative-testing.html (CT),
 * 2026-11-16-creative-testing-2.html (TT) and
 * 2026-11-16-creative-testing-3.html (TF). TF2 replaces TT3's states,
 * TT3 replaced CT7's. Pure, no server imports: the panel, the share
 * section and the cron share it.
 */

export type ResultEvent = "initiate_checkout" | "landing_page_view" | "complete_registration";

/** CT6: the result a test is judged on, the campaign's own (R3). */
export const RESULT_WORD: Record<ResultEvent, { one: string; many: string }> = {
  initiate_checkout: { one: "checkout", many: "checkouts" },
  landing_page_view: { one: "landing-page view", many: "landing-page views" },
  complete_registration: { one: "signup", many: "signups" },
};

export type TestKind = "tracks" | "statics" | "together" | "copy" | "clip";

/** CT6: the test names. */
export const KIND_NAME: Record<TestKind, string> = {
  tracks: "Tracks",
  statics: "Statics",
  together: "Together",
  copy: "Copy",
  clip: "Clip",
};

/** "Test 1 · Tracks" (CT6, CT9). */
export function testName(n: number, kind: TestKind): string {
  return `Test ${n} · ${KIND_NAME[kind]}`;
}

const SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };

export function symbolFor(currency: string | null | undefined): string {
  return SYMBOL[(currency ?? "GBP").toUpperCase()] ?? "£";
}

/** £1.65, two places. */
export function money(amount: number, currency?: string | null): string {
  return `${symbolFor(currency)}${amount.toFixed(2)}`;
}

/** A whole-unit budget reads "£10" (TF-A); Meta's minimum, or anything with pence, reads "£1.00" (TF-B). */
export function budgetMoney(amount: number, currency?: string | null, pence = false): string {
  return pence || !Number.isInteger(amount) ? money(amount, currency) : `${symbolFor(currency)}${amount}`;
}

/** A share of spend as the panel writes it: 0.6625 → "66". */
export function pct(share: number): string {
  return String(Math.round(share * 100));
}

// TF1 ---------------------------------------------------------------------

export const NO_RECENT_SPEND = "No spend in the last 7 days to size a test from.";
export const META_MINIMUM_SUFFIX = " · Meta's minimum";

/** TF1, Matas's words: "£10 a day · 6 % of current daily spend (cap £10)", with " · Meta's minimum" at the minimum. */
export function budgetLine(input: { daily: number; sharePct: number; cap: number; atMinimum: boolean; currency?: string | null }): string {
  const { daily, sharePct, cap, atMinimum, currency } = input;
  const base = `${budgetMoney(daily, currency, atMinimum)} a day · ${Math.round(sharePct)} % of current daily spend (cap ${budgetMoney(cap, currency)})`;
  return atMinimum ? `${base}${META_MINIMUM_SUFFIX}` : base;
}

/** TF-A's card line: "In P26-BDAY · Tests · Video · {budget line} · read at 48 h, £20.00 spent". */
export function cardBudgetLine(input: { adSetName: string; budgetLine: string; readHours?: number | null; spent?: number | null; currency?: string | null }): string {
  const read = input.readHours != null && input.spent != null ? ` · read at ${Math.floor(input.readHours)} h, ${money(input.spent, input.currency)} spent` : "";
  return `In ${input.adSetName} · ${input.budgetLine}${read}`;
}

// TT1 ---------------------------------------------------------------------

export type TestFormat = "video" | "statics";

/** TT1: "{event code} · Tests". */
export function testsCampaignName(eventCode: string): string {
  return `${eventCode} · Tests`;
}

/** TT1: "{event code} · Tests · Video" / "· Statics". */
export function testAdSetName(eventCode: string, format: TestFormat): string {
  return `${testsCampaignName(eventCode)} · ${format === "video" ? "Video" : "Statics"}`;
}

// TF2 states -------------------------------------------------------------

export const FIRST_READ_PENDING = "Running · first read at 48 h";
export const READY_TO_CALL = "Ready to call";
export const NO_CLEAR_WINNER = "No clear winner by day 4";
export const NOT_ENOUGH_SPEND = "Not enough spend to judge";
export const CALL_THE_WINNER = "Call the winner";

export function runningText(hours: number, sharePct: string, leader: string): string {
  return `Running · ${Math.floor(hours)} h · ${sharePct} % of spend on ${leader}`;
}

export function metaFavoursText(leader: string, sharePct: string, cheaper: string, result: ResultEvent): string {
  return `Running · Meta favours ${leader} (${sharePct} % of spend), but ${cheaper} is cheaper per ${RESULT_WORD[result].one}`;
}

export function winnerText(variant: string, sharePct: string, cost: number, result: ResultEvent, currency?: string | null): string {
  return `Winner: ${variant} · ${sharePct} % of spend · ${money(cost, currency)} per ${RESULT_WORD[result].one}`;
}

/** "Waiting for Test {n−1}" (TT1, TF2). */
export function waitingText(previousN: number): string {
  return `Waiting for Test ${previousN}`;
}

/** TT-A / CT-C: the next test after a call, while the Lab makes its statics. */
export function waitingForStaticsText(previousN: number): string {
  return `Waiting for Test ${previousN}'s statics`;
}

/** CT8: "Make Test 2's statics with {track}". */
export function makeStaticsText(n: number, track: string): string {
  return `Make Test ${n}'s statics with ${track}`;
}

/** CT8 / TT4: Test 3 when the control holds. */
export const CONTROL_HELD = "The current best ad held. Nothing changes.";

// TT5 ---------------------------------------------------------------------

export const RIGHTS_MUTED = "Meta muted the audio (rights)";
export const RIGHTS_MUTED_SHARE = "Audio muted by Meta";
export const RIGHTS_MUTED_ROW_TAIL = "paused, out of the test";
export const NOT_ENOUGH_VARIANTS = "Not enough variants left to test.";

// TF3 rows -----------------------------------------------------------------

/** TF3 phone row: "66 % of spend · Track two · £1.65 per checkout · 8"; barely served: "9 % of spend · Track five · Not enough spend to judge". */
export function phoneRow(row: { label: string; sharePct: string | null; judged: boolean; muted: boolean; cost: number | null; results: number }, result: ResultEvent, currency?: string | null): string {
  if (row.muted) return `${row.label} · ${RIGHTS_MUTED} · ${RIGHTS_MUTED_ROW_TAIL}`;
  const share = row.sharePct != null ? `${row.sharePct} % of spend · ` : "";
  if (!row.judged || row.cost == null) return `${share}${row.label} · ${NOT_ENOUGH_SPEND}`;
  return `${share}${row.label} · ${money(row.cost, currency)} per ${RESULT_WORD[result].one} · ${row.results}`;
}

/** TF3 share link winner: "Winner: Track two · £1.65 per checkout" (no spend share). */
export function shareWinnerText(variant: string, cost: number, result: ResultEvent, currency?: string | null): string {
  return `Winner: ${variant} · ${money(cost, currency)} per ${RESULT_WORD[result].one}`;
}

/** TF4: the Promote line's evidence, "66 % of spend · £1.65 per checkout · 8 checkouts". */
export function promoteEvidenceText(sharePct: string, cost: number, results: number, result: ResultEvent, currency?: string | null): string {
  const word = results === 1 ? RESULT_WORD[result].one : RESULT_WORD[result].many;
  return `${sharePct} % of spend · ${money(cost, currency)} per ${RESULT_WORD[result].one} · ${results} ${word}`;
}
