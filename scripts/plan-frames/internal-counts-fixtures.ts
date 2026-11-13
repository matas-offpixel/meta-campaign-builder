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
 * R1E: "Nothing to check", before delegation is granted ("Gmail access isn't set up yet"), after an upload.
 */

import { checkedItemView, gmailStatusLine, openItemView, uploadLine, type ItemFacts } from "../../lib/internal-counts/review-words.ts";
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
      // The real 12 Nov sheet: all seven tiers fire, so "Also 6 more on this sheet."
      detail: {
        flags: [
          ["1ST", 200],
          ["2nd", 200],
          ["3rd", 363],
          ["4th", 579],
          ["Final", 3],
          ["group 2", 168],
          ["Group", 48],
        ].map(([tierName, count], i) => ({
          position: i + 1,
          tierName,
          outlet: "SKIDDLE",
          pricePence: Number(count) * 100,
          count,
          reason: "equals_count",
          ceilingPence: 15000,
        })),
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
    // Invented: a domain PDF that isn't the counts sheet (the inbox has none since M1b). Meta is "{received}" only.
    "near-miss",
    "near_miss",
    {},
    {
      subject: "Internal shows: Q4 budgets",
      sender: RACHEL,
      receivedAt: "2026-11-10T16:20:00Z",
      sheetDate: null,
      subjectDate: null,
      gmailMessageId: "invented-near-miss",
      pdfFilename: "Q4 budgets.pdf",
    },
  ),
  facts(
    // Invented: a second email for 12 Nov with a different IPC count.
    "replaced-open",
    "replaced",
    { showName: "IPC", detail: { countDate: "2026-11-12", previousTotal: 1826, total: 1828 } },
    { subject: "Internal Show Count 12.11.26", receivedAt: "2026-11-12T15:02:00Z", gmailMessageId: "invented-12nov-2" },
  ),
  facts(
    // Invented: the same, arriving as a forward: the stored sheet is kept, buttons reversed.
    "replaced-forward",
    "replaced",
    { showName: "IPC", detail: { countDate: "2026-11-12", previousTotal: 1826, total: 1828, forward: true } },
    { subject: "Fw: Internal Show Count 12.11.26", receivedAt: "2026-11-12T16:10:00Z", gmailMessageId: "invented-12nov-fw" },
  ),
  // Real: IPC on 30 Oct, the sheet's SINCE LAST COUNT 10, our counts moved 13.
  facts("ipc-since", "since_last_mismatch", { showName: "IPC", detail: { theirs: 10, ours: 13, previousTotal: 1760 } }, oct30),
  facts(
    // Invented: a price above the event's dearest ticket (none in the inbox).
    "dod-dearest",
    "price_looks_wrong",
    {
      showName: "D.O.D",
      detail: {
        flags: [{ position: 7, tierName: "Group", outlet: "SKIDDLE", pricePence: 18000, count: 16, reason: "above_ceiling", ceilingPence: 2200 }],
      },
    },
    {},
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

const NOW = new Date("2026-11-13T14:30:00Z");

export const R1_VIEW: InternalCountsView = {
  statusLine: gmailStatusLine("reading", INBOX, "2026-11-13T14:05:00Z", NOW),
  flash: null,
  open: OPEN.map(openItemView),
  checked: [checkedItemView(REPLACED, "Matas", "2026-11-12T15:20:00Z", "keep")],
  events: EVENTS,
};

export const R1E_VIEW: InternalCountsView = {
  statusLine: gmailStatusLine("not_set_up", INBOX, null, NOW),
  flash: uploadLine({ status: "processed", file: "MIKE'S INTERNAL SHOWS - INTERNAL COUNTS (23).pdf", written: 9, held: 0 }),
  open: [],
  checked: [],
  events: EVENTS,
};
