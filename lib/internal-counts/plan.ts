/**
 * lib/internal-counts/plan.ts
 *
 * Turns one parsed Internal Counts email into what's written, what's held
 * and what goes to the review list (D8 as re-ruled by
 * docs/design-record/2026-11-13-internal-counts-matching.html, M1–M5).
 * Pure: the caller supplies events, aliases, names marked "Not a show we
 * run", price ceilings and the stored counts, so the cron, the upload, the
 * review-list actions and the backfill's dry run all share it.
 *
 * A show block is one of:
 *   write    stored now
 *   held     stored only once its review item is resolved (unmatched name,
 *            sheet date ≠ subject date, tiers ≠ total). Nothing resolves itself.
 *   repeat   restates a stored count (same show, date and total): a finished
 *            show stays on the sheet for weeks. Writes nothing, asks nothing.
 *   not_ours a name Matas marked "Not a show we run". Never asks again.
 * A write for a date that already has a different count replaces it (M1
 * corrections) when this email is the later one by its Date header (M1b);
 * both reports are kept and a review note says so. An earlier email that
 * arrives late is kept as 'superseded'. A forward never replaces a stored
 * sheet: its sheet is held, and the "replaced" item opens with "Keep the
 * earlier sheet" · "Use the later sheet".
 */

import { matchShow, UMBRELLA_EVENT_CODES } from "./aliases.ts";
import {
  checkBlock,
  DEFAULT_PRICE_CEILING_PENCE,
  isUnusedTier,
  paidRevenuePence,
  soldAndComps,
  type BlockCheck,
  type PriceFlag,
} from "./checks.ts";
import { mentionKey, saleMentions } from "./mentions.ts";
import { subjectCountDate } from "./message.ts";
import type { ParsedBlock, ParsedSheet } from "./parse.ts";

export type ReviewKind =
  | "price_looks_wrong"
  | "sale_mention"
  | "unmatched_show"
  | "date_mismatch"
  | "sum_mismatch"
  | "unreadable_pdf"
  | "near_miss"
  | "replaced"
  | "since_last_mismatch";

/** Kinds that hold a show's (or the sheet's) counts until resolved. */
export const HOLDING_KINDS: ReadonlySet<ReviewKind> = new Set([
  "unmatched_show",
  "date_mismatch",
  "sum_mismatch",
  "unreadable_pdf",
]);

/** A forward's differing sheet is held too, until Matas keeps the earlier or uses the later one. */
export function isHolding(item: Pick<ReviewItemPlan, "kind" | "detail">): boolean {
  return HOLDING_KINDS.has(item.kind) || (item.kind === "replaced" && item.detail.forward === true);
}

export interface ReviewItemPlan {
  kind: ReviewKind;
  /** null for an item on the whole email or sheet. */
  blockIndex: number | null;
  showName: string | null;
  detail: Record<string, unknown>;
}

export interface EventRef {
  id: string;
  eventCode: string;
  name: string;
  eventDate: string | null;
  userId: string;
  clientId: string | null;
}

export interface CellPlan {
  tierPosition: number;
  tierName: string;
  tierKey: string;
  comp: boolean;
  unused: boolean;
  outlet: string;
  /** null = blank cell (no sales in that outlet); 0 = a printed 0. */
  tickets: number | null;
  pricePence: number | null;
  /** null when the show's revenue is held, or the tier is a comp or unused. */
  revenuePence: number | null;
}

export type BlockStatus = "write" | "held" | "repeat" | "not_ours" | "superseded";

export interface BlockWrite {
  paid: number;
  comps: number;
  total: number;
  revenueHeld: boolean;
  /** The sheet's paid £, kept even when held so "Revenue is right" can release it. */
  paidRevenuePence: number;
  cells: CellPlan[];
}

export interface BlockPlan extends BlockWrite {
  index: number;
  showName: string;
  eventCode: string | null;
  eventId: string | null;
  countDate: string | null;
  status: BlockStatus;
  /** A write that replaces a different count already stored for this date. */
  replaces: boolean;
  /** Their SINCE LAST COUNT, as printed. */
  sinceLast: number | null;
  /** Our delta from the previous stored count, when there is one. */
  ourDelta: number | null;
  priceFlags: PriceFlag[];
  parsed: ParsedBlock;
}

export interface ReportPlan {
  subjectDate: string | null;
  /** The count date most blocks carry. */
  sheetDate: string | null;
  unreadable: boolean;
  blocks: BlockPlan[];
  reviewItems: ReviewItemPlan[];
}

