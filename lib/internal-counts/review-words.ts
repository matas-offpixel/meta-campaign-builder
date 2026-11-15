/**
 * lib/internal-counts/review-words.ts
 *
 * R1 of docs/design-record/2026-11-13-internal-counts-matching.html: the
 * review list's words, at 1280 and at 393, with R1a's rulings. Every
 * string here is R1's or R1a's, filled with the item's facts, except those
 * marked NOT RULED, which wait on design.
 *
 * Show names are shown exactly as stored ("IPC", "ENZO SIRAGUSA"), never
 * re-cased. Our own figures get thousands separators (1,887); quoted email
 * text stays as written ("1974"). Dates and times keep together at 393:
 * their spaces are non-breaking.
 */

import type { PriceFlag } from "./checks.ts";
import type { ActionView, CheckedItemView, ReviewItemView, SourceView } from "./view-types.ts";

const LONDON = "Europe/London";
/** A non-breaking space: "12 Nov 11:33" never splits (#620). */
export const NBSP = "\u00a0";

/** London calendar date of an ISO instant or date, yyyy-mm-dd. */
function londonDay(iso: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString("en-CA", { timeZone: LONDON });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Oct", three-letter months always (en-GB would write "Sept"). */
export function dayMonth(iso: string): string {
  const [, m, d] = londonDay(iso).split("-").map(Number);
  return `${d}${NBSP}${MONTHS[m - 1]}`;
}

export function hourMinute(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: LONDON });
}

export function dayMonthTime(iso: string): string {
  return `${dayMonth(iso)}${NBSP}${hourMinute(iso)}`;
}

/** R1a's {time}: "14:05" today, else "Thu 13 Nov, 14:05". */
export function lastReadTime(iso: string, now = new Date()): string {
  if (londonDay(iso) === londonDay(now.toISOString())) return hourMinute(iso);
  const weekday = new Date(iso).toLocaleDateString("en-GB", { weekday: "short", timeZone: LONDON });
  return `${weekday}${NBSP}${dayMonth(iso)},${NBSP}${hourMinute(iso)}`;
}

/** Our own figures: 1,887. */
export const figure = (n: unknown) => Number(n).toLocaleString("en-GB");

const pounds = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const OUTLET_NAMES: Record<string, string> = {
  SKIDDLE: "Skiddle",
  UNIVERSE: "Universe",
  FATSOMA: "Fatsoma",
  DICE: "DICE",
  SEE: "SEE",
  GIGANTIC: "Gigantic",
  RA: "RA",
  FIXR: "Fixr",
};


export interface ItemFacts {
  id: string;
  kind: string;
  showName: string | null;
  /** The event's name when the show is matched. */
  eventName: string | null;
  detail: Record<string, unknown>;
  report: {
    subject: string;
    sender: string | null;
    receivedAt: string;
    sheetDate: string | null;
    subjectDate: string | null;
    gmailMessageId: string;
    pdfFilename: string | null;
    /** The email's stored body, for a forward's "first sent" date. */
    body?: string | null;
  };
  inbox: string | null;
}

export function gmailUrl(messageId: string, inbox: string | null): string {
  return `https://mail.google.com/mail/${inbox ? `?authuser=${encodeURIComponent(inbox)}` : ""}#all/${messageId}`;
}

