import { createElement, Fragment, type ReactNode } from "react";

/**
 * Design (25 Nov, frames RA / RB / RE / RG): a number never wraps away from
 * its unit in the Retargeting panel. Each of these stays whole on one line:
 *
 *   "{n} days" (the last window in a list: "30, 90, 180 days" keeps "180 days")
 *   "{n} pages" and "{k} of {n} pages"
 *   "{n} similar lists"
 *   "{n} purchases"
 *   "£{x} a day"
 *   "below {n}"
 *   a pool range, "3,900–4,600"
 *
 * The words are never changed: the match is wrapped in a nowrap span and the
 * rest is left as written. The same file, name and exports are on #1314 and
 * #1321; whichever merges second deletes its copy.
 */

const SP = "[ \\u00a0]";
const NUM = "\\d[\\d,]*(?:\\.\\d+)?";
/** Not inside another number, word or amount. */
const START = "(?<![\\w.,£\\-–])";

const KEEP_WHOLE = new RegExp(
  [
    `£${NUM}${SP}a${SP}day\\b`,
    `${START}(?:${NUM}${SP}of${SP})?${NUM}${SP}pages?\\b`,
    `${START}${NUM}${SP}similar${SP}lists?\\b`,
    `${START}${NUM}${SP}purchases?\\b`,
    `${START}${NUM}${SP}days?\\b`,
    `\\b[Bb]elow${SP}${NUM}`,
    `${START}${NUM}–${NUM}(?![\\d,])`,
  ].join("|"),
  "g",
);

export type KeepWholePart = { text: string; whole: boolean };

/** The text cut into runs; `whole` runs are the ones that must not wrap. Joined, the parts are the text as given. */
export function keepWholeParts(text: string): KeepWholePart[] {
  const parts: KeepWholePart[] = [];
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

/** The panel's text with each number kept with its unit (a nowrap span); plain text when there is nothing to keep. */
export function keepWhole(text: string): ReactNode {
  const parts = keepWholeParts(text);
  if (!parts.some((part) => part.whole)) return text;
  return createElement(
    Fragment,
    null,
    ...parts.map((part) => (part.whole ? createElement("span", { className: "whitespace-nowrap", "data-keep-whole": "" }, part.text) : part.text)),
  );
}
