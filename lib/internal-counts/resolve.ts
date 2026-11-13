/**
 * lib/internal-counts/resolve.ts
 *
 * The review list's actions (R1 of
 * docs/design-record/2026-11-13-internal-counts-matching.html). Only a
 * person resolves an item: each action records the choice, who made it and
 * when, and the item moves to "Checked". Held counts reach the dashboard
 * only through here.
 *
 * "Revenue is right" releases that show's held revenue on the block row and
 * touches no count row (tier_channel_sales, ticket_sales_snapshots).
 */

import { loadRunContext, planContext, rememberCount, type Db, type RunContext } from "./context.ts";
import { checkBlock, DEFAULT_PRICE_CEILING_PENCE } from "./checks.ts";
import type { ParsedBlock } from "./parse.ts";
import { blockWrite, planReport, type ReviewKind } from "./plan.ts";
import { INTERNAL_COUNTS_BUCKET, insertReviewItems, parsePdf, persistCountBlocks, writeBlock } from "./store.ts";

export type ResolveAction =
  | { kind: "revenue_right" }
  | { kind: "keep_holding" }
  | { kind: "add_manual"; eventId: string; figure: number }
  | { kind: "not_a_sale" }
  | { kind: "match"; eventId: string }
  | { kind: "not_ours" }
  | { kind: "use_date"; date: string }
  | { kind: "use_total"; total: number }
  | { kind: "read_as_count" }
  | { kind: "not_a_count" }
  | { kind: "undo" }
  | { kind: "keep" }
  | { kind: "checked" };

/** Which actions each kind of item offers (R1). */
export const ACTIONS: Record<ReviewKind, ReadonlyArray<ResolveAction["kind"]>> = {
  price_looks_wrong: ["revenue_right", "keep_holding"],
  sale_mention: ["add_manual", "not_a_sale"],
  unmatched_show: ["match", "not_ours"],
  date_mismatch: ["use_date"],
  sum_mismatch: ["use_total"],
  unreadable_pdf: ["not_a_count"],
  near_miss: ["read_as_count", "not_a_count"],
  replaced: ["undo", "keep"],
  since_last_mismatch: ["checked"],
};

export interface Resolver {
  userId: string;
  /** Shown in "Checked": "Matas, 12 Nov 14:02". */
  name: string;
}

export function resolverName(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "Someone";
}

interface ItemRow {
  id: string;
  report_id: string;
  block_id: string | null;
  kind: ReviewKind;
  show_name: string | null;
  detail: Record<string, unknown>;
  resolved_at: string | null;
  resolution: string | null;
}

interface BlockRow {
  id: string;
  report_id: string;
  show_name: string;
  event_id: string | null;
  count_date: string | null;
  chosen_total: number | null;
  revenue_held: boolean;
  status: string;
  parsed: ParsedBlock;
}

const BLOCK_COLUMNS = "id,report_id,show_name,event_id,count_date,chosen_total,revenue_held,status,parsed";

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error || data === null) throw new Error(`${what}: ${error?.message ?? "not found"}`);
  return data;
}

async function markResolved(sb: Db, ids: string[], resolution: string, who: Resolver, detail: Record<string, unknown>) {
  if (ids.length === 0) return;
  const { error } = await sb
    .from("internal_count_review_items")
    .update({
      resolution,
      resolution_detail: detail,
      resolved_by: who.userId,
      resolved_by_name: who.name,
      resolved_at: new Date().toISOString(),
    })
    .in("id", ids)
    .is("resolved_at", null);
  if (error) throw new Error(`internal_count_review_items update failed: ${error.message}`);
}

/** Resolve one item with one action. Throws on an action the item doesn't offer. */
export async function resolveItem(sb: Db, itemId: string, action: ResolveAction, who: Resolver, ctx?: RunContext): Promise<void> {
  const item = await must<ItemRow>(
    sb.from("internal_count_review_items").select("id,report_id,block_id,kind,show_name,detail,resolved_at,resolution").eq("id", itemId).single(),
    "review item",
  );
  // R1: a checked "replaced" note keeps its Undo.
  const undoAfterKeep = item.kind === "replaced" && item.resolution === "keep" && action.kind === "undo";
  if (item.resolved_at && !undoAfterKeep) throw new Error("This item is already checked.");
  if (!ACTIONS[item.kind].includes(action.kind)) throw new Error(`"${action.kind}" isn't an action on ${item.kind}.`);
  const run = ctx ?? (await loadRunContext(sb));
  await EFFECTS[action.kind](sb, run, item, action as never, who);
  if (undoAfterKeep) {
    const { error } = await sb
      .from("internal_count_review_items")
      .update({ resolution: "undo", resolved_by: who.userId, resolved_by_name: who.name, resolved_at: new Date().toISOString() })
      .eq("id", item.id);
    if (error) throw new Error(`internal_count_review_items update failed: ${error.message}`);
    return;
  }
  await markResolved(sb, [item.id], action.kind, who, actionDetail(action));
}

