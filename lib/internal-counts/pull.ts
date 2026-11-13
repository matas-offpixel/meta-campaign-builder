/**
 * lib/internal-counts/pull.ts
 *
 * Gmail → Internal Counts. The cron runs it hourly on UK weekdays with
 * `newer_than:3d`; the backfill runs it over the whole history. Messages
 * are read oldest first, so a count is stored before the replies in its
 * thread, and each count's SINCE LAST COUNT is checked against the one
 * before it.
 *
 * The Gmail query narrows to the domain and a PDF; classifyMessage (M1)
 * decides the rest, in code. Replies without a PDF are fetched by thread.
 */

import { summarise, type GmailClient, type MessageSummary } from "../gmail/client.ts";
import type { Db, RunContext } from "./context.ts";
import { classifyMessage, isForward, isFromCountDomain, type MessageKind } from "./message.ts";
import { chooseSheet, readPdf, type ReadPdf } from "./pdf-read.ts";
import type { PriceFlag } from "./checks.ts";
import { processMessageSafely, type ProcessOptions, type ProcessResult } from "./store.ts";

export const PULL_QUERY = "from:electric-group.co.uk has:attachment filename:pdf newer_than:3d";
export const BACKFILL_QUERY = "from:electric-group.co.uk has:attachment filename:pdf";

/** Where messages come from: Gmail, or a local export for an offline dry run. */
export interface MessageSource {
  list(): Promise<MessageSummary[]>;
  /** The bytes of one of the message's PDFs. */
  pdf(message: MessageSummary, index: number): Promise<Uint8Array | null>;
}

/** The query's messages, plus every other message in their threads (replies often carry no PDF). */
export function gmailSource(gmail: GmailClient, query: string): MessageSource {
  return {
    async list() {
      const out = new Map<string, MessageSummary>();
      for (const id of await gmail.listMessageIds(query)) {
        const m = summarise(await gmail.message(id));
        out.set(m.id, m);
      }
      const threads = new Set([...out.values()].map((m) => m.threadId).filter((t): t is string => !!t));
      for (const threadId of threads) {
        for (const m of await gmail.thread(threadId)) if (!out.has(m.id)) out.set(m.id, summarise(m));
      }
      return [...out.values()];
    },
    async pdf(m, index) {
      const p = m.pdfs[index];
      return p ? gmail.attachment(m.id, p.attachmentId) : null;
    },
  };
}

export interface PullOptions extends ProcessOptions {
  userId: string;
  /** Only messages received on or after this ISO date. */
  since?: string;
  onMessage?: (line: PullLine) => void;
}

export interface PullLine {
  messageId: string;
  receivedAt: string;
  subject: string;
  from: string;
  kind: MessageKind;
  result?: ProcessResult;
}

/** One row per sheet/show/tier where "price equals the column's count" fired (the add-on's false-positive watch). */
export interface PriceFiring {
  receivedAt: string;
  subject: string;
  countDate: string | null;
  showName: string;
  tierName: string;
  pricePence: number;
  count: number | null;
  /** Every other check on that show passed (a likely false positive). */
  otherwiseClean: boolean;
}

export interface PullSummary {
  found: number;
  counts: number;
  /** Counts whose PDF (sha256) another email already carried: one count. */
  duplicates: number;
  replies: number;
  nearMisses: number;
  ignored: number;
  alreadyRead: number;
  unreadable: number;
  blocksWritten: number;
  blocksHeld: number;
  reviewItems: number;
  reviewByKind: Record<string, number>;
  priceFirings: PriceFiring[];
  lines: PullLine[];
}

export function emptySummary(): PullSummary {
  return {
    found: 0,
    counts: 0,
    duplicates: 0,
    replies: 0,
    nearMisses: 0,
    ignored: 0,
    alreadyRead: 0,
    unreadable: 0,
    blocksWritten: 0,
    blocksHeld: 0,
    reviewItems: 0,
    reviewByKind: {},
    priceFirings: [],
    lines: [],
  };
}

