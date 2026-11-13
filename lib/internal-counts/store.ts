/**
 * lib/internal-counts/store.ts
 *
 * Reads, plans and writes one email (M1–M4 of
 * docs/design-record/2026-11-13-internal-counts-matching.html). Shared by
 * the cron, the "Upload count PDF" backstop, the review-list actions and
 * the backfill, so all of them run the same parser and the same checks.
 *
 * - Idempotent on the Gmail message id: a message already read writes 0 rows.
 * - A count's show block writes through write_internal_count_block
 *   (migration 234), one transaction: every row it implies, or none.
 * - A reply in a count's thread is stored as a note on that count; its text
 *   runs the M3 sales check. A near miss is stored with its PDF and one
 *   review item, and nothing is read from it unless Matas says so.
 * - A dry run reads only, keeping what it would have written in the run
 *   context so later emails in the same run see it.
 *
 * Relative imports only (the node --test runner can't resolve `@/`); the
 * PDF library loads lazily inside pdf-text.ts.
 */

import { planContext, rememberCount, type Db, type RunContext } from "./context.ts";
import { pdfSha256, readPdf, type ReadPdf } from "./pdf-read.ts";
import type { ParsedSheet } from "./parse.ts";
import { isHolding, mentionItems, planReport, type BlockPlan, type EventRef, type ReportPlan, type ReviewItemPlan } from "./plan.ts";

export { pdfSha256 };

export const INTERNAL_COUNTS_BUCKET = "internal-counts";

/** "count" and "unreadable" both take the count path; an unreadable sheet stores nothing but its item. */
export type MessageKind = "count" | "unreadable" | "reply" | "near_miss";

export interface IncomingMessage {
  userId: string;
  source: "gmail" | "upload";
  kind: MessageKind;
  /** Gmail message id, or upload:{pdf sha256}. */
  messageId: string;
  threadId: string | null;
  receivedAt: string;
  /** The email's Date header (ISO): "later" is this, not fetch order (M1b). */
  sentAt: string | null;
  sender: string | null;
  subject: string;
  body: string;
  forward: boolean;
  /** The PDF the email is read by (pdf-read.ts chooseSheet), or for a near miss its first PDF. */
  pdf: ReadPdf | null;
}

export interface ProcessOptions {
  dryRun?: boolean;
  /** Dry run only: treat these names as matched (e.g. the 12 Nov proposals). */
  confirmedAliases?: Readonly<Record<string, string>>;
}

export interface ProcessResult {
  messageId: string;
  kind: MessageKind;
  status: "already_read" | "processed" | "unreadable" | "duplicate" | "note" | "not_read";
  dryRun: boolean;
  blocksWritten: number;
  blocksHeld: number;
  plan: ReportPlan | null;
  /** Review items this email adds (for a reply or near miss too). */
  reviewItems: ReviewItemPlan[];
}

export async function parsePdf(bytes: Uint8Array): Promise<ParsedSheet | null> {
  return (await readPdf("stored.pdf", bytes)).sheet;
}

export async function isAlreadyRead(sb: Db, messageId: string): Promise<boolean> {
  const { data, error } = await sb.from("internal_count_reports").select("id").eq("gmail_message_id", messageId).maybeSingle();
  if (error) throw new Error(`internal_count_reports read failed: ${error.message}`);
  return data !== null;
}

function result(input: IncomingMessage, dryRun: boolean, over: Partial<ProcessResult>): ProcessResult {
  return {
    messageId: input.messageId,
    kind: input.kind,
    status: "processed",
    dryRun,
    blocksWritten: 0,
    blocksHeld: 0,
    plan: null,
    reviewItems: [],
    ...over,
  };
}

/** What a thread's count gives its replies: the sheet's show names and count date. */
interface ThreadSheet {
  reportId: string | null;
  showNames: string[];
  sheetDate: string | null;
}

const threadSheets = new WeakMap<RunContext, Map<string, ThreadSheet>>();

function rememberThread(ctx: RunContext, threadId: string | null, sheet: ThreadSheet): void {
  if (!threadId) return;
  if (!threadSheets.has(ctx)) threadSheets.set(ctx, new Map());
  threadSheets.get(ctx)!.set(threadId, sheet);
  ctx.countThreads.set(threadId, sheet.reportId ?? `pending:${threadId}`);
}

function rememberMentions(ctx: RunContext, items: ReviewItemPlan[]): void {
  for (const i of items) if (i.kind === "sale_mention" && typeof i.detail.key === "string") ctx.mentionKeys.add(i.detail.key);
}

