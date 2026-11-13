/**
 * lib/internal-counts/plan.ts
 *
 * Turns one parsed Internal Counts email into what should be written and
 * what goes to the review list (D8, HD1). Pure: the caller supplies the
 * events, the confirmed aliases and the previously stored counts, so the
 * cron, the upload, the review-list rerun and the backfill's dry run all
 * share it.
 *
 * Nothing is half-written: a block either writes all its rows or none.
 */

import { matchShow, UMBRELLA_EVENT_CODES } from "./aliases.ts";
import { checkBlock, paidRevenuePence, soldAndComps, type BlockCheck } from "./checks.ts";
import { bodyMentionsSales, subjectCountDate } from "./message.ts";
import type { ParsedBlock, ParsedSheet } from "./parse.ts";

export type ReviewKind =
  | "unreadable_pdf"
  | "check_failed"
  | "unmatched_show"
  | "unknown_event"
  | "umbrella"
  | "duplicate_count_date"
  | "price_looks_wrong"
  | "count_date_mismatch"
  | "since_last_mismatch"
  | "body_mentions_sales";

/** Kinds that stop a block from writing. The rest are notes beside a written count. */
export const BLOCKING_KINDS: ReadonlySet<ReviewKind> = new Set([
  "unreadable_pdf",
  "check_failed",
  "unmatched_show",
  "unknown_event",
  "umbrella",
  "duplicate_count_date",
]);

export interface ReviewItemPlan {
  kind: ReviewKind;
  blockIndex: number | null;
  showName: string | null;
  message: string;
  detail: Record<string, unknown>;
}

export interface EventRef {
  id: string;
  eventCode: string;
  userId: string;
  clientId: string | null;
}

export interface CellPlan {
  tierPosition: number;
  tierName: string;
  tierKey: string;
  comp: boolean;
  outlet: string;
  /** null = blank cell (no sales in that outlet); 0 = a printed 0. */
  tickets: number | null;
  pricePence: number | null;
  /** null when the show's revenue is withheld or the tier has no usable price. */
  revenuePence: number | null;
}

export interface BlockPlan {
  index: number;
  showName: string;
  eventCode: string | null;
  proposedEventCode: string | null;
  eventId: string | null;
  countDate: string | null;
  write: boolean;
  /**
   * The block restates a count already stored (same show, date and total):
   * a finished show stays on the sheet with its last count for weeks. It
   * writes nothing and raises nothing.
   */
  repeat: boolean;
  paid: number;
  comps: number;
  total: number;
  /** Their SINCE LAST COUNT, as printed. */
  sinceLast: number | null;
  /** Our delta from the previous stored count, when there is one. */
  ourDelta: number | null;
  revenueWithheld: boolean;
  paidRevenuePence: number | null;
  cells: CellPlan[];
  parsed: ParsedBlock;
}

export interface ReportPlan {
  subjectDate: string | null;
  blocks: BlockPlan[];
  reviewItems: ReviewItemPlan[];
}

export interface ReportInput {
  subject: string;
  body: string;
}

export interface PlanContext {
  eventsByCode: ReadonlyMap<string, EventRef>;
  confirmedAliases?: Readonly<Record<string, string>>;
  /** The latest stored count total (paid + comps) for the event before this count date. */
  previousTotal: (eventId: string, countDate: string) => number | null;
  /** The total another email already stored for this event and date, or null. */
  storedTotalOn: (eventId: string, countDate: string) => number | null;
}

export function planReport(report: ReportInput, sheet: ParsedSheet | null, ctx: PlanContext): ReportPlan {
  const subjectDate = subjectCountDate(report.subject);
  const reviewItems: ReviewItemPlan[] = [];
  if (bodyMentionsSales(report.body)) {
    reviewItems.push({
      kind: "body_mentions_sales",
      blockIndex: null,
      showName: null,
      message: "Email mentions sales not in the sheet",
      detail: {},
    });
  }
  if (!sheet || sheet.blocks.length === 0) {
    reviewItems.push({
      kind: "unreadable_pdf",
      blockIndex: null,
      showName: null,
      message: sheet?.problems[0] ?? "The PDF couldn't be read.",
      detail: { problems: sheet?.problems ?? [] },
    });
    return { subjectDate, blocks: [], reviewItems };
  }
  const blocks = sheet.blocks.map((b) => planBlock(b, subjectDate, ctx, reviewItems));
  return { subjectDate, blocks, reviewItems };
}

function item(block: ParsedBlock, kind: ReviewKind, message: string, detail: Record<string, unknown> = {}): ReviewItemPlan {
  return { kind, blockIndex: block.index, showName: block.showName, message, detail };
}