/** The sender's name as the email gives it ("Alex Mercer"); never a full address. */
export function senderName(from: string | null): string {
  const named = (from ?? "").match(/^\s*"?([^"<]+?)"?\s*</);
  if (named?.[1]?.trim()) return named[1].trim().replace(/\s+/g, " ");
  const local = (from ?? "").match(/([^\s<>"@]+)@/)?.[1] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
}

const FORWARD = /^\s*(?:(?:re|fwd?|aw|sv)\s*:\s*)*fwd?\s*:/i;

const MONTH_INDEX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * The date a forward's original was first sent, from the forwarded header
 * ("Sent: 30 October 2026 12:16", "Date: Thu, 1 Oct 2026 at 10:22",
 * "Sent: Thursday, October 1, 2026 10:22 AM"), yyyy-mm-dd, or null.
 */
export function firstSentDate(body: string | null | undefined): string | null {
  for (const m of (body ?? "").matchAll(/^\s*\**(?:sent|date)\s*:\**\s*(.+)$/gim)) {
    const line = m[1];
    const dm = line.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
    const md = line.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
    const [day, mon, year] = dm ? [dm[1], dm[2], dm[3]] : md ? [md[2], md[1], md[3]] : [null, null, null];
    const month = mon ? MONTH_INDEX[mon.slice(0, 3).toLowerCase()] : undefined;
    if (day && month && year) return `${year}-${String(month).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
  }
  return null;
}

/** Ruling d, re-ruled: "forwarded by {sender}, first sent {d Mon}", or "forwarded by {sender}" when the original's date isn't in the email. */
export function forwardedByLine(sender: string | null, body: string | null | undefined): string {
  const first = firstSentDate(body);
  return `forwarded by ${senderName(sender)}${first ? `, first sent ${dayMonth(first)}` : ""}`;
}

export function sourceOf(f: ItemFacts): SourceView {
  const address = (f.report.sender ?? "").match(/[^\s<>"]+@([^\s<>"]+)/);
  const upload = f.report.gmailMessageId.startsWith("upload:");
  // Ruling d: a forward's meta gains "· forwarded by {sender}, first sent {d Mon}".
  const forwardedBy = FORWARD.test(f.report.subject) ? forwardedByLine(f.report.sender, f.report.body) : null;
  return {
    forwardedBy,
    // R1a: a near miss's meta is "{received}" only; a replaced item's is "\"{newer subject}\" · {received}".
    subject: f.kind === "near_miss" ? null : f.report.subject,
    sender: f.kind === "replaced" || f.kind === "near_miss" ? "" : (address?.[1]?.toLowerCase() ?? f.report.sender ?? ""),
    received: dayMonthTime(f.report.receivedAt),
    emailUrl: upload ? null : gmailUrl(f.report.gmailMessageId, f.inbox),
  };
}

const act = (label: string, action: string, extra: Partial<ActionView> = {}): ActionView => ({ label, action, ...extra });

type Words = Pick<ReviewItemView, "title" | "titleShort" | "body" | "bodyShort" | "actions">;

function priceWords(f: ItemFacts, show: string): Words {
  const flags = (f.detail.flags as PriceFlag[] | undefined) ?? [];
  const flag = flags.find((x) => x.reason === "equals_count") ?? flags[0];
  const sheet = f.report.sheetDate ? dayMonth(f.report.sheetDate) : dayMonth(f.report.receivedAt);
  const outlet = flag ? (OUTLET_NAMES[flag.outlet] ?? flag.outlet) : "";
  const title = `${show}: a price on the ${sheet} sheet looks wrong`;
  const held = `Counts are stored; ${show}'s revenue from this sheet is held.`;
  let body = held;
  let bodyShort = "Revenue held.";
  // R1a: "Also {n} more on this sheet." when more than one tier fires (IPC: all seven).
  const more = flags.length > 1 ? ` Also ${figure(flags.length - 1)} more on this sheet.` : "";
  if (flag?.reason === "equals_count") {
    body = `${flag.tierName} on ${outlet} shows ${pounds(flag.pricePence)} with ${figure(flag.count)} sold, the same number.${more} ${held}`;
    bodyShort = `${flag.tierName} on ${outlet}: ${pounds(flag.pricePence)} with ${figure(flag.count)} sold.${more} Revenue held.`;
  } else if (flag) {
    // Fix 2: the dearest-ticket variant names the outlet.
    body = `${flag.tierName} on ${outlet} shows ${pounds(flag.pricePence)}, above the dearest ticket (${pounds(flag.ceilingPence)}).${more} ${held}`;
    bodyShort = `${flag.tierName} on ${outlet}: ${pounds(flag.pricePence)}, above ${pounds(flag.ceilingPence)}.${more} Revenue held.`;
  }
  return { title, titleShort: title, body, bodyShort, actions: [act("Revenue is right", "revenue_right"), act("Keep holding", "keep_holding")] };
}

function unmatchedWords(f: ItemFacts): Words {
  const name = f.showName ?? "";
  const closest = f.detail.closest as { eventCode: string; name: string; eventDate: string | null; id?: string } | null;
  const title = `"${name}" isn't matched to an event`;
  const titleShort = `"${name}" isn't matched`;
  const notOurs = act("Not a show we run", "not_ours");
  if (!closest || !closest.id) {
    const day = dayMonth(f.report.receivedAt);
    return {
      title,
      titleShort,
      body: `From the ${day} email. Closest: none of Electric's running shows.`,
      bodyShort: `${day} email · no close event`,
      actions: [act("Choose an event", "match", { needs: ["event"] }), notOurs],
    };
  }
  const when = closest.eventDate ? ` · ${dayMonth(closest.eventDate)}` : "";
  const line = `Closest: ${closest.name}${when}.`;
  return {
    title,
    titleShort,
    body: line,
    bodyShort: line,
    actions: [
      act(`Match to ${closest.name}`, "match", { fields: { event_id: closest.id } }),
      act("Choose another", "match", { needs: ["event"] }),
      notOurs,
    ],
  };
}

export function itemWords(f: ItemFacts): Words {
  // Exactly as stored: the sheet's own name, never re-cased.
  const show = f.showName ?? f.eventName ?? "";
  const d = f.detail;
  switch (f.kind) {
    case "price_looks_wrong":
      return priceWords(f, show);
    case "sale_mention": {
      const quote = `"${String(d.sentence ?? "")}"`;
      const named = f.showName ? ` · ${show}` : "";
      const short = f.showName ? ` · ${show.split(" ")[0]}` : "";
      return {
        title: "Email mentions sales not in the sheet",
        titleShort: "Email mentions sales not in the sheet",
        body: `${quote}${named}`,
        bodyShort: `${quote}${short}`,
        actions: [act("Add as a manual entry", "add_manual", { needs: ["event", "figure"] }), act("Not a sale", "not_a_sale")],
      };
    }
    case "unmatched_show":
      return unmatchedWords(f);
    case "date_mismatch": {
      const sheet = dayMonth(String(d.sheetDate));
      const subject = dayMonth(String(d.subjectDate));
      const title = `The ${subject} email's sheet is dated ${sheet}`;
      const body = "Counts from this sheet are held until you pick the date.";
      return {
        title,
        titleShort: title,
        body,
        bodyShort: body,
        actions: [
          act(`Use ${sheet}`, "use_date", { fields: { date: String(d.sheetDate) } }),
          act(`Use ${subject}`, "use_date", { fields: { date: String(d.subjectDate) } }),
        ],
      };
    }
    case "sum_mismatch": {
      const title = `${show}: tiers add to ${figure(d.tiers)}, the sheet's total says ${figure(d.total)}`;
      const body = "This show's count is held until you choose. Other shows on the sheet are stored.";
      return {
        title,
        titleShort: title,
        body,
        bodyShort: body,
        actions: [
          act(`Use the total (${figure(d.total)})`, "use_total", { fields: { total: String(d.total) } }),
          act(`Use the tiers (${figure(d.tiers)})`, "use_total", { fields: { total: String(d.tiers) } }),
        ],
      };
    }
    case "unreadable_pdf": {
      // Ruling b: the PDF's date when it has one, else the date the email was sent.
      const title = d.date ? `Couldn't read the ${dayMonth(String(d.date))} sheet` : `Couldn't read the sheet sent ${dayMonth(f.report.receivedAt)}`;
      const body = `${f.report.pdfFilename ?? "No PDF"}. Nothing from it was stored.`;
      const url = sourceOf(f).emailUrl;
      return {
        title,
        titleShort: title,
        body,
        bodyShort: body,
        actions: [...(url ? [{ label: "Open the email", action: null, href: url }] : []), act("Not a count", "not_a_count")],
      };
    }
    case "near_miss": {
      const body = `An email from Electric with a PDF: "${f.report.subject}".`;
      return {
        title: "Looks like a count but wasn't read as one",
        titleShort: "Looks like a count but wasn't read as one",
        body,
        bodyShort: body,
        actions: [act("Read it as a count", "read_as_count"), act("Not a count", "not_a_count")],
      };
    }
    case "replaced": {
      // R1a, ruled. The forward case (M1b change 1) is the same item with the stored sheet kept and the buttons reversed.
      const day = dayMonth(String(d.countDate));
      const words = {
        title: `The ${day} sheet was replaced by a later email`,
        titleShort: `${day} sheet replaced`,
        body:
          d.forward === true
            ? "Counts still come from the earlier sheet. The forwarded one is kept."
            : "Counts now come from the later sheet. The earlier one is kept.",
        bodyShort: d.forward === true ? "Earlier sheet kept." : "Later sheet used.",
      };
      return d.forward === true
        ? { ...words, actions: [act("Keep the earlier sheet", "keep_earlier"), act("Use the later sheet", "use_later")] }
        : { ...words, actions: [act("Keep the later sheet", "keep"), act("Use the earlier sheet", "undo")] };
    }
    case "no_tiers": {
      // Design's ruling on a57bca9.
      const date = d.date ? dayMonth(String(d.date)) : f.report.sheetDate ? dayMonth(f.report.sheetDate) : dayMonth(f.report.receivedAt);
      return {
        title: `${show}: the ${date} sheet gives a total (${figure(d.total)}) but no tiers`,
        titleShort: `${show}: total ${figure(d.total)}, no tiers`,
        body: "Comps can't be separated, so this show's count is held. Other shows on the sheet are stored.",
        bodyShort: "Held.",
        actions: [act(`Use the total (${figure(d.total)})`, "use_total", { fields: { total: String(d.total) } }), act("Skip this show", "skip_show")],
      };
    }
    case "block_after_sent": {
      // Ruling a.
      const blockDate = dayMonth(String(d.blockDate));
      const sheetDate = d.sheetDate ? dayMonth(String(d.sheetDate)) : null;
      return {
        title: `${show}: this block is dated ${blockDate}, after the email was sent`,
        titleShort: `${show}: block dated after the email`,
        body: "This show's count is held until you pick the date. Other shows on the sheet are stored.",
        bodyShort: "Held until you pick.",
        actions: [
          ...(sheetDate ? [act(`Use ${sheetDate}`, "use_date", { fields: { date: String(d.sheetDate) } })] : []),
          act(`Use ${blockDate}`, "use_date", { fields: { date: String(d.blockDate) } }),
        ],
      };
    }
    default: {
      // since_last_mismatch: R1a's title, fix 1's body, buttons and 393 title.
      const prevDate = d.previousDate ? dayMonth(String(d.previousDate)) : null;
      const body = `Counts are stored from the total.${prevDate ? ` Our previous count is ${prevDate}.` : ""}`;
      const prevUrl = d.previousMessageId ? gmailUrl(String(d.previousMessageId), f.inbox) : null;
      return {
        title: `${show}: SINCE LAST COUNT says ${figure(d.theirs)}, the counts moved ${figure(d.ours)}`,
        titleShort: `${show}: SINCE LAST COUNT ${figure(d.theirs)}, ours ${figure(d.ours)}`,
        body,
        bodyShort: body,
        actions: [
          act("Counts are right", "checked"),
          ...(prevDate && prevUrl ? [{ label: `Open the ${prevDate} email`, action: null, href: prevUrl }] : []),
        ],
      };
    }
  }
}

/** Ruling d: under an item, when its email arrived after a later count was stored. */
export function lateArrivalNote(detail: Record<string, unknown>): string | null {
  const late = detail.lateArrival as { laterDate?: string; filedDate?: string } | undefined;
  if (!late?.laterDate || !late.filedDate) return null;
  return `Arrived after the ${dayMonth(late.laterDate)} count. Filed under ${dayMonth(late.filedDate)}; later counts are unchanged.`;
}

export function openItemView(f: ItemFacts): ReviewItemView {
  return { id: f.id, kind: f.kind, ...itemWords(f), source: sourceOf(f), note: lateArrivalNote(f.detail) };
}

export function checkedItemView(f: ItemFacts, resolvedByName: string | null, resolvedAt: string, resolution: string): CheckedItemView {
  const { title } = itemWords(f);
  const lowered = /^(The|Email|Looks|Couldn't)\b/.test(title) ? title.charAt(0).toLowerCase() + title.slice(1) : title;
  return {
    id: f.id,
    title: `Checked · ${lowered}`,
    source: sourceOf(f),
    by: `${resolvedByName ?? "Someone"}, ${dayMonthTime(resolvedAt)}`,
    undo: f.kind === "replaced" && resolution === "keep" ? act("Undo", "undo") : null,
  };
}

export type GmailState = "reading" | "not_set_up" | "unreachable";

/**
 * R1a's subline under "To check · {n}". The mailbox is GMAIL_INGEST_MAILBOX.
 * NOT RULED: "Couldn't read {mailbox}" when there has never been a read to time.
 */
export function gmailStatusLine(state: GmailState, mailbox: string | null, lastReadAt: string | null, now = new Date()): string {
  if (state === "not_set_up" || !mailbox) return "Gmail access isn't set up yet";
  const last = lastReadAt ? ` · last read ${lastReadTime(lastReadAt, now)}` : "";
  if (state === "reading") return `Reading ${mailbox}${last || ` · last read ${lastReadTime(now.toISOString(), now)}`} · internal only`;
  // Access is set up but no read has ever worked: not the same as "isn't set up yet".
  return `Couldn't read ${mailbox}${last || " · no read has worked yet"}`;
}

export interface UploadOutcome {
  status: string;
  file: string;
  written?: number;
  held?: number;
  /** When the same PDF was first read, for "Already read {file} on {date}." */
  firstReadAt?: string | null;
}

/** R1a's upload result lines; the three refusals are ruled (PASS). */
export function uploadLine(o: UploadOutcome): string | null {
  switch (o.status) {
    case "processed": {
      const written = o.written ?? 0;
      const toCheck = o.held ? `, ${figure(o.held)} to check` : "";
      return `Read ${o.file} · ${figure(written)} ${written === 1 ? "show" : "shows"} stored${toCheck}`;
    }
    case "unreadable":
      return `Couldn't read ${o.file}. It's in To check.`;
    case "already_read":
    case "duplicate":
      return `Already read ${o.file}${o.firstReadAt ? ` on ${dayMonth(o.firstReadAt)}` : ""}.`;
    case "no_file":
      return "Choose a PDF to upload.";
    case "too_large":
      return "That PDF is over 10 MB.";
    case "not_pdf":
      return "That file isn't a PDF.";
    default:
      return null;
  }
}