export async function processMessage(
  sb: Db,
  ctx: RunContext,
  input: IncomingMessage,
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  const dryRun = opts.dryRun ?? false;
  if (!ctx.offline && (await isAlreadyRead(sb, input.messageId))) {
    return result(input, dryRun, { status: "already_read" });
  }
  if (input.kind === "reply") return processReply(sb, ctx, input, dryRun);
  if (input.kind === "near_miss") return processNearMiss(sb, input, dryRun);
  if (input.kind === "count" && input.pdf && ctx.pdfShas.has(input.pdf.sha256)) return processDuplicate(sb, ctx, input, dryRun);

  const pctx = planContext(ctx, opts.confirmedAliases);
  const plan = planReport(
    {
      subject: input.subject,
      body: input.body,
      pdfFilename: input.pdf?.filename ?? null,
      forward: input.forward,
      sentAt: input.sentAt,
      pdfDate: input.pdf?.pdfDate ?? null,
    },
    input.pdf?.sheet ?? null,
    pctx,
  );
  const status = plan.unreadable ? "unreadable" : "processed";
  const writes = plan.blocks.filter((b) => b.status === "write");
  const held = plan.blocks.filter((b) => b.status === "held").length;
  rememberMentions(ctx, plan.reviewItems);
  if (input.pdf && !plan.unreadable) ctx.pdfShas.add(input.pdf.sha256);
  const threadSheet = { showNames: plan.blocks.map((b) => b.showName), sheetDate: plan.sheetDate };
  if (!plan.unreadable) rememberThread(ctx, input.threadId, { reportId: null, ...threadSheet });
  if (dryRun) {
    for (const b of writes) {
      rememberCount(ctx, { eventId: b.eventId!, countDate: b.countDate!, total: b.total, blockId: null, sentAt: input.sentAt });
    }
    return result(input, dryRun, { status, blocksWritten: writes.length, blocksHeld: held, plan, reviewItems: plan.reviewItems });
  }

  const reportId = await insertReport(sb, input, {
    kind: "count",
    status,
    subjectDate: plan.subjectDate,
    sheetDate: plan.sheetDate,
    parentReportId: null,
  });
  if (!plan.unreadable) rememberThread(ctx, input.threadId, { reportId, ...threadSheet });
  let written: number;
  try {
    written = await persistCountBlocks(sb, ctx, reportId, input.userId, plan, input.sentAt);
  } catch (err) {
    // Unread it so the next run retries the whole email; every write restates the same rows.
    await sb.from("internal_count_reports").delete().eq("id", reportId);
    if (input.threadId) ctx.countThreads.delete(input.threadId);
    throw err;
  }
  return result(input, dryRun, { status, blocksWritten: written, blocksHeld: held, plan, reviewItems: plan.reviewItems });
}

/** The same PDF (sha256) as a count already read: one count. The email is kept, and its new text still runs M3. */
async function processDuplicate(sb: Db, ctx: RunContext, input: IncomingMessage, dryRun: boolean): Promise<ProcessResult> {
  const sheet = input.pdf!.sheet;
  const items = mentionItems(input.body, sheet?.blocks.map((b) => b.showName) ?? [], input.pdf!.pdfDate, input.forward, {
    notOurs: ctx.notOurs,
    mentionSeen: (k) => ctx.mentionKeys.has(k),
  });
  rememberMentions(ctx, items);
  rememberThread(ctx, input.threadId, { reportId: null, showNames: sheet?.blocks.map((b) => b.showName) ?? [], sheetDate: input.pdf!.pdfDate });
  if (dryRun) return result(input, dryRun, { status: "duplicate", reviewItems: items });
  const reportId = await insertReport(sb, input, {
    kind: "count",
    status: "duplicate",
    subjectDate: null,
    sheetDate: input.pdf!.pdfDate,
    parentReportId: null,
  });
  await insertReviewItems(sb, reportId, input.userId, items, new Map());
  return result(input, dryRun, { status: "duplicate", reviewItems: items });
}

async function threadSheetFor(sb: Db, ctx: RunContext, threadId: string | null): Promise<ThreadSheet | null> {
  if (!threadId) return null;
  const known = threadSheets.get(ctx)?.get(threadId);
  if (known) return known;
  const reportId = ctx.countThreads.get(threadId);
  if (!reportId || reportId.startsWith("pending:") || ctx.offline) return null;
  return { reportId, showNames: await parentShowNames(sb, reportId), sheetDate: await parentSheetDate(sb, reportId) };
}