function actionDetail(action: ResolveAction): Record<string, unknown> {
  const { kind: _kind, ...rest } = action;
  return rest;
}

type Effect<A extends ResolveAction> = (sb: Db, ctx: RunContext, item: ItemRow, action: A, who: Resolver) => Promise<void>;
const nothing: Effect<ResolveAction> = async () => undefined;

const EFFECTS: { [K in ResolveAction["kind"]]: Effect<Extract<ResolveAction, { kind: K }>> } = {
  revenue_right: async (sb, _ctx, item, _a, who) => {
    if (!item.block_id) throw new Error("The price item has no show block.");
    const { error } = await sb
      .from("internal_count_blocks")
      .update({ revenue_held: false, revenue_released_by: who.userId, revenue_released_at: new Date().toISOString() })
      .eq("id", item.block_id);
    if (error) throw new Error(`Releasing revenue failed: ${error.message}`);
  },
  keep_holding: nothing,
  not_a_sale: nothing,
  not_a_count: nothing,
  keep: nothing,
  checked: nothing,
  add_manual: async (sb, ctx, item, a) => addManualEntry(sb, ctx, item, a.eventId, a.figure),
  match: async (sb, ctx, item, a, who) => matchName(sb, ctx, item, a.eventId, who),
  not_ours: async (sb, ctx, item, _a, who) => markNotOurs(sb, ctx, item, who),
  use_date: async (sb, ctx, item, a) => useDate(sb, ctx, item, a.date),
  use_total: async (sb, ctx, item, a) => {
    if (!item.block_id) throw new Error("The sum item has no show block.");
    const { error } = await sb.from("internal_count_blocks").update({ chosen_total: a.total }).eq("id", item.block_id);
    if (error) throw new Error(`Saving the total failed: ${error.message}`);
    await releaseBlock(sb, ctx, item.block_id, { except: item.id });
  },
  read_as_count: async (sb, ctx, item) => readAsCount(sb, ctx, item),
  undo: async (sb, ctx, item) => {
    const previous = item.detail.previousBlockId as string | null | undefined;
    if (!previous) throw new Error("There's no earlier count to go back to.");
    await rewriteBlock(sb, ctx, previous);
  },
};

async function addManualEntry(sb: Db, ctx: RunContext, item: ItemRow, eventId: string, figure: number): Promise<void> {
  if (!Number.isInteger(figure) || figure < 0) throw new Error("Type the number of tickets.");
  const event = ctx.eventsById.get(eventId);
  if (!event) throw new Error("Choose an event.");
  const report = await must<{ sheet_date: string | null; received_at: string }>(
    sb.from("internal_count_reports").select("sheet_date,received_at").eq("id", item.report_id).single(),
    "report",
  );
  const day = (item.detail.countDate as string | null) ?? report.sheet_date ?? report.received_at.slice(0, 10);
  const { error } = await sb.from("ticket_sales_snapshots").upsert(
    {
      user_id: event.userId,
      event_id: event.id,
      connection_id: null,
      snapshot_at: `${day}T12:00:00Z`,
      tickets_sold: figure,
      source: "manual",
      raw_payload: { internal_count_review_item_id: item.id, sentence: item.detail.sentence ?? null },
    },
    { onConflict: "event_id,snapshot_at,source" },
  );
  if (error) throw new Error(`Adding the manual entry failed: ${error.message}`);
}

