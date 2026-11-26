/**
 * lib/mcp/meta/ceiling-words.ts — what the per-show spend ceiling tells Claude
 * (PR D, Matas 26 Nov: "the ceiling is the campaign budget").
 *
 * Every string here is PENDING DESIGN: none has a row in a merged design
 * record yet. Each is registered in CEILING_FOR_DESIGN with its key, where it
 * shows and the builder's candidate; the PR body's "For design" table is that
 * list. When design rules them, the ruled words replace the candidates here
 * and the entries leave CEILING_FOR_DESIGN.
 *
 * They replace the daily client ceiling's rows (claude.mcp.refused,
 * claude.mcp.refused.none, .no_client, .ceiling_unread and
 * claude.mcp.live.skip.ceiling), which spoke of "the client's daily ceiling";
 * those rows stay in lib/mcp/meta/words.ts and lib/mcp/live/words.ts as the
 * record, unused by the ceiling check.
 *
 * Claude gets names, codes, counts and £ amounts with the source of each
 * part: never a raw error, a token or a hash.
 *
 * Relative imports only (node:test).
 */
import type { PendingWord } from "../live/words.ts";

/** £1,234.56 */
export const pounds = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Every PENDING DESIGN string, in one list. */
export const CEILING_FOR_DESIGN: PendingWord[] = [];

function pending(key: string, where: string, candidate: string): string {
  CEILING_FOR_DESIGN.push({ key, where, candidate });
  return candidate;
}

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

const T = {
  over: pending(
    "claude.mcp.ceiling.over",
    "Told to Claude, a change that would take a show's committed spend over its ceiling",
    "Refused: this would take {show} to £{after} committed, over its £{ceiling} ceiling ({source}). That’s £{spent} spent to date (Off/Pixel’s Meta insights, {through}), £{lifetime} left on live lifetime budgets and £{daily} in live daily budgets to their end or show day (both read from Meta now); this change adds £{delta}. Nothing was sent to Meta.",
  ),
  none: pending(
    "claude.mcp.ceiling.none",
    "Told to Claude, a spend-starting or spend-raising change on a show with no ceiling",
    "Refused: {show} has no spend ceiling, so nothing that starts or raises spend can run. Matas sets one for the show. Nothing was sent to Meta.",
  ),
  pendingDefault: pending(
    "claude.mcp.ceiling.none.pending_default",
    "Told to Claude, a show whose brand default isn't confirmed yet (EBR)",
    "Refused: {show} has no spend ceiling yet: the {brand} default of £{x} waits for Matas to confirm it. Nothing was sent to Meta.",
  ),
  noShow: pending(
    "claude.mcp.ceiling.no_show",
    "Told to Claude, a live launch of a draft that isn't on an event",
    "Refused: this draft isn’t on a show, so there’s no spend ceiling to check a live launch against. Nothing was sent to Meta.",
  ),
  unread: pending(
    "claude.mcp.ceiling.unread",
    "Told to Claude, the ceiling or the spend to date couldn't be read",
    "Refused: {show}’s spend ceiling or spend to date couldn’t be read. Try again. Nothing was sent to Meta.",
  ),
  unbounded: pending(
    "claude.mcp.ceiling.unbounded",
    "Told to Claude, a live daily budget with no end date on a show with no date",
    "Refused: {name} has a daily budget with no end date and {show} has no show date, so its committed spend can’t be added up. Nothing was sent to Meta.",
  ),
  otherCurrency: pending(
    "claude.mcp.ceiling.currency",
    "Told to Claude, a show whose spend or live budgets include an ad account not in £",
    "Refused: {show}’s spend includes ad account {account}, which spends in {currency}, and ceilings are in £. Nothing was sent to Meta.",
  ),
  sourceDefault: pending("claude.mcp.ceiling.source.default", "Inside claude.mcp.ceiling.over: the ceiling is a brand default", "the {brand} default"),
  sourceOwn: pending("claude.mcp.ceiling.source.own", "Inside claude.mcp.ceiling.over: the ceiling was set for this show", "set for this show"),
  sourceGroup: pending("claude.mcp.ceiling.source.group", "Inside claude.mcp.ceiling.over: the ceiling is shared by a group of shows", "shared by {codes}"),
  through: pending("claude.mcp.ceiling.through", "Inside claude.mcp.ceiling.over: the last day of spend recorded", "to {date}"),
  noSpendYet: pending("claude.mcp.ceiling.through.none", "Inside claude.mcp.ceiling.over: no spend recorded yet", "none yet"),
  skip: pending(
    "claude.mcp.live.skip.show_ceiling",
    "Today's log, a scheduled budget rise skipped at its time",
    "Skipped: by then it would have taken the show over its spend ceiling, or the show had no ceiling.",
  ),
} as const;

export type CeilingSource = { kind: "default"; brand: string } | { kind: "own" } | { kind: "group"; codes: string[] };

export function sourceWords(s: CeilingSource): string {
  if (s.kind === "default") return fill(T.sourceDefault, { brand: s.brand });
  if (s.kind === "own") return T.sourceOwn;
  return fill(T.sourceGroup, { codes: s.codes.join(" and ") });
}

export const CEILING_WORDS = {
  over: (v: { show: string; after: number; ceiling: number; source: CeilingSource; spent: number; through: string | null; lifetime: number; daily: number; delta: number }) =>
    fill(T.over, {
      show: v.show,
      after: pounds(v.after),
      ceiling: pounds(v.ceiling),
      source: sourceWords(v.source),
      spent: pounds(v.spent),
      through: v.through ? fill(T.through, { date: v.through }) : T.noSpendYet,
      lifetime: pounds(v.lifetime),
      daily: pounds(v.daily),
      delta: pounds(Math.max(0, v.delta)),
    }),
  none: (show: string) => fill(T.none, { show }),
  pendingDefault: (show: string, brand: string, x: number) => fill(T.pendingDefault, { show, brand, x: pounds(x) }),
  noShow: T.noShow,
  unread: (show: string) => fill(T.unread, { show }),
  unbounded: (name: string, show: string) => fill(T.unbounded, { name, show }),
  otherCurrency: (show: string, account: string, currency: string) => fill(T.otherCurrency, { show, account, currency }),
  skip: T.skip,
} as const;