function planBlock(
  block: ParsedBlock,
  subjectDate: string | null,
  ctx: PlanContext,
  out: ReviewItemPlan[],
): BlockPlan {
  const check = checkBlock(block);
  const items: ReviewItemPlan[] = [];
  if (check.blocking.length) {
    items.push(item(block, "check_failed", check.blocking[0], { failures: check.blocking }));
  }
  const match = matchShow(block.showName, ctx.confirmedAliases);
  const event = resolveEvent(block, match, ctx, items);
  const sums = soldAndComps(block);
  const countDate = block.countDate;
  const stored = event && countDate ? ctx.storedTotalOn(event.id, countDate) : null;
  const repeat = stored !== null && stored === sums.total && check.blocking.length === 0;
  if (repeat) {
    return {
      ...blockBase(block, match, event, countDate, sums, check),
      write: false,
      repeat: true,
      ourDelta: 0,
    };
  }
  addNotes(block, check, subjectDate, items);

  let ourDelta: number | null = null;
  if (event && countDate) {
    if (stored !== null) {
      items.push(
        item(block, "duplicate_count_date", `${block.showName} on ${countDate} is already stored as ${stored} from another email; this one says ${sums.total}.`, {
          stored,
          thisEmail: sums.total,
        }),
      );
    }
    const prev = ctx.previousTotal(event.id, countDate);
    if (prev !== null) {
      ourDelta = sums.total - prev;
      const theirs = block.totals?.sinceLast ?? null;
      if (theirs !== null && theirs !== ourDelta) {
        items.push(
          item(block, "since_last_mismatch", `SINCE LAST COUNT says ${theirs}; our stored counts give ${ourDelta}.`, {
            theirs,
            ours: ourDelta,
            previousTotal: prev,
          }),
        );
      }
    }
  }
  out.push(...items);
  const write = event !== null && countDate !== null && !items.some((i) => BLOCKING_KINDS.has(i.kind));
  return { ...blockBase(block, match, event, countDate, sums, check), write, repeat: false, ourDelta };
}

function blockBase(
  block: ParsedBlock,
  match: ReturnType<typeof matchShow>,
  event: EventRef | null,
  countDate: string | null,
  sums: ReturnType<typeof soldAndComps>,
  check: BlockCheck,
) {
  return {
    index: block.index,
    showName: block.showName,
    eventCode: match.eventCode,
    proposedEventCode: match.proposedEventCode,
    eventId: event?.id ?? null,
    countDate,
    ...sums,
    sinceLast: block.totals?.sinceLast ?? null,
    revenueWithheld: check.revenueWithheld,
    paidRevenuePence: check.blocking.length ? null : paidRevenuePence(block, check),
    cells: cellsOf(block, check),
    parsed: block,
  };
}

function resolveEvent(
  block: ParsedBlock,
  match: ReturnType<typeof matchShow>,
  ctx: PlanContext,
  items: ReviewItemPlan[],
): EventRef | null {
  if (!match.eventCode) {
    const proposal = match.proposedEventCode ? ` Proposed: ${match.proposedEventCode}.` : "";
    items.push(
      item(block, "unmatched_show", `No count alias for "${block.showName}".${proposal}`, {
        proposedEventCode: match.proposedEventCode,
      }),
    );
    return null;
  }
  if (UMBRELLA_EVENT_CODES.has(match.eventCode)) {
    items.push(item(block, "umbrella", `${match.eventCode} is an umbrella and gets no counts.`));
    return null;
  }
  const event = ctx.eventsByCode.get(match.eventCode) ?? null;
  if (!event) {
    items.push(item(block, "unknown_event", `"${block.showName}" maps to ${match.eventCode}, which isn't an event.`));
  }
  return event;
}

function addNotes(block: ParsedBlock, check: BlockCheck, subjectDate: string | null, items: ReviewItemPlan[]): void {
  if (check.revenueWithheld) {
    const prices = check.priceLooksWrong.map((p) => {
      const t = block.tiers[p - 1];
      return `${t.name || `column ${p}`} £${((t.pricePence ?? 0) / 100).toFixed(2)}`;
    });
    items.push(
      item(block, "price_looks_wrong", `Prices look wrong (${prices.join(", ")}). Counts stored; revenue withheld.`, {
        tierPositions: check.priceLooksWrong,
      }),
    );
  }
  if (block.countDate && subjectDate && block.countDate !== subjectDate) {
    items.push(
      item(block, "count_date_mismatch", `The sheet says ${block.countDateText}; the subject says ${subjectDate}.`, {
        sheet: block.countDate,
        subject: subjectDate,
      }),
    );
  }
}

function cellsOf(block: ParsedBlock, check: BlockCheck): CellPlan[] {
  const cells: CellPlan[] = [];
  for (const row of block.outlets) {
    block.tiers.forEach((tier, i) => {
      const tickets = row.cells[i];
      const price = tier.pricePence;
      const priced = !check.revenueWithheld && price !== null && price >= 0;
      cells.push({
        tierPosition: tier.position,
        tierName: tier.name,
        tierKey: tier.key,
        comp: tier.comp,
        outlet: row.outlet,
        tickets,
        pricePence: price,
        revenuePence: tickets !== null && priced ? tickets * price : null,
      });
    });
  }
  return cells;
}
