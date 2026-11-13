/**
 * lib/internal-counts/pull.ts
 *
 * Gmail → Internal Counts. The cron runs it hourly on UK weekdays with
 * `newer_than:3d`; the backfill runs it over the whole history. Messages
 * are read oldest first, so each count's SINCE LAST COUNT is cross-checked
 * against the count before it.
 *
 * The Gmail query narrows to the sender and a PDF; isInternalCountsMessage
 * decides the rest, in code.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { summarise, type GmailClient, type MessageSummary } from "../gmail/client.ts";
import { isInternalCountsMessage } from "./message.ts";
import { isAlreadyRead, processReport, type DryRunMemory, type ProcessResult } from "./store.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const PULL_QUERY = "from:electric-group.co.uk has:attachment filename:pdf newer_than:3d";
export const BACKFILL_QUERY = "from:electric-group.co.uk has:attachment filename:pdf";

/** Where messages come from: Gmail, or a local export for an offline dry run. */
export interface MessageSource {
  list(): Promise<MessageSummary[]>;
  pdf(message: MessageSummary): Promise<Uint8Array | null>;
}

export function gmailSource(gmail: GmailClient, query: string): MessageSource {
  return {
    async list() {
      const out: MessageSummary[] = [];
      for (const id of await gmail.listMessageIds(query)) out.push(summarise(await gmail.message(id)));
      return out;
    },
    async pdf(m) {
      const first = m.pdfs[0];
      return first ? gmail.attachment(m.id, first.attachmentId) : null;
    },
  };
}

export interface PullOptions {
  userId: string;
  /** Only messages received on or after this ISO date. */
  since?: string;
  dryRun?: boolean;
  confirmedAliases?: Readonly<Record<string, string>>;
  memory?: DryRunMemory;
  /** Dry run without reading the database (before migration 234 is applied). */
  offline?: boolean;
  /** Called after each message, for the backfill's progress lines. */
  onMessage?: (line: PullLine) => void;
}

export interface PullLine {
  messageId: string;
  receivedAt: string;
  subject: string;
  outcome: "not_internal_counts" | "already_read" | "no_pdf" | "processed" | "unreadable";
  result?: ProcessResult;
}

export interface PullSummary {
  found: number;
  matched: number;
  skippedSubjects: string[];
  alreadyRead: number;
  processed: number;
  unreadable: number;
  blocksWritten: number;
  blocksInReview: number;
  reviewItems: number;
  reviewByKind: Record<string, number>;
  lines: PullLine[];
}

export function emptySummary(): PullSummary {
  return {
    found: 0,
    matched: 0,
    skippedSubjects: [],
    alreadyRead: 0,
    processed: 0,
    unreadable: 0,
    blocksWritten: 0,
    blocksInReview: 0,
    reviewItems: 0,
    reviewByKind: {},
    lines: [],
  };
}

function tally(summary: PullSummary, line: PullLine): void {
  summary.lines.push(line);
  const r = line.result;
  if (line.outcome === "not_internal_counts") summary.skippedSubjects.push(line.subject);
  if (line.outcome === "already_read") summary.alreadyRead++;
  if (line.outcome === "processed") summary.processed++;
  if (line.outcome === "unreadable" || line.outcome === "no_pdf") summary.unreadable++;
  if (!r?.plan) return;
  summary.blocksWritten += r.blocksWritten;
  summary.blocksInReview += r.blocksInReview;
  summary.reviewItems += r.plan.reviewItems.length;
  for (const i of r.plan.reviewItems) summary.reviewByKind[i.kind] = (summary.reviewByKind[i.kind] ?? 0) + 1;
}

export async function runInternalCountsPull(sb: Db, source: MessageSource, opts: PullOptions): Promise<PullSummary> {
  const summary = emptySummary();
  const messages = (await source.list()).filter((m) => !opts.since || m.receivedAt >= opts.since);
  summary.found = messages.length;
  messages.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
  for (const m of messages) {
    const base = { messageId: m.id, receivedAt: m.receivedAt, subject: m.subject };
    let line: PullLine;
    if (!isInternalCountsMessage({ subject: m.subject, from: m.from })) {
      line = { ...base, outcome: "not_internal_counts" };
    } else if (!opts.dryRun && (await isAlreadyRead(sb, m.id))) {
      summary.matched++;
      line = { ...base, outcome: "already_read" };
    } else {
      summary.matched++;
      const pdf = m.pdfs[0];
      const bytes = pdf ? await source.pdf(m) : null;
      const result = await processReport(
        sb,
        {
          userId: opts.userId,
          source: "gmail",
          messageId: m.id,
          receivedAt: m.receivedAt,
          sender: m.from,
          subject: m.subject,
          body: m.body,
          pdf: pdf && bytes ? { filename: pdf.filename, bytes } : null,
        },
        { dryRun: opts.dryRun, confirmedAliases: opts.confirmedAliases, memory: opts.memory, offline: opts.offline },
      );
      const outcome = !pdf ? "no_pdf" : result.status === "processed" ? "processed" : result.status === "already_read" ? "already_read" : "unreadable";
      line = { ...base, outcome, result };
    }
    tally(summary, line);
    opts.onMessage?.(line);
  }
  return summary;
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