function tally(summary: PullSummary, line: PullLine): void {
  summary.lines.push(line);
  const r = line.result;
  if (line.kind === "ignore") summary.ignored++;
  if (r?.status === "already_read") {
    summary.alreadyRead++;
    return;
  }
  if (r?.status === "duplicate") summary.duplicates++;
  else if (line.kind === "count" || line.kind === "unreadable") summary.counts++;
  if (line.kind === "reply") summary.replies++;
  if (line.kind === "near_miss") summary.nearMisses++;
  if (!r) return;
  if (r.status === "unreadable") summary.unreadable++;
  summary.blocksWritten += r.blocksWritten;
  summary.blocksHeld += r.blocksHeld;
  summary.reviewItems += r.reviewItems.length;
  for (const i of r.reviewItems) summary.reviewByKind[i.kind] = (summary.reviewByKind[i.kind] ?? 0) + 1;
  for (const b of r.plan?.blocks ?? []) {
    // The sheet's own checks only (sums, the date, revenue arithmetic); an unmatched name isn't a sheet error.
    const holds =
      r.plan!.reviewItems.some((i) => (i.blockIndex === b.index && i.kind === "sum_mismatch") || i.kind === "date_mismatch") ||
      ((r.plan!.reviewItems.find((i) => i.blockIndex === b.index && i.kind === "price_looks_wrong")?.detail.revenueMismatch as string[] | undefined)?.length ?? 0) > 0;
    for (const f of b.priceFlags.filter((x: PriceFlag) => x.reason === "equals_count")) {
      summary.priceFirings.push({
        receivedAt: line.receivedAt,
        subject: line.subject,
        countDate: b.countDate,
        showName: b.showName,
        tierName: f.tierName,
        pricePence: f.pricePence,
        count: f.count,
        otherwiseClean: !holds,
      });
    }
  }
}

export async function runInternalCountsPull(
  sb: Db,
  ctx: RunContext,
  source: MessageSource,
  opts: PullOptions,
): Promise<PullSummary> {
  const summary = emptySummary();
  const messages = (await source.list()).filter((m) => !opts.since || m.receivedAt >= opts.since);
  summary.found = messages.length;
  // "Later" is the Date header, not fetch order (M1b).
  messages.sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id));
  for (const m of messages) {
    const read = isFromCountDomain(m.from) ? await readAll(source, m) : [];
    const threadHasCount = !!m.threadId && ctx.countThreads.has(m.threadId);
    const kind = classifyMessage({ subject: m.subject, from: m.from, pdfVerdicts: read.map((p) => p.verdict) }, threadHasCount);
    const line: PullLine = { messageId: m.id, receivedAt: m.receivedAt, subject: m.subject, from: m.from, kind };
    if (kind !== "ignore") {
      const pdf = kind === "count" || kind === "unreadable" ? chooseSheet(read) : kind === "near_miss" ? (read[0] ?? null) : null;
      line.result = await processMessageSafely(
        sb,
        ctx,
        {
          userId: opts.userId,
          source: "gmail",
          kind,
          messageId: m.id,
          threadId: m.threadId,
          receivedAt: m.receivedAt,
          sentAt: m.sentAt,
          sender: m.from,
          subject: m.subject,
          body: m.body,
          forward: isForward(m.subject),
          pdf,
        },
        { dryRun: opts.dryRun, confirmedAliases: opts.confirmedAliases },
      );
    }
    tally(summary, line);
    opts.onMessage?.(line);
  }
  return summary;
}

/** Every PDF in the message, each read on its own (M1b). */
async function readAll(source: MessageSource, m: MessageSummary): Promise<ReadPdf[]> {
  const out: ReadPdf[] = [];
  for (let i = 0; i < m.pdfs.length; i++) {
    const bytes = await source.pdf(m, i);
    if (bytes) out.push(await readPdf(m.pdfs[i].filename, bytes));
  }
  return out;
}

/** 09:00–19:59 Europe/London, Monday to Friday. */
export function withinPullHours(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  return !["Sat", "Sun"].includes(weekday) && hour >= 9 && hour <= 19;
}