export interface ClosestEvent {
  eventCode: string;
  name: string;
  eventDate: string | null;
}

export interface PlanContext {
  eventsByCode: ReadonlyMap<string, EventRef>;
  confirmedAliases?: Readonly<Record<string, string>>;
  /** Names marked "Not a show we run", exactly as written. */
  notOurs: ReadonlySet<string>;
  /** The closest event to an unmatched name, for "Closest: {event} · {date}". */
  closest: (showName: string) => ClosestEvent | null;
  /** The event's highest paid ticket price in pence, or null when none is stored. */
  priceCeiling: (eventId: string) => number | null;
  /** The latest stored total (paid + comps) for the event before this count date. */
  previousTotal: (eventId: string, countDate: string) => number | null;
  /** What another email already stored for this event and date, or null. */
  storedOn: (eventId: string, countDate: string) => StoredCountRef | null;
  /** True when this sentence was already raised for this count date (M3: one item per sentence per date). */
  mentionSeen: (key: string) => boolean;
}

export interface StoredCountRef {
  total: number;
  /** The storing email's Date header (ISO), when known. */
  sentAt: string | null;
  blockId: string | null;
}

export interface ReportInput {
  subject: string;
  body: string;
  pdfFilename: string | null;
  /** A Fw:/Fwd: email: never replaces a stored sheet. */
  forward: boolean;
  /** The email's Date header (ISO): "later" is this, not fetch order. */
  sentAt: string | null;
  /** The PDF's own date when it won't parse as a sheet (for "Couldn't read the {date} sheet"). */
  pdfDate?: string | null;
}

/** The rows a block writes, for a given total (the sheet's, or the one Matas picked). */
export function blockWrite(block: ParsedBlock, check: BlockCheck, total?: number): BlockWrite {
  const sums = soldAndComps(block, total);
  const cells: CellPlan[] = [];
  for (const row of block.outlets) {
    block.tiers.forEach((tier, i) => {
      const tickets = row.cells[i];
      const unused = isUnusedTier(block, i);
      const price = tier.pricePence;
      const priced = !check.revenueHeld && !tier.comp && !unused && price !== null && price >= 0;
      cells.push({
        tierPosition: tier.position,
        tierName: tier.name,
        tierKey: tier.key,
        comp: tier.comp,
        unused,
        outlet: row.outlet,
        tickets,
        pricePence: price,
        revenuePence: tickets !== null && priced ? tickets * price : null,
      });
    });
  }
  return { ...sums, revenueHeld: check.revenueHeld, paidRevenuePence: paidRevenuePence(block), cells };
}

