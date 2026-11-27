/**
 * lib/mcp/retargeting/time-words.ts — what plan_retargeting and
 * create_show_campaigns tell Claude when a read runs out of time (Matas, 27
 * Nov: "couldn't be read in time" lines instead of a hang; lib/retargeting/limits.ts).
 *
 * The "not read" line is #1405's, ruled 27 Nov for audience_sources, word for
 * word (a test pins it against AUD_WORDS). Everything else here is PENDING
 * DESIGN: the {source} names, the unfinished lines and the refusal.
 *
 * Pure. Relative imports only (node:test).
 */
import type { FrontUnread, ShowUnread } from "../../retargeting/limits.ts";

/** Ruled 27 Nov (design on #1405), shared with audience_sources. */
const NOT_READ = "Not read in time, so not shown: {source}. Try again.";

/** PENDING DESIGN: each read's {source}. */
export const UNREAD_WORDS: Record<ShowUnread | FrontUnread, string> = {
  purchases: "the pixel each show’s ads optimise on",
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
  /** PENDING DESIGN: one show asked for by code that ran out of its budget. */
  unfinishedOne: (code: string) => `${code}: not finished in time, so not shown. Try again.`,
  /** PENDING DESIGN: "live" or a list, after the head line: the shows left, and how to get them. */
  unfinishedMany: (codes: readonly string[]) =>
    `${codes.length === 1 ? `${codes[0]} wasn’t` : `${codes.length} shows weren’t`} finished in time, so ${codes.length === 1 ? "it isn’t" : "they aren’t"} shown${codes.length === 1 ? "" : `: ${codes.join(", ")}`}. Ask again with ${codes.length === 1 ? "its code" : "their codes"}.`,
  /** PENDING DESIGN: create_show_campaigns when the show's plan couldn't be read in full. */
  refused: (code: string) => `Refused: ${code} couldn’t be read in time, so nothing was made. Try again.`,
} as const;
