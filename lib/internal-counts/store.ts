/**
 * lib/internal-counts/store.ts
 *
 * Reads, plans and writes one Internal Counts email (D8, HD1). Shared by
 * the cron, the "Upload count PDF" backstop, the review-list rerun and the
 * backfill script, so all four run the same parser and the same checks.
 *
 * - Idempotent on the Gmail message id: a message already in
 *   internal_count_reports writes 0 rows.
 * - A block writes through write_internal_count_block (migration 234), one
 *   transaction: every row it implies, or none.
 * - A dry run reads only. It keeps what it would have written in `memory`
 *   so a chronological backfill can still cross-check SINCE LAST COUNT.
 *
 * Relative imports only (the node --test runner can't resolve `@/`); the
 * PDF library is loaded lazily inside pdf-text.ts.
 */

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { pageAll } from "../db/paged-read.ts";
import { CONFIRMED_COUNT_ALIASES, matchShow } from "./aliases.ts";
import { extractPdfTextItems } from "./pdf-text.ts";
import { parseInternalCountsItems, type ParsedSheet } from "./parse.ts";
import { BLOCKING_KINDS, planReport, type BlockPlan, type EventRef, type ReportPlan, type ReviewItemPlan } from "./plan.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const INTERNAL_COUNTS_BUCKET = "internal-counts";

export interface IncomingReport {
  userId: string;
  source: "gmail" | "upload";
  /** Gmail message id, or upload:{pdf sha256}. */
  messageId: string;
  receivedAt: string;
  sender: string | null;
  subject: string;
  body: string;
  pdf: { filename: string; bytes: Uint8Array } | null;
}

export interface StoredCount {
  eventId: string;
  countDate: string;
  total: number;
}

/** What a dry run would have written, so later messages in the same run see it. */
export interface DryRunMemory {
  counts: StoredCount[];
}

export interface ProcessOptions {
  dryRun?: boolean;
  confirmedAliases?: Readonly<Record<string, string>>;
  memory?: DryRunMemory;
  /**
   * Dry run only: plan without reading the database (no stored counts, no
   * events; aliases resolve to placeholder events). For the backfill before
   * migration 234 is applied. Combine with memory for the SINCE LAST check.
   */
  offline?: boolean;
}

export interface ProcessResult {
  messageId: string;
  status: "already_read" | "processed" | "unreadable";
  dryRun: boolean;
  blocksWritten: number;
  blocksInReview: number;
  plan: ReportPlan | null;
}

export function pdfSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function parsePdf(bytes: Uint8Array): Promise<ParsedSheet | null> {
  try {
    return parseInternalCountsItems(await extractPdfTextItems(bytes));
  } catch {
    return null;
  }
}

export async function isAlreadyRead(sb: Db, messageId: string): Promise<boolean> {
  const { data, error } = await sb
    .from("internal_count_reports")
    .select("id")
    .eq("gmail_message_id", messageId)
    .maybeSingle();
  if (error) throw new Error(`internal_count_reports read failed: ${error.message}`);
  return data !== null;
}

async function loadEvents(sb: Db, sheet: ParsedSheet | null, aliases: Readonly<Record<string, string>>) {
  const codes = [
    ...new Set(
      (sheet?.blocks ?? []).map((b) => matchShow(b.showName, aliases).eventCode).filter((c): c is string => !!c),
    ),
  ];
  const byCode = new Map<string, EventRef>();
  if (codes.length === 0) return byCode;
  const { data, error } = await sb.from("events").select("id,event_code,user_id,client_id").in("event_code", codes);
  if (error) throw new Error(`events read failed: ${error.message}`);
  for (const e of (data ?? []) as Array<{ id: string; event_code: string; user_id: string; client_id: string | null }>) {
    byCode.set(e.event_code, { id: e.id, eventCode: e.event_code, userId: e.user_id, clientId: e.client_id });
  }
  return byCode;
}