async function processReply(sb: Db, ctx: RunContext, input: IncomingMessage, dryRun: boolean): Promise<ProcessResult> {
  const parent = await threadSheetFor(sb, ctx, input.threadId);
  const items = mentionItems(input.body, parent?.showNames ?? [], parent?.sheetDate ?? null, input.forward, {
    notOurs: ctx.notOurs,
    mentionSeen: (k) => ctx.mentionKeys.has(k),
  });
  rememberMentions(ctx, items);
  if (dryRun) return result(input, dryRun, { status: "note", reviewItems: items });
  const reportId = await insertReport(sb, input, {
    kind: "reply",
    status: "note",
    subjectDate: null,
    sheetDate: parent?.sheetDate ?? null,
    parentReportId: parent?.reportId ?? null,
  });
  await insertReviewItems(sb, reportId, input.userId, items, new Map());
  return result(input, dryRun, { status: "note", reviewItems: items });
}

async function processNearMiss(sb: Db, input: IncomingMessage, dryRun: boolean): Promise<ProcessResult> {
  const items: ReviewItemPlan[] = [
    { kind: "near_miss", blockIndex: null, showName: null, detail: { subject: input.subject, filename: input.pdf?.filename ?? null } },
  ];
  if (dryRun) return result(input, dryRun, { status: "not_read", reviewItems: items });
  const reportId = await insertReport(sb, input, {
    kind: "near_miss",
    status: "not_read",
    subjectDate: null,
    sheetDate: null,
    parentReportId: null,
  });
  await insertReviewItems(sb, reportId, input.userId, items, new Map());
  return result(input, dryRun, { status: "not_read", reviewItems: items });
}

async function parentShowNames(sb: Db, reportId: string): Promise<string[]> {
  const { data, error } = await sb.from("internal_count_blocks").select("show_name").eq("report_id", reportId);
  if (error) throw new Error(`internal_count_blocks read failed: ${error.message}`);
  return ((data ?? []) as Array<{ show_name: string }>).map((b) => b.show_name);
}

async function parentSheetDate(sb: Db, reportId: string): Promise<string | null> {
  const { data } = await sb.from("internal_count_reports").select("sheet_date").eq("id", reportId).maybeSingle();
  return (data?.sheet_date as string | null) ?? null;
}

async function storePdf(sb: Db, input: IncomingMessage, sha: string): Promise<string> {
  const day = input.receivedAt.slice(0, 10);
  const safeId = input.messageId.replace(/[^A-Za-z0-9_-]/g, "_");
  const path = `${day}/${safeId}-${sha.slice(0, 12)}.pdf`;
  const { error } = await sb.storage
    .from(INTERNAL_COUNTS_BUCKET)
    .upload(path, input.pdf!.bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`internal-counts upload failed: ${error.message}`);
  return path;
}

class AlreadyRead extends Error {}

