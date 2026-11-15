import type { ReleaseRow, ClaimLine } from "@/components/dashboard/asset-bank/surface";

/**
 * AB1 as drawn. Today is 7 Nov 2026. No counts.
 * The Skiddle lines are the record's provenance, not a live read.
 */
export const AB1_ROWS: ReleaseRow[] = [
  {
    id: "early",
    name: "Early bird",
    when: "21 Oct",
    shortWhen: "21 Oct",
    state: "sold_out",
    provenance: "set 28 Oct · client message",
    shortProvenance: "set 28 Oct · client message",
    wideOnly: true,
    timelineLabel: "Early bird · 21 Oct",
    shortTimeline: "Early bird · 21 Oct",
    left: "8%",
    rungs: [
      { text: "live", short: "live", status: "done" },
      { text: "sold out", short: "sold out", status: "done" },
    ],
  },
  {
    id: "second",
    name: "2nd release",
    when: "29 Oct · 11:30 / 12:00",
    shortWhen: "29 Oct",
    state: "sold_out",
    provenance: "set 5 Nov · Skiddle read",
    shortProvenance: "set 5 Nov",
    wideOnly: true,
    timelineLabel: "2nd release · 29 Oct 11:30 / 12:00",
    shortTimeline: "2nd · 29 Oct",
    left: "30%",
    low: true,
    rungs: [
      { text: "live", short: "live", status: "done" },
      { text: "90% sold out", short: "90%", status: "done" },
      { text: "sold out", short: "sold out", status: "done" },
    ],
  },
  {
    id: "general",
    name: "General sale",
    when: "30 Oct · 12:00",
    shortWhen: "30 Oct",
    state: "on_sale",
    provenance: "set 30 Oct",
    shortProvenance: "30 Oct",
    countChip: "always",
    timelineLabel: "General sale · 30 Oct 12:00",
    shortTimeline: "Gen sale · 30 Oct",
    left: "46%",
    rungs: [
      { text: "live", short: "live", status: "done" },
      { text: "90%", short: "90%", status: "later" },
      { text: "final X", short: "final X", status: "later" },
    ],
  },
  {
    id: "third",
    name: "3rd release",
    when: "6 Nov · 11:30 / 12:00",
    shortWhen: "6 Nov",
    state: "selling_fast",
    provenance: "set 6 Nov · Skiddle read",
    shortProvenance: "6 Nov · Skiddle",
    countChip: "wide",
    timelineLabel: "3rd release · 6 Nov 11:30 / 12:00",
    shortTimeline: "3rd · 6 Nov",
    left: "62%",
    low: true,
    rungs: [
      { text: "live · selling fast", short: "live", status: "done" },
      { text: "90% · next read Mon", short: "90% · next read Mon", status: "next" },
      { text: "final X", short: "final X", status: "later" },
    ],
  },
];

export const AB1_CLAIMS: ClaimLine[] = [
  { text: "2nd release live · selling fast", chip: "ran 29 Oct", tone: "ok" },
  { text: "2nd release 90% sold out", chip: "ran 4 Nov", tone: "ok" },
  { text: "3rd release live · selling fast", chip: "ran 6 Nov", tone: "ok" },
  { text: "3rd release 90% sold out · payday window", chip: "proposed · Mon read", tone: "warn" },
  { text: "Final X · 3rd release", chip: "later · after 90%", tone: "dash" },
  { text: "General sale 90% sold out", chip: "later · needs selling fast", tone: "dash" },
];

/** AB1b. Two rows from the dates, nobody has tapped them. */
export const AB1B_ROWS: ReleaseRow[] = [
  {
    id: "presale",
    name: "Presale",
    when: "from presale_at · Fri 20 Nov 18:00",
    shortWhen: "Fri 20 Nov 18:00 · from the dates",
    state: "not_yet",
    plain: true,
    provenance: "from the event's dates · tap to confirm",
    shortProvenance: "tap to confirm",
    timelineLabel: "Presale",
    shortTimeline: "Presale",
    left: "8%",
    rungs: [],
  },
  {
    id: "general",
    name: "General sale",
    when: "from general_sale_at · Sat 21 Nov 12:00",
    shortWhen: "Sat 21 Nov 12:00 · from the dates",
    state: "on_sale",
    plain: true,
    provenance: "from the event's dates · tap to confirm",
    shortProvenance: "tap to confirm",
    timelineLabel: "General sale",
    shortTimeline: "General sale",
    left: "46%",
    rungs: [],
  },
];