async function loadStoredCounts(sb: Db, eventIds: string[], excludeReportId?: string): Promise<StoredCount[]> {
  if (eventIds.length === 0) return [];
  const rows = await pageAll<{ id: string; event_id: string; count_date: string; total_tickets: number; report_id: string }>(
    (from, to) =>
      sb
        .from("internal_count_blocks")
        .select("id,event_id,count_date,total_tickets,report_id")
        .in("event_id", eventIds)
        .eq("status", "written")
        .order("id", { ascending: true })
        .range(from, to),
    ["id"],
    "internal_count_blocks",
  );
  return rows
    .filter((r) => r.report_id !== excludeReportId)
    .map((r) => ({ eventId: r.event_id, countDate: r.count_date, total: r.total_tickets }));
}

function contextFrom(events: Map<string, EventRef>, counts: StoredCount[], aliases: Readonly<Record<string, string>>) {
  return {
    eventsByCode: events,
    confirmedAliases: aliases,
    previousTotal: (eventId: string, countDate: string) => {
      const before = counts
        .filter((c) => c.eventId === eventId && c.countDate < countDate)
        .sort((a, b) => b.countDate.localeCompare(a.countDate));
      return before[0]?.total ?? null;
    },
    storedTotalOn: (eventId: string, countDate: string) =>
      counts.find((c) => c.eventId === eventId && c.countDate === countDate)?.total ?? null,
  };
}

export async function planFor(
  sb: Db,
  input: Pick<IncomingReport, "subject" | "body">,
  sheet: ParsedSheet | null,
  opts: ProcessOptions & { excludeReportId?: string } = {},
): Promise<{ plan: ReportPlan; events: Map<string, EventRef> }> {
  const aliases = opts.confirmedAliases ?? CONFIRMED_COUNT_ALIASES;
  const events = await loadEvents(sb, sheet, aliases);
  const stored = await loadStoredCounts(
    sb,
    [...events.values()].map((e) => e.id),
    opts.excludeReportId,
  );
  const counts = [...stored, ...(opts.memory?.counts ?? [])];
  return { plan: planReport(input, sheet, contextFrom(events, counts, aliases)), events };
}

function offlinePlan(
  input: Pick<IncomingReport, "subject" | "body">,
  sheet: ParsedSheet | null,
  opts: ProcessOptions,
): { plan: ReportPlan; events: Map<string, EventRef> } {
  const aliases = opts.confirmedAliases ?? CONFIRMED_COUNT_ALIASES;
  const events = new Map<string, EventRef>(
    Object.values(aliases).map((code) => [code, { id: `offline:${code}`, eventCode: code, userId: "offline", clientId: "offline" }]),
  );
  return { plan: planReport(input, sheet, contextFrom(events, opts.memory?.counts ?? [], aliases)), events };
}

