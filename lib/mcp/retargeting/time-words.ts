/**
 * lib/mcp/retargeting/time-words.ts — what plan_retargeting and
 * create_show_campaigns tell Claude when a read runs out of time (Matas, 27
 * Nov: "couldn't be read in time" lines instead of a hang; lib/retargeting/limits.ts).
 *
 * The "not read" line is #1405's, ruled 27 Nov for audience_sources, word for
 * word (a test pins it against AUD_WORDS). The rest is design's 27 Nov
 * verdict on #1409, word for word.
 *
 * Pure. Relative imports only (node:test).
 */
import type { FrontUnread, ShowUnread } from "../../retargeting/limits.ts";

/** Ruled 27 Nov (design on #1405), shared with audience_sources. */
const NOT_READ = "Not read in time, so not shown: {source}. Try again.";

/** Each read's {source} (design, 27 Nov, on #1409). */
export const UNREAD_WORDS: Record<ShowUnread | FrontUnread, string> = {
  purchases: "the purchases on each show’s pixel",
  links: "CIRQLIN’s page links",
  pixel: "the ad account’s pixel",
  pages: "the venue, promoter and lineup Pages",
  hosts: "the pixel’s sites",
  prospecting: "the show’s prospecting budgets",
  meta: "the show’s campaigns in Meta",
};

const list = (items: readonly string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

export const TIME_WORDS = {
  /** One line for every read of a show (or before the shows) that ran out. */
  notRead: (sources: readonly (ShowUnread | FrontUnread)[]) => NOT_READ.replace("{source}", list(sources.map((source) => UNREAD_WORDS[source]))),
  /** One show asked for by code that ran out of its budget (design, 27 Nov). */
  unfinishedOne: (code: string) => `${code} wasn’t finished in time, so it isn’t shown. Try again.`,
  /** "live" or a list, after the head line: the shows left, and how to get them (design, 27 Nov). */
  unfinishedMany: (codes: readonly string[]) =>
    `${codes.length === 1 ? `${codes[0]} wasn’t` : `${codes.length} shows weren’t`} finished in time, so ${codes.length === 1 ? "it isn’t" : "they aren’t"} shown${codes.length === 1 ? "" : `: ${codes.join(", ")}`}. Ask again with ${codes.length === 1 ? "its code" : "their codes"}.`,
  /** create_show_campaigns when the show's plan couldn't be read in full (design, 27 Nov). */
  refused: (code: string) => `Refused: ${code} couldn’t be read in time, so nothing was made. Try again.`,
} as const;
