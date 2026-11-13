/**
 * lib/internal-counts/message.ts
 *
 * Which emails are Internal Counts: M1b of
 * docs/design-record/2026-11-13-internal-counts-matching.html.
 *
 * `isInternalCountsMessage` is the one place the rule lives. An email is a
 * count when the sender's address is at electric-group.co.uk (that domain
 * exactly) and one of its PDFs reads as the counts sheet (pdf-read.ts). The
 * subject is no longer a gate: a reply, "Re: Internal Counts 16.10.26", and
 * a forward, "FW: Internals 11/09", are counts once their PDF reads as the sheet.
 *
 * Otherwise, from the domain:
 *   - a PDF with either sheet heading that won't parse: unreadable
 *     ("Couldn't read the {date} sheet")
 *   - a reply in a count's thread with no sheet: a note (M1)
 *   - a PDF and "count" or "internal" in the subject: a near miss
 *   - anything else: ignored silently
 * A sheet Matas forwards himself isn't a count (manual upload covers it).
 */

import type { PdfVerdict } from "./pdf-read.ts";

export const COUNT_DOMAIN = "electric-group.co.uk";
const PREFIXES = /^\s*(?:(?:re|fwd?|aw|sv)\s*:\s*)+/i;

/** The sender's address from a From header ("Name <a@b>" or "a@b"), lower-cased. */
export function senderAddress(from: string): string {
  const angled = from.match(/<([^<>\s]+@[^<>\s]+)>/);
  const bare = from.match(/[^\s<>"]+@[^\s<>"]+/);
  return (angled?.[1] ?? bare?.[0] ?? "").trim().toLowerCase();
}

export function isFromCountDomain(from: string): boolean {
  const address = senderAddress(from);
  const at = address.lastIndexOf("@");
  return at > 0 && address.slice(at + 1) === COUNT_DOMAIN;
}

/** The subject with every leading Re:/FW:/Fwd:/AW:/SV: taken off. */
export function stripPrefixes(subject: string): string {
  return subject.replace(PREFIXES, "").trim();
}

/** A forward: a Fw:/Fwd: anywhere in the leading prefixes. A forward never replaces a stored sheet. */
export function isForward(subject: string): boolean {
  const prefixes = subject.match(PREFIXES)?.[0] ?? "";
  return /\bfwd?\s*:/i.test(prefixes);
}

export interface MessageFacts {
  from: string;
  subject: string;
  /** One verdict per PDF in the email. */
  pdfVerdicts: PdfVerdict[];
}

export function isInternalCountsMessage(m: Pick<MessageFacts, "from" | "pdfVerdicts">): boolean {
  return isFromCountDomain(m.from) && m.pdfVerdicts.includes("sheet");
}

export type MessageKind = "count" | "unreadable" | "reply" | "near_miss" | "ignore";

/** M1b. `threadHasCount` is true when a count from the same Gmail thread is stored (or read earlier in the run). */
export function classifyMessage(m: MessageFacts, threadHasCount: boolean): MessageKind {
  if (!isFromCountDomain(m.from)) return "ignore";
  if (isInternalCountsMessage(m)) return "count";
  if (m.pdfVerdicts.includes("unreadable")) return "unreadable";
  if (threadHasCount) return "reply";
  if (m.pdfVerdicts.length > 0 && /count|internal/i.test(m.subject)) return "near_miss";
  return "ignore";
}

const iso = (year: number, month: number, day: number): string | null =>
  month < 1 || month > 12 || day < 1 || day > 31
    ? null
    : `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/**
 * The subject's date, for M2's cross-check only. Leading prefixes are taken
 * off first. Always day first: dd.mm.yy, dd.mm.yyyy, dd/mm/yy, and dd.mm or
 * dd/mm with the year from the PDF ("Internals 18.09" = 18 Sep). Null when
 * the subject has no date (or no year to give a dd.mm).
 */
export function subjectCountDate(subject: string, pdfYear?: number | null): string | null {
  const s = stripPrefixes(subject);
  const full = s.match(/(?:^|[^\d])(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?![\d./-])/);
  if (full) {
    const year = full[3].length === 2 ? 2000 + Number(full[3]) : Number(full[3]);
    return iso(year, Number(full[2]), Number(full[1]));
  }
  const short = s.match(/(?:^|[^\d])(\d{1,2})[./](\d{1,2})(?![\d./])/);
  if (short && pdfYear) return iso(pdfYear, Number(short[2]), Number(short[1]));
  return null;
}