async function openItemsNamed(sb: Db, kind: ReviewKind, name: string): Promise<string[]> {
  const { data, error } = await sb
    .from("internal_count_review_items")
    .select("id")
    .eq("kind", kind)
    .eq("show_name", name)
    .is("resolved_at", null);
  if (error) throw new Error(`internal_count_review_items read failed: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

async function heldBlocksNamed(sb: Db, name: string): Promise<BlockRow[]> {
  const { data, error } = await sb.from("internal_count_blocks").select(BLOCK_COLUMNS).eq("show_name", name).eq("status", "held");
  if (error) throw new Error(`internal_count_blocks read failed: ${error.message}`);
  return (data ?? []) as BlockRow[];
}

async function saveName(sb: Db, name: string, eventId: string | null, who: Resolver): Promise<void> {
  const { error } = await sb.from("internal_count_show_names").upsert(
    {
      name,
      event_id: eventId,
      not_ours: eventId === null,
      decided_by: who.userId,
      decided_by_name: who.name,
      decided_at: new Date().toISOString(),
    },
    { onConflict: "name" },
  );
  if (error) throw new Error(`Saving the name failed: ${error.message}`);
}

/** "Match to {event}": every held block with this exact name joins the event; the same name's other open items are checked by the same choice. */
async function matchName(sb: Db, ctx: RunContext, item: ItemRow, eventId: string, who: Resolver): Promise<void> {
  const name = item.show_name ?? "";
  const event = ctx.eventsById.get(eventId);
  if (!event || !name) throw new Error("Choose an event.");
  await saveName(sb, name, eventId, who);
  ctx.aliases[name] = event.eventCode;
  const others = (await openItemsNamed(sb, "unmatched_show", name)).filter((id) => id !== item.id);
  await markResolved(sb, others, "match", who, { eventId, via: item.id });
  for (const block of await heldBlocksNamed(sb, name)) {
    const { error } = await sb.from("internal_count_blocks").update({ event_id: eventId }).eq("id", block.id);
    if (error) throw new Error(`Matching the block failed: ${error.message}`);
    await releaseBlock(sb, ctx, block.id, { except: item.id });
  }
}

/** "Not a show we run": never asks again for this name. */
async function markNotOurs(sb: Db, ctx: RunContext, item: ItemRow, who: Resolver): Promise<void> {
  const name = item.show_name ?? "";
  if (!name) throw new Error("This item has no name.");
  await saveName(sb, name, null, who);
  ctx.notOurs.add(name);
  const others = [
    ...(await openItemsNamed(sb, "unmatched_show", name)),
    ...(await openItemsNamed(sb, "sale_mention", name)),
  ].filter((id) => id !== item.id);
  await markResolved(sb, others, "not_ours", who, { via: item.id });
  const { error } = await sb.from("internal_count_blocks").update({ status: "not_ours" }).eq("show_name", name).eq("status", "held");
  if (error) throw new Error(`Updating the blocks failed: ${error.message}`);
}

async function useDate(sb: Db, ctx: RunContext, item: ItemRow, date: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date.");
  const sheetDate = item.detail.sheetDate as string | null;
  const { data, error } = await sb
    .from("internal_count_blocks")
    .select(BLOCK_COLUMNS)
    .eq("report_id", item.report_id)
    .eq("status", "held");
  if (error) throw new Error(`internal_count_blocks read failed: ${error.message}`);
  for (const b of (data ?? []) as BlockRow[]) {
    if (b.count_date !== sheetDate) continue;
    const { error: uErr } = await sb.from("internal_count_blocks").update({ count_date: date }).eq("id", b.id);
    if (uErr) throw new Error(`Setting the date failed: ${uErr.message}`);
    await releaseBlock(sb, ctx, b.id, { except: item.id });
  }
}

/** True while another open holding item (on the block, or the sheet's date item) still holds it. */
async function stillHeld(sb: Db, block: BlockRow, except: string): Promise<boolean> {
  const { data, error } = await sb
    .from("internal_count_review_items")
    .select("id,block_id,kind")
    .eq("report_id", block.report_id)
    .eq("holding", true)
    .is("resolved_at", null);
  if (error) throw new Error(`internal_count_review_items read failed: ${error.message}`);
  const open = ((data ?? []) as Array<{ id: string; block_id: string | null; kind: string }>).filter((i) => i.id !== except);
  if (open.some((i) => i.block_id === block.id || i.kind === "date_mismatch")) return true;
  return (await openItemsNamed(sb, "unmatched_show", block.show_name)).some((id) => id !== except) && !block.event_id;
}

/** Write a held block once nothing holds it. Repeats and replacements follow M1, as on first read. */
export async function releaseBlock(sb: Db, ctx: RunContext, blockId: string, opts: { except: string }): Promise<void> {
  const block = await must<BlockRow>(sb.from("internal_count_blocks").select(BLOCK_COLUMNS).eq("id", blockId).single(), "block");
  if (block.status !== "held" || !block.event_id || !block.count_date) return;
  if (await stillHeld(sb, block, opts.except)) return;
  const event = ctx.eventsById.get(block.event_id);
  if (!event) throw new Error("The block's event no longer exists.");
  const check = checkBlock(block.parsed, ctx.ceilings.get(event.id) ?? DEFAULT_PRICE_CEILING_PENCE);
  const w = blockWrite(block.parsed, { ...check, revenueHeld: block.revenue_held }, block.chosen_total ?? undefined);
  const stored = ctx.counts.find((c) => c.eventId === event.id && c.countDate === block.count_date);
  const update = { paid_tickets: w.paid, comp_tickets: w.comps, total_tickets: w.total };
  if (stored && stored.total === w.total) {
    await sb.from("internal_count_blocks").update({ ...update, status: "repeat" }).eq("id", block.id);
    return;
  }
  await sb.from("internal_count_blocks").update(update).eq("id", block.id);
  await writeBlock(sb, {
    blockId: block.id,
    reportId: block.report_id,
    event,
    plan: { ...w, showName: block.show_name, sinceLast: block.parsed.totals?.sinceLast ?? null },
    countDate: block.count_date,
    total: w.total,
  });
  rememberCount(ctx, { eventId: event.id, countDate: block.count_date, total: w.total, blockId: block.id });
  if (stored) {
    const { data: r } = await sb.from("internal_count_reports").select("user_id").eq("id", block.report_id).single();
    await insertReviewItems(
      sb,
      block.report_id,
      (r?.user_id as string) ?? event.userId,
      [
        {
          kind: "replaced",
          blockIndex: null,
          showName: block.show_name,
          detail: { countDate: block.count_date, previousTotal: stored.total, total: w.total, previousBlockId: stored.blockId },
        },
      ],
      new Map(),
    );
  }
}

/** Undo: write an earlier block again; the later one becomes 'replaced'. */
async function rewriteBlock(sb: Db, ctx: RunContext, blockId: string): Promise<void> {
  const block = await must<BlockRow>(sb.from("internal_count_blocks").select(BLOCK_COLUMNS).eq("id", blockId).single(), "block");
  if (!block.event_id || !block.count_date) throw new Error("That count has no event or date.");
  const event = ctx.eventsById.get(block.event_id);
  if (!event) throw new Error("The block's event no longer exists.");
  const check = checkBlock(block.parsed, ctx.ceilings.get(event.id) ?? DEFAULT_PRICE_CEILING_PENCE);
  const w = blockWrite(block.parsed, { ...check, revenueHeld: block.revenue_held }, block.chosen_total ?? undefined);
  await writeBlock(sb, {
    blockId: block.id,
    reportId: block.report_id,
    event,
    plan: { ...w, showName: block.show_name, sinceLast: block.parsed.totals?.sinceLast ?? null },
    countDate: block.count_date,
    total: w.total,
  });
  rememberCount(ctx, { eventId: event.id, countDate: block.count_date, total: w.total, blockId: block.id });
}

/** "Read it as a count": the near miss's stored PDF goes through the count path, as if it had matched. */
async function readAsCount(sb: Db, ctx: RunContext, item: ItemRow): Promise<void> {
  const report = await must<{ id: string; user_id: string; subject: string; body_text: string; storage_path: string | null; pdf_filename: string | null }>(
    sb.from("internal_count_reports").select("id,user_id,subject,body_text,storage_path,pdf_filename").eq("id", item.report_id).single(),
    "report",
  );
  if (!report.storage_path) throw new Error("The email's PDF wasn't stored.");
  const { data, error } = await sb.storage.from(INTERNAL_COUNTS_BUCKET).download(report.storage_path);
  if (error || !data) throw new Error("The PDF couldn't be read from storage.");
  const sheet = await parsePdf(new Uint8Array(await data.arrayBuffer()));
  const plan = planReport({ subject: report.subject, body: report.body_text, pdfFilename: report.pdf_filename }, sheet, planContext(ctx));
  const { error: uErr } = await sb
    .from("internal_count_reports")
    .update({ kind: "count", status: plan.unreadable ? "unreadable" : "processed", subject_date: plan.subjectDate, sheet_date: plan.sheetDate })
    .eq("id", report.id);
  if (uErr) throw new Error(`Updating the report failed: ${uErr.message}`);
  await persistCountBlocks(sb, ctx, report.id, report.user_id, plan);
}
