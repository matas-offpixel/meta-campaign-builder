/**
 * R1 frames: the Internal Counts review list (HD1, M5/R1 of
 * docs/design-record/2026-11-13-internal-counts-matching.html). Fixture
 * only. The words come from lib/internal-counts/review-words.ts, so the
 * frames show what the page shows.
 *
 * R1:  "To check · 8" with every item kind R1 words, and a "Checked" row.
 *      Real, from the inbox: IPC's 12 Nov price (1ST £200.00 with 200 sold),
 *      Enzo's 30 Oct "Grand total sold for this event is 1974.", DUSKY BRIS
 *      (Dusky Bristol, the sheet's own spelling), FOLAMOUR → Folamour,
 *      Enzo's 30 Oct sum (tiers 1887, total 1917) and the 16 Oct "Re:"
 *      near miss. Invented, because nothing in the inbox has them yet: the
 *      date mismatch (13 Nov email, 12 Nov sheet), the unreadable sheet and
 *      the replaced 12 Nov sheet.
 * R1E: "Nothing to check".
 */

import { checkedItemView, openItemView, type ItemFacts } from "../../lib/internal-counts/review-words.ts";
import type { InternalCountsView } from "../../lib/internal-counts/view-types.ts";

export const INTERNAL_COUNTS_FRAME_IDS = ["R1", "R1E"] as const;

const INBOX = "matas@offpixel.co.uk";
const RACHEL = "Rachel Chadwick <Rachel@electric-group.co.uk>";

function facts(id: string, kind: string, over: Partial<ItemFacts>, report: Partial<ItemFacts["report"]>): ItemFacts {
  return {
    id,
    kind,
    showName: null,
    eventName: null,
    detail: {},
    inbox: INBOX,
    ...over,
    report: {
      subject: "Internal Show Count 12.11.26",
      sender: RACHEL,
      receivedAt: "2026-11-12T11:33:36Z",
      sheetDate: "2026-11-12",
      subjectDate: "2026-11-12",
      gmailMessageId: "1a1cf88f5009e5ff",
      pdfFilename: "MIKE'S INTERNAL SHOWS - INTERNAL COUNTS (23).pdf",
      ...report,
    },
  };
}

const oct30 = {
  subject: "Internal Show Count 30.10.26",
  receivedAt: "2026-10-30T11:32:36Z",
  sheetDate: "2026-10-30",
  subjectDate: "2026-10-30",
  gmailMessageId: "1a18c955be443784",
};

const OPEN: ItemFacts[] = [
  facts(
    "ipc-price",
    "price_looks_wrong",
    {
      showName: "IPC",
      detail: {
        flags: [{ position: 1, tierName: "1ST", outlet: "SKIDDLE", pricePence: 20000, count: 200, reason: "equals_count", ceilingPence: 15000 }],
      },
    },
    {},
  ),
  facts("enzo-sale", "sale_mention", { showName: "ENZO SIRAGUSA", detail: { sentence: "Grand total sold for this event is 1974." } }, oct30),
  facts("dusky", "unmatched_show", { showName: "DUSKY BRIS", detail: { closest: null } }, oct30),
  facts(
    "folamour",
    "unmatched_show",
    { showName: "FOLAMOUR", detail: { closest: { eventCode: "NX26-FOLAMOUR", name: "Folamour", eventDate: "2026-10-23", id: "e-folamour" } } },
    { subject: "Internal Counts 26.10.26", receivedAt: "2026-10-26T12:01:27Z", sheetDate: "2026-10-26", gmailMessageId: "1a1781651d58cb98" },
  ),
  facts(
    "date",
    "date_mismatch",
    { detail: { sheetDate: "2026-11-12", subjectDate: "2026-11-13" } },
    { subject: "Internal Show Count 13.11.26", receivedAt: "2026-11-13T11:40:00Z", subjectDate: "2026-11-13", gmailMessageId: "invented-13nov" },
  ),
  facts("enzo-sum", "sum_mismatch", { showName: "ENZO SIRAGUSA", detail: { tiers: 1887, total: 1917 } }, oct30),
  facts(
    "unreadable",
    "unreadable_pdf",
    {},
    {
      subject: "Internal Show Count 16.11.26",
      receivedAt: "2026-11-16T11:30:00Z",
      sheetDate: null,
      subjectDate: "2026-11-16",
      gmailMessageId: "invented-16nov",
      pdfFilename: "MIKE'S INTERNAL SHOWS - INTERNAL COUNTS (25).pdf",
    },
  ),
  facts(
    "near-miss",
    "near_miss",
    {},
    {
      subject: "Re: Internal Counts 16.10.26",
      sender: "Matthew Green <Matthew@electric-group.co.uk>",
      receivedAt: "2026-10-16T17:06:23Z",
      sheetDate: null,
      subjectDate: null,
      gmailMessageId: "1a145ade769c7216",
      pdfFilename: "INTERNAL COUNTS 16.10.26.pdf",
    },
  ),
];

const REPLACED = facts(
  "replaced",
  "replaced",
  { showName: "IPC", detail: { countDate: "2026-11-12", previousTotal: 1826, total: 1828 } },
  { subject: "Internal Show Count 12.11.26", receivedAt: "2026-11-12T15:02:00Z", gmailMessageId: "invented-12nov-2" },
);

const EVENTS = [
  { id: "e-ipc", label: "Interplanetary Criminal · 21 Nov" },
  { id: "e-folamour", label: "Folamour · 23 Oct" },
  { id: "e-dod", label: "D.O.D · 4 Dec" },
];

export const R1_VIEW: InternalCountsView = {
  inbox: INBOX,
  gmailConfigured: true,
  gmail: { email: INBOX, lastPullAt: "2026-11-13T12:00:04Z", lastPullError: null },
  flash: null,
  open: OPEN.map(openItemView),
  checked: [checkedItemView(REPLACED, "Matas", "2026-11-12T15:20:00Z", "keep")],
  events: EVENTS,
};

export const R1E_VIEW: InternalCountsView = {
  inbox: INBOX,
  gmailConfigured: true,
  gmail: { email: INBOX, lastPullAt: "2026-11-13T12:00:04Z", lastPullError: null },
  flash: null,
  open: [],
  checked: [],
  events: EVENTS,
};