async function insertReport(
  sb: Db,
  input: IncomingMessage,
  r: { kind: MessageKind; status: string; subjectDate: string | null; sheetDate: string | null; parentReportId: string | null },
): Promise<string> {
  const sha = input.pdf?.sha256 ?? null;
  const storagePath = input.pdf ? await storePdf(sb, input, sha!) : null;
  const { data, error } = await sb
    .from("internal_count_reports")
    .insert({
      user_id: input.userId,
      gmail_message_id: input.messageId,
      gmail_thread_id: input.threadId,
      kind: r.kind,
      parent_report_id: r.parentReportId,
      source: input.source,
      received_at: input.receivedAt,
      sent_at: input.sentAt,
      sender: input.sender,
      subject: input.subject,
      body_text: input.body,
      subject_date: r.subjectDate,
      sheet_date: r.sheetDate,
      pdf_filename: input.pdf?.filename ?? null,
      pdf_sha256: sha,
      storage_path: storagePath,
      status: r.status,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") throw new AlreadyRead(input.messageId);
    throw new Error(`internal_count_reports insert failed: ${error.message}`);
  }
  return data.id as string;
}

export async function insertReviewItems(
  sb: Db,
  reportId: string,
  userId: string,
  items: ReviewItemPlan[],
  blockIds: Map<number, string>,
): Promise<void> {
  if (items.length === 0) return;
  const { error } = await sb.from("internal_count_review_items").insert(
    items.map((i) => ({
      report_id: reportId,
      block_id: i.blockIndex === null ? null : (blockIds.get(i.blockIndex) ?? null),
      user_id: userId,
      kind: i.kind,
      holding: isHolding(i),
      show_name: i.showName,
      detail: i.detail,
    })),
  );
  if (error) throw new Error(`internal_count_review_items insert failed: ${error.message}`);
}

function blockRow(reportId: string, userId: string, b: BlockPlan) {
  const status = b.status === "write" || b.status === "held" ? "held" : b.status === "superseded" ? "replaced" : b.status;
  return {
    report_id: reportId,
    user_id: userId,
    block_index: b.index,
    show_name: b.showName,
    event_id: b.eventId,
    count_date: b.countDate,
    paid_tickets: b.paid,
    comp_tickets: b.comps,
    total_tickets: b.total,
    since_last_count: b.sinceLast,
    our_delta: b.ourDelta,
    paid_revenue_pence: b.paidRevenuePence,
    revenue_held: b.revenueHeld,
    parsed: b.parsed,
    status,
    updated_at: new Date().toISOString(),
  };
}

/** Names that already have an open "isn't matched" item: one item per name is enough. */
async function openUnmatchedNames(sb: Db): Promise<Set<string>> {
  const { data, error } = await sb
    .from("internal_count_review_items")
    .select("show_name")
    .eq("kind", "unmatched_show")
    .is("resolved_at", null);
  if (error) throw new Error(`internal_count_review_items read failed: ${error.message}`);
  return new Set(((data ?? []) as Array<{ show_name: string | null }>).map((r) => r.show_name ?? ""));
}

export async function persistCountBlocks(
  sb: Db,
  ctx: RunContext,
  reportId: string,
  userId: string,
  plan: ReportPlan,
  sentAt: string | null,
): Promise<number> {
  const blockIds = new Map<number, string>();
  if (plan.blocks.length) {
    const { data, error } = await sb
      .from("internal_count_blocks")
      .upsert(plan.blocks.map((b) => blockRow(reportId, userId, b)), { onConflict: "report_id,block_index" })
      .select("id,block_index");
    if (error) throw new Error(`internal_count_blocks upsert failed: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: string; block_index: number }>) blockIds.set(r.block_index, r.id);
  }
  const already = await openUnmatchedNames(sb);
  const items = plan.reviewItems.filter((i) => !(i.kind === "unmatched_show" && already.has(i.showName ?? "")));
  // An earlier email that arrives late: its own block is the one an Undo would bring back.
  for (const i of items) {
    if (i.kind === "replaced" && i.detail.previousIsThis && i.blockIndex !== null) i.detail.previousBlockId = blockIds.get(i.blockIndex) ?? null;
  }
  let written = 0;
  for (const b of plan.blocks) {
    if (b.status !== "write") continue;
    const event = ctx.eventsById.get(b.eventId!)!;
    const blockId = blockIds.get(b.index)!;
    await writeBlock(sb, { blockId, reportId, event, plan: b, countDate: b.countDate!, total: b.total });
    rememberCount(ctx, { eventId: event.id, countDate: b.countDate!, total: b.total, blockId, sentAt });
    written++;
  }
  await insertReviewItems(sb, reportId, userId, items, blockIds);
  return written;
}


/** Paid, non-blank cells go to tier_channel_sales; comps, unused tiers and blanks stay in `parsed`. */
export function cellRows(b: Pick<BlockPlan, "cells">) {
  return b.cells
    .filter((c) => !c.comp && !c.unused && c.tickets !== null)
    .map((c) => ({ outlet: c.outlet, tier_name: c.tierKey, tickets: c.tickets, revenue_pence: c.revenuePence }));
}

export async function writeBlock(
  sb: Db,
  w: {
    blockId: string;
    reportId: string;
    event: EventRef;
    plan: Pick<BlockPlan, "cells" | "paid" | "comps" | "total" | "showName" | "sinceLast" | "revenueHeld" | "paidRevenuePence">;
    countDate: string;
    total: number;
  },
): Promise<void> {
  if (!w.event.clientId) throw new Error(`${w.event.eventCode} has no client, so its outlets have nowhere to live.`);
  const b = w.plan;
  const { error } = await sb.rpc("write_internal_count_block", {
    p_block_id: w.blockId,
    p_event_id: w.event.id,
    p_client_id: w.event.clientId,
    p_user_id: w.event.userId,
    p_count_date: w.countDate,
    p_cells: cellRows(b),
    p_snapshot: {
      tickets_sold: b.paid,
      gross_revenue_cents: b.revenueHeld ? null : b.paidRevenuePence,
      raw_payload: {
        internal_count_report_id: w.reportId,
        internal_count_block_id: w.blockId,
        show_name: b.showName,
        comps: b.comps,
        total_including_comps: b.total,
        since_last_count: b.sinceLast,
        revenue_held: b.revenueHeld,
      },
    },
  });
  if (error) throw new Error(`write_internal_count_block failed for ${w.event.eventCode}: ${error.message}`);
}

/** A report that raced another run on the same message counts as already read. */
export async function processMessageSafely(
  sb: Db,
  ctx: RunContext,
  input: IncomingMessage,
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  try {
    return await processMessage(sb, ctx, input, opts);
  } catch (err) {
    if (err instanceof AlreadyRead) return result(input, opts.dryRun ?? false, { status: "already_read" });
    throw err;
  }
}
