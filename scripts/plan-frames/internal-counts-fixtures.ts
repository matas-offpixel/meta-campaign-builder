/**
 * IC frames: the Internal Counts review list (HD1). Fixture only.
 *
 * IC1: day one. Gmail connected, the 12 Nov email read, no count alias
 *      confirmed yet, so every show waits with its proposal; IPC also
 *      carries its price note. The 11 Nov email shows as an earlier count.
 * IC2: Gmail not connected and nothing to review.
 */

import type { InternalCountsView } from "../../lib/internal-counts/view-types.ts";

export const INTERNAL_COUNTS_FRAME_IDS = ["IC1", "IC2"] as const;

const proposals: Array<[string, string]> = [
  ["IPC", "NX26-IPC"],
  ["EAST END DUBS", "NX26-EED"],
  ["D.O.D", "NX26-DOD"],
  ["SCHAK", "NX26-SCHAK"],
  ["RUDIMENTAL", "NX26-RUDIMENTAL"],
  ["ROBBIE DOHERTY", "NX26-ROBBIEDOHERTY"],
  ["KREAM", "EBR26-KREAM"],
  ["Julian Fijma", "NX27-JULIANFIJMA"],
  ["LOCKLEAD", "NX26-LOCKLEAD"],
];

export const IC1_VIEW: InternalCountsView = {
  gmailConfigured: true,
  gmail: { email: "matas@offpixel.co.uk", lastPullAt: "2026-11-12T13:00:04Z", lastPullError: null },
  flash: null,
  groups: [
    {
      reportId: "r12",
      subject: "Internal Show counts 12.11.26",
      receivedAt: "2026-11-12T11:47:22Z",
      items: [
        ...proposals.map(([show, code], i) => ({
          id: `u${i}`,
          kind: "unmatched_show",
          blocking: true,
          showName: show,
          message: `No count alias for "${show}". Proposed: ${code}.`,
        })),
        {
          id: "p0",
          kind: "price_looks_wrong",
          blocking: false,
          showName: "IPC",
          message:
            "Prices look wrong (1ST £200.00, 2nd £200.00, 3rd £363.00, 4th £579.00, Final £3.00, group 2 £168.00, Group £48.00). Counts stored; revenue withheld.",
        },
      ],
    },
  ],
  recent: [
    { reportId: "r12", subject: "Internal Show counts 12.11.26", receivedAt: "2026-11-12T11:47:22Z", countDate: "2026-11-12", written: 0, inReview: 9 },
    { reportId: "r11", subject: "Internal Show counts 11.11.26", receivedAt: "2026-11-11T11:51:09Z", countDate: "2026-11-11", written: 9, inReview: 0 },
  ],
};

export const IC2_VIEW: InternalCountsView = {
  gmailConfigured: true,
  gmail: null,
  flash: null,
  groups: [],
  recent: [],
};
