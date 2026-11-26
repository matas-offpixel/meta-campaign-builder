/**
 * lib/mcp/today/keep-whole.ts — design, 27 Nov (#1398 at 393): three things
 * never break across a line in Claude's changes on Today:
 *
 *   - an event code, brackets included: "[NX26-RUDIMENTAL]", "NX27-GLITTERBOX";
 *   - "What Claude asked";
 *   - a date with its time: "Thu 26 Nov, 18:00" (a bare "Fri 27 Nov" too).
 *
 * The same shape as the Retargeting panel's keep-whole
 * (lib/retargeting/keep-whole.ts, whose copy also sits on open #1314): the
 * words are never changed, each match is a nowrap span, the rest is left as
 * written. At 1280 nothing here wraps, so nothing moves.
 *
 * Pure parts and a React render. Relative imports only (node:test).
 */
import { createElement, Fragment, type ReactNode } from "react";

const SP = "[ \\u00a0]";
const WEEKDAY = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
/** An event code: letters and digits in two or more hyphenated parts, with at least one letter ("NX27-GLITTERBOX", "P26-BDAY"). */
const CODE = "(?=[A-Z0-9-]*[A-Z])[A-Z0-9]+(?:-[A-Z0-9]+)+";

const KEEP_WHOLE = new RegExp(
  [
    `\\[${CODE}\\]`,
    `(?<![\\w-])${CODE}(?![\\w-])`,
    `What${SP}Claude${SP}asked`,
    `\\b${WEEKDAY}${SP}\\d{1,2}${SP}${MONTH}(?:,${SP}\\d{2}:\\d{2})?\\b`,
  ].join("|"),
  "g",
);

export type TodayPart = { text: string; whole: boolean };

/** The text cut into runs; `whole` runs must not wrap. Joined, the parts are the text as given. */
export function todayParts(text: string): TodayPart[] {
  const parts: TodayPart[] = [];
  let at = 0;
  for (const match of text.matchAll(KEEP_WHOLE)) {
    const index = match.index ?? 0;
    if (index > at) parts.push({ text: text.slice(at, index), whole: false });
    parts.push({ text: match[0], whole: true });
    at = index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), whole: false });
  return parts;
}

/** The row's text with each code, "What Claude asked" and date kept whole (a nowrap span); plain text when there's nothing to keep. */
export function keepWholeToday(text: string | null | undefined): ReactNode {
  if (!text) return text ?? null;
  const parts = todayParts(text);
  if (!parts.some((p) => p.whole)) return text;
  return createElement(Fragment, null, ...parts.map((p) => (p.whole ? createElement("span", { className: "whitespace-nowrap", "data-keep-whole": "" }, p.text) : p.text)));
}
