/**
 * lib/internal-counts/review-words.ts
 *
 * R1 of docs/design-record/2026-11-13-internal-counts-matching.html: the
 * review list's words, at 1280 and at 393. Every string here is R1's,
 * filled with the item's facts, except the two marked NOT IN R1 (an open
 * "replaced" note and a SINCE LAST COUNT note), which wait on a ruling.
 */

import type { PriceFlag } from "./checks.ts";
import type { ActionView, CheckedItemView, ReviewItemView, SourceView } from "./view-types.ts";

const LONDON = "Europe/London";

export function dayMonth(isoDate: string): string {
  return new Date(`${isoDate.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: LONDON });
}

export function dayMonthTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: LONDON });
  return `${dayMonth(d.toISOString())} ${time}`;
}

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

/** "ENZO SIRAGUSA" → "Enzo Siragusa"; a name with lower case in it is kept as written. */
export function displayShow(name: string): string {
  if (/[a-z]/.test(name)) return name;
  return name.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

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
  };
  inbox: string | null;
}

export function sourceOf(f: ItemFacts): SourceView {
  const address = (f.report.sender ?? "").match(/[^\s<>"]+@([^\s<>"]+)/);
  const upload = f.report.gmailMessageId.startsWith("upload:");
  return {
    subject: f.report.subject,
    // R1a: a replaced item's meta is "\"{newer subject}\" · {received}", no sender.
    sender: f.kind === "replaced" ? "" : (address?.[1]?.toLowerCase() ?? f.report.sender ?? ""),
    received: dayMonthTime(f.report.receivedAt),
    emailUrl: upload
      ? null
      : `https://mail.google.com/mail/${f.inbox ? `?authuser=${encodeURIComponent(f.inbox)}` : ""}#all/${f.report.gmailMessageId}`,
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
  if (flag?.reason === "equals_count") {
    body = `${flag.tierName} on ${outlet} shows ${pounds(flag.pricePence)} with ${flag.count} sold, the same number. ${held}`;
    bodyShort = `${flag.tierName} on ${outlet}: ${pounds(flag.pricePence)} with ${flag.count} sold. Revenue held.`;
  } else if (flag) {
    // NOT IN R1: the "above the event's dearest ticket" variant.
    body = `${flag.tierName} shows ${pounds(flag.pricePence)}, above ${show}'s dearest ticket (${pounds(flag.ceilingPence)}). ${held}`;
    bodyShort = `${flag.tierName}: ${pounds(flag.pricePence)}, above ${pounds(flag.ceilingPence)}. Revenue held.`;
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
  const show = f.eventName ?? displayShow(f.showName ?? "");
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
      const title = `${show}: tiers add to ${d.tiers}, the sheet's total says ${d.total}`;
      const body = "This show's count is held until you choose. Other shows on the sheet are stored.";
      return {
        title,
        titleShort: title,
        body,
        bodyShort: body,
        actions: [
          act(`Use the total (${d.total})`, "use_total", { fields: { total: String(d.total) } }),
          act(`Use the tiers (${d.tiers})`, "use_total", { fields: { total: String(d.tiers) } }),
        ],
      };
    }
    case "unreadable_pdf": {
      // M1b: the PDF's date, else the subject's.
      const day = dayMonth(String(d.date ?? f.report.subjectDate ?? f.report.receivedAt));
      const title = `Couldn't read the ${day} sheet`;
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
        body: "Counts now come from the later sheet. The earlier one is kept.",
        bodyShort: "Later sheet used.",
      };
      return d.forward === true
        ? { ...words, actions: [act("Keep the earlier sheet", "keep_earlier"), act("Use the later sheet", "use_later")] }
        : { ...words, actions: [act("Keep the later sheet", "keep"), act("Use the earlier sheet", "undo")] };
    }
    default: {
      // NOT IN R1: since_last_mismatch (the first brief's cross-check).
      const title = `${show}: SINCE LAST COUNT says ${d.theirs}, our counts give ${d.ours}`;
      const body = "The count is stored as the sheet gives it.";
      return { title, titleShort: title, body, bodyShort: body, actions: [act("Checked", "checked")] };
    }
  }
}

export function openItemView(f: ItemFacts): ReviewItemView {
  return { id: f.id, kind: f.kind, ...itemWords(f), source: sourceOf(f) };
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