function mostCommon(values: Array<string | null>): string | null {
  const tally = new Map<string, number>();
  for (const v of values) if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/** M3 items for an email's new text, one per sentence per count date. */
export function mentionItems(
  body: string,
  showNames: readonly string[],
  countDate: string | null,
  forward: boolean,
  ctx: Pick<PlanContext, "notOurs" | "mentionSeen">,
): ReviewItemPlan[] {
  const items: ReviewItemPlan[] = [];
  const seen = new Set<string>();
  for (const m of saleMentions(body, showNames, { forward })) {
    if (m.showName && ctx.notOurs.has(m.showName)) continue;
    const key = mentionKey(m.sentence, countDate);
    if (seen.has(key) || ctx.mentionSeen(key)) continue;
    seen.add(key);
    items.push({ kind: "sale_mention", blockIndex: null, showName: m.showName, detail: { sentence: m.sentence, countDate, key } });
  }
  return items;
}

export function planReport(report: ReportInput, sheet: ParsedSheet | null, ctx: PlanContext): ReportPlan {
  const showNames = sheet?.blocks.map((b) => b.showName) ?? [];
  const unreadable =
    !sheet || sheet.blocks.length === 0 || sheet.blocks.some((b) => b.problems.length > 0 || !b.countDate);
  const sheetDate = unreadable ? null : mostCommon(sheet!.blocks.map((b) => b.countDate));
  const pdfYear = Number((sheetDate ?? report.pdfDate ?? "").slice(0, 4)) || null;
  const subjectDate = subjectCountDate(report.subject, pdfYear);
  const items = mentionItems(report.body, showNames, sheetDate ?? report.pdfDate ?? subjectDate, report.forward, ctx);
  if (unreadable) {
    const problems = sheet ? [...sheet.problems, ...sheet.blocks.flatMap((b) => b.problems)] : ["The PDF couldn't be read."];
    items.push({
      kind: "unreadable_pdf",
      blockIndex: null,
      showName: null,
      detail: { filename: report.pdfFilename, problems, date: report.pdfDate ?? subjectDate },
    });
    return { subjectDate, sheetDate: null, unreadable: true, blocks: [], reviewItems: items };
  }
  sheet = sheet!;
  const dateHeld = subjectDate !== null && sheetDate !== null && subjectDate !== sheetDate;
  if (dateHeld) {
    items.push({ kind: "date_mismatch", blockIndex: null, showName: null, detail: { sheetDate, subjectDate } });
  }
  const blocks = sheet.blocks.map((b) => planBlock(b, { dateHeld, sheetDate, forward: report.forward, sentAt: report.sentAt }, ctx, items));
  return { subjectDate, sheetDate, unreadable: false, blocks, reviewItems: items };
}

function resolveEvent(block: ParsedBlock, ctx: PlanContext): EventRef | null {
  const { eventCode } = matchShow(block.showName, ctx.confirmedAliases);
  if (!eventCode || UMBRELLA_EVENT_CODES.has(eventCode)) return null;
  return ctx.eventsByCode.get(eventCode) ?? null;
}

function planBlock(
  block: ParsedBlock,
  sheet: { dateHeld: boolean; sheetDate: string | null; forward: boolean; sentAt: string | null },
  ctx: PlanContext,
  out: ReviewItemPlan[],
): BlockPlan {
  const event = resolveEvent(block, ctx);
  const ceiling = (event && ctx.priceCeiling(event.id)) ?? DEFAULT_PRICE_CEILING_PENCE;
  const check = checkBlock(block, ceiling);
  const base = {
    index: block.index,
    showName: block.showName,
    eventCode: event?.eventCode ?? null,
    eventId: event?.id ?? null,
    countDate: block.countDate,
    replaces: false,
    sinceLast: block.totals?.sinceLast ?? null,
    ourDelta: null as number | null,
    priceFlags: check.priceFlags,
    parsed: block,
    ...blockWrite(block, check),
  };
  if (ctx.notOurs.has(block.showName)) return { ...base, status: "not_ours" };

  const item = (kind: ReviewKind, detail: Record<string, unknown> = {}): ReviewItemPlan => ({
    kind,
    blockIndex: block.index,
    showName: block.showName,
    detail,
  });
  const items: ReviewItemPlan[] = [];
  let held = sheet.dateHeld && block.countDate === sheet.sheetDate;
  if (!event) {
    items.push(item("unmatched_show", { closest: ctx.closest(block.showName) }));
    held = true;
  }
  if (check.sum) {
    items.push(item("sum_mismatch", check.sum));
    held = true;
  }
  const stored = event && block.countDate ? ctx.storedOn(event.id, block.countDate) : null;
  if (!held && stored && stored.total === base.total) {
    return { ...base, status: "repeat", ourDelta: 0 };
  }
  if (check.revenueHeld) {
    items.push(item("price_looks_wrong", { flags: check.priceFlags, revenueMismatch: check.revenueMismatch }));
  }
  let replaces = false;
  let superseded = false;
  if (event && block.countDate) {
    if (!held && stored) {
      const replaced = { countDate: block.countDate, previousTotal: stored.total, total: base.total, previousBlockId: stored.blockId };
      if (sheet.forward) {
        // A forward never replaces a stored sheet: hold it and ask.
        items.push(item("replaced", { ...replaced, forward: true }));
        held = true;
      } else if (stored.sentAt && sheet.sentAt && sheet.sentAt < stored.sentAt) {
        // This email is the earlier one (Date header): the stored, later sheet stays.
        items.push(item("replaced", { countDate: block.countDate, previousTotal: base.total, total: stored.total, previousIsThis: true }));
        superseded = true;
      } else {
        replaces = true;
        items.push(item("replaced", replaced));
      }
    }
    const prev = ctx.previousTotal(event.id, block.countDate);
    const theirs = block.totals?.sinceLast ?? null;
    if (prev !== null) {
      base.ourDelta = base.total - prev;
      if (theirs !== null && theirs !== base.ourDelta) {
        items.push(item("since_last_mismatch", { theirs, ours: base.ourDelta, previousTotal: prev }));
      }
    }
  }
  out.push(...items);
  return { ...base, replaces, status: held ? "held" : superseded ? "superseded" : "write" };
}