function mostCommon(values: Array<string | null>): string | null {
  const tally = new Map<string, number>();
  for (const v of values) if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export async function processReport(sb: Db, input: IncomingReport, opts: ProcessOptions = {}): Promise<ProcessResult> {
  const dryRun = opts.dryRun ?? false;
  if (opts.offline && !dryRun) throw new Error("offline is for dry runs only");
  const base = { messageId: input.messageId, dryRun };
  if (!opts.offline && (await isAlreadyRead(sb, input.messageId))) {
    return { ...base, status: "already_read", blocksWritten: 0, blocksInReview: 0, plan: null };
  }
  const sheet = input.pdf ? await parsePdf(input.pdf.bytes) : null;
  const { plan, events } = opts.offline ? offlinePlan(input, sheet, opts) : await planFor(sb, input, sheet, opts);
  const status = plan.blocks.length ? "processed" : "unreadable";
  const writable = plan.blocks.filter((b) => b.write);
  const inReview = plan.blocks.filter((b) => !b.write && !b.repeat).length;
  if (dryRun) {
    opts.memory?.counts.push(
      ...writable.map((b) => ({ eventId: b.eventId!, countDate: b.countDate!, total: b.total })),
    );
    return { ...base, status, blocksWritten: writable.length, blocksInReview: inReview, plan };
  }

  const sha = input.pdf ? pdfSha256(input.pdf.bytes) : null;
  const storagePath = input.pdf ? await storePdf(sb, input, sha!) : null;
  const { data: report, error } = await sb
    .from("internal_count_reports")
    .insert({
      user_id: input.userId,
      gmail_message_id: input.messageId,
      source: input.source,
      received_at: input.receivedAt,
      sender: input.sender,
      subject: input.subject,
      body_text: input.body,
      subject_date: plan.subjectDate,
      count_date: mostCommon(plan.blocks.map((b) => b.countDate)),
      pdf_filename: input.pdf?.filename ?? null,
      pdf_sha256: sha,
      storage_path: storagePath,
      status,
    })
    .select("id")
    .single();
  if (error) {
    // Another run took the same message between the check and the insert.
    if (error.code === "23505") {
      return { ...base, status: "already_read", blocksWritten: 0, blocksInReview: 0, plan: null };
    }
    throw new Error(`internal_count_reports insert failed: ${error.message}`);
  }
  const written = await persistBlocks(sb, report.id as string, input.userId, plan, events);
  return { ...base, status, blocksWritten: written, blocksInReview: inReview, plan };
}

async function storePdf(sb: Db, input: IncomingReport, sha: string): Promise<string> {
  const day = input.receivedAt.slice(0, 10);
  const safeId = input.messageId.replace(/[^A-Za-z0-9_-]/g, "_");
  const path = `${day}/${safeId}-${sha.slice(0, 12)}.pdf`;
  const { error } = await sb.storage
    .from(INTERNAL_COUNTS_BUCKET)
    .upload(path, input.pdf!.bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`internal-counts upload failed: ${error.message}`);
  return path;
}

async function insertReviewItems(sb: Db, reportId: string, userId: string, items: ReviewItemPlan[], blockIds: Map<number, string>) {
  if (items.length === 0) return;
  const { error } = await sb.from("internal_count_review_items").insert(
    items.map((i) => ({
      report_id: reportId,
      block_id: i.blockIndex === null ? null : (blockIds.get(i.blockIndex) ?? null),
      user_id: userId,
      kind: i.kind,
      blocking: BLOCKING_KINDS.has(i.kind),
      show_name: i.showName,
      message: i.message,
      detail: i.detail,
    })),
  );
  if (error) throw new Error(`internal_count_review_items insert failed: ${error.message}`);
}

function blockRow(reportId: string, userId: string, b: BlockPlan) {
  return {
    report_id: reportId,
    user_id: userId,
    block_index: b.index,
    show_name: b.showName,
    event_id: b.eventId,
    proposed_event_code: b.proposedEventCode,
    count_date: b.countDate,
    paid_tickets: b.paid,
    comp_tickets: b.comps,
    total_tickets: b.total,
    since_last_count: b.sinceLast,
    our_delta: b.ourDelta,
    revenue_withheld: b.revenueWithheld,
    paid_revenue_pence: b.paidRevenuePence,
    parsed: b.parsed,
    status: b.repeat ? "repeat" : "review",
    updated_at: new Date().toISOString(),
  };
}

async function persistBlocks(
  sb: Db,
  reportId: string,
  userId: string,
  plan: ReportPlan,
  events: Map<string, EventRef>,
): Promise<number> {
  const blockIds = new Map<number, string>();
  if (plan.blocks.length) {
    const { data, error } = await sb
      .from("internal_count_blocks")
      .upsert(
        plan.blocks.map((b) => blockRow(reportId, userId, b)),
        { onConflict: "report_id,block_index" },
      )
      .select("id,block_index");
    if (error) throw new Error(`internal_count_blocks upsert failed: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: string; block_index: number }>) blockIds.set(r.block_index, r.id);
  }
  await insertReviewItems(sb, reportId, userId, plan.reviewItems, blockIds);
  let written = 0;
  for (const b of plan.blocks) {
    if (!b.write) continue;
    const event = [...events.values()].find((e) => e.id === b.eventId)!;
    await writeBlock(sb, blockIds.get(b.index)!, reportId, event, b);
    written++;
  }
  return written;
}

/** Paid, non-blank cells go to tier_channel_sales; comps and blanks stay in `parsed`. */
export function cellRows(b: BlockPlan) {
  return b.cells
    .filter((c) => !c.comp && c.tickets !== null)
    .map((c) => ({ outlet: c.outlet, tier_name: c.tierKey, tickets: c.tickets, revenue_pence: c.revenuePence }));
}

async function writeBlock(sb: Db, blockId: string, reportId: string, event: EventRef, b: BlockPlan) {
  if (!event.clientId) throw new Error(`${event.eventCode} has no client, so its outlets have nowhere to live.`);
  const { error } = await sb.rpc("write_internal_count_block", {
    p_block_id: blockId,
    p_event_id: event.id,
    p_client_id: event.clientId,
    p_user_id: event.userId,
    p_count_date: b.countDate,
    p_cells: cellRows(b),
    p_snapshot: {
      tickets_sold: b.paid,
      gross_revenue_cents: b.paidRevenuePence,
      raw_payload: {
        internal_count_report_id: reportId,
        internal_count_block_id: blockId,
        show_name: b.showName,
        comps: b.comps,
        total_including_comps: b.total,
        since_last_count: b.sinceLast,
        revenue_withheld: b.revenueWithheld,
      },
    },
  });
  if (error) throw new Error(`write_internal_count_block failed for ${event.eventCode}: ${error.message}`);
}

/**
 * Re-run a stored report (after an alias is confirmed, say). Written blocks
 * are left alone; a block in review is re-planned and written if it now
 * passes, and its open review items are replaced by the new plan's.
 */
export async function rerunReport(
  sb: Db,
  reportId: string,
  opts: Pick<ProcessOptions, "confirmedAliases"> = {},
): Promise<{ blocksWritten: number; blocksInReview: number }> {
  const { data: report, error } = await sb
    .from("internal_count_reports")
    .select("id,user_id,subject,body_text,storage_path")
    .eq("id", reportId)
    .single();
  if (error) throw new Error(`internal_count_reports read failed: ${error.message}`);
  const bytes = report.storage_path ? await downloadPdf(sb, report.storage_path as string) : null;
  const sheet = bytes ? await parsePdf(bytes) : null;
  const { plan, events } = await planFor(sb, { subject: report.subject, body: report.body_text }, sheet, {
    ...opts,
    excludeReportId: reportId,
  });
  const { data: existing, error: bErr } = await sb
    .from("internal_count_blocks")
    .select("id,block_index,status")
    .eq("report_id", reportId);
  if (bErr) throw new Error(`internal_count_blocks read failed: ${bErr.message}`);
  const done = new Set(
    ((existing ?? []) as Array<{ block_index: number; status: string }>)
      .filter((b) => b.status === "written")
      .map((b) => b.block_index),
  );
  const todo: ReportPlan = {
    subjectDate: plan.subjectDate,
    blocks: plan.blocks.filter((b) => !done.has(b.index)),
    reviewItems: plan.reviewItems.filter((i) => i.blockIndex !== null && !done.has(i.blockIndex)),
  };
  const { error: dErr } = await sb
    .from("internal_count_review_items")
    .delete()
    .eq("report_id", reportId)
    .is("resolved_at", null)
    .not("block_id", "is", null)
    .in(
      "block_id",
      ((existing ?? []) as Array<{ id: string; block_index: number }>)
        .filter((b) => !done.has(b.block_index))
        .map((b) => b.id),
    );
  if (dErr) throw new Error(`internal_count_review_items clear failed: ${dErr.message}`);
  const written = await persistBlocks(sb, reportId, report.user_id as string, todo, events);
  return { blocksWritten: written, blocksInReview: todo.blocks.filter((b) => !b.write && !b.repeat).length };
}

async function downloadPdf(sb: Db, path: string): Promise<Uint8Array | null> {
  const { data, error } = await sb.storage.from(INTERNAL_COUNTS_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}
