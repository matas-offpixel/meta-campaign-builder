/**
 * lib/internal-counts/message.ts
 *
 * Which emails are Internal Counts, and what their subject and body say.
 *
 * `isInternalCountsMessage` is the one place the matching rule lives. A D8
 * re-ruling on email matching is with the design thread; when it lands,
 * change only this function and its test.
 *
 * Proposed rule (the brief's): the subject starts with "Internal Counts",
 * "Internal Show counts", "Internal Show ticket counts" or "Internal ticket
 * counts" (any case), with no Re:/Fw: prefix. The Gmail query has already
 * narrowed to from:electric-group.co.uk with a PDF attached.
 */

const SUBJECT_RULE = /^\s*internal\s+(show\s+)?(ticket\s+)?counts?\b/i;

export interface MessageHeaders {
  subject: string;
  from: string;
}

export function isInternalCountsMessage(message: MessageHeaders): boolean {
  return SUBJECT_RULE.test(message.subject);
}

/** The subject's dd.mm.yy (or dd.mm.yyyy) as yyyy-mm-dd, else null. */
export function subjectCountDate(subject: string): string | null {
  const m = subject.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const QUOTE_START = /^(>|From:\s|On .+wrote:\s*$|-{2,}\s*Original Message|Sent:\s)/im;

/** The sender's own words: the body up to the first quoted reply. */
export function newPartOfBody(body: string): string {
  const m = body.match(QUOTE_START);
  return (m && m.index !== undefined ? body.slice(0, m.index) : body).trim();
}

/**
 * True when the email's own words talk about sales ("tickets", "sold",
 * "total"). Such a body adds the review item "Email mentions sales not in
 * the sheet". It's never parsed into counts.
 */
export function bodyMentionsSales(body: string): boolean {
  return /\b(tickets|sold|total)\b/i.test(newPartOfBody(body));
}
