/**
 * lib/internal-counts/message.ts
 *
 * Which emails are Internal Counts (M1 of
 * docs/design-record/2026-11-13-internal-counts-matching.html), and the
 * dates in their subjects (M2).
 *
 * `isInternalCountsMessage` is the one place the matching rule lives. An
 * email is a count when all four hold:
 *   - the sender's address is at electric-group.co.uk (exactly; no subdomain)
 *   - it carries a PDF attachment
 *   - its subject doesn't start with a reply or forward prefix
 *   - its subject matches the Internal Counts pattern
 *
 * Anything else from the domain is a reply in a count's thread (stored as a
 * note), a near miss (a PDF and "count" in the subject), or not ours.
 */

export const COUNT_DOMAIN = "electric-group.co.uk";
const PREFIX = /^\s*(re|fwd?|aw|sv)\s*:/i;
const PATTERN = /^\s*internal\s+(shows?\s+)?(\(?ticket\)?\s+)?counts?\b/i;

export interface MessageHeaders {
  subject: string;
  from: string;
  hasPdf: boolean;
}

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

export function isInternalCountsMessage(m: MessageHeaders): boolean {
  return isFromCountDomain(m.from) && m.hasPdf && !PREFIX.test(m.subject) && PATTERN.test(m.subject);
}

export type MessageKind = "count" | "reply" | "near_miss" | "ignore";

/**
 * M1. `threadHasCount` is true when a count from the same Gmail thread is
 * already stored (or read earlier in the same run).
 */
export function classifyMessage(m: MessageHeaders, threadHasCount: boolean): MessageKind {
  if (isInternalCountsMessage(m)) return "count";
  if (!isFromCountDomain(m.from)) return "ignore";
  if (threadHasCount) return "reply";
  if (m.hasPdf && /count/i.test(m.subject)) return "near_miss";
  return "ignore";
}

/** M2: the subject's dd.mm.yy (or dd.mm.yyyy), always day first, as yyyy-mm-dd; else null. */
export function subjectCountDate(subject: string): string | null {
  const m = subject.match(/(?:^|[^\d])(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const QUOTE_START = /^(>|_{5,}|From:\s|On .+wrote:\s*$|-{2,}\s*Original Message|Sent:\s)/im;

/** The sender's own words: the body up to the first quoted reply. */
export function newPartOfBody(body: string): string {
  const m = body.match(QUOTE_START);
  return (m && m.index !== undefined ? body.slice(0, m.index) : body).trim();
}
