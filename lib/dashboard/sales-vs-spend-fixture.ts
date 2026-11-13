/**
 * 12 Nov NX figures from the dashboard v2 design record (DV1–DV3).
 * Example numbers, shaped like the server calc's output. Capacity is only
 * set where the record states it. Locklead has none.
 */

import {
  LIBRARY_OPENS,
  MISSING_CAPACITY,
  MISSING_CAPACITY_SHORT,
  NO_TICKET_COUNTS,
  type AllocationStep,
  type SalesCampaignRow,
  type SalesChartPoint,
  type SalesDashboardModel,
  type SalesMetricId,
  type SalesShowView,
  type SalesTile,
} from "./sales-vs-spend.ts";

const ESTIMATE = "Estimated between counts on 5 Nov and 12 Nov";

const LIBRARY_NOTE =
  "Average and best from 3 finished NX shows: DJ EZ (2 Oct), Modern Funktion (16 Oct), Folamour (23 Oct). Enzo is out: it sold out before its final week.";

const ALL_NOTE =
  "Each show is capped at its own allocation before summing. A show with no capacity is left out of the total and says why.";

function dayValue(index: number, lastIndex: number, end: number, start = 0): number {
  if (lastIndex <= 0) return end;
  return start + ((end - start) * index) / lastIndex;
}

function ipcPoints(): SalesChartPoint[] {
  const start = Date.parse("2026-10-30T00:00:00Z");
  const points: SalesChartPoint[] = [];
  for (let i = 0; i < 14; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const estimated = day > "2026-11-05" && day < "2026-11-12";
    const values: Partial<Record<SalesMetricId, number>> = {
      spend: Math.round(dayValue(i, 13, 2060)),
      sold: Math.round(dayValue(i, 13, 812, 640)),
      tickets: Math.round(dayValue(i, 13, 146)),
      costPerTicket: 14.11,
      checkoutActions: Math.round(dayValue(i, 13, 388)),
      costPerCheckout: 5.31,
      lpv: Math.round(dayValue(i, 13, 1240)),
      costPerLpv: 1.66,
      clicks: Math.round(dayValue(i, 13, 4180)),
      cpc: 0.49,
    };
    points.push({ day, estimated, estimateNote: estimated ? ESTIMATE : null, values });
  }
  return points;
}

const IPC_ALLOCATION: AllocationStep[] = [
  { day: "2026-10-30", value: 1000 },
  { day: "2026-11-03", value: 1200 },
  { day: "2026-11-09", value: 1500 },
];

function ipcTiles(): SalesTile[] {
  return [
    { id: "spend", value: "£2,060", detail: "Meta £1,840 · TikTok £220 · of £5,410 since launch", narrowDetail: "Meta £1,840 · TikTok £220", title: "Meta £1,840 · TikTok £220. Google has no spend in this window." },
    { id: "sold", value: "812", detail: "Internal Counts, 12 Nov · plus 64 comps", narrowDetail: "Internal Counts, 12 Nov", title: "Internal Counts, 12 Nov. 64 comps on top." },
    { id: "tickets", value: "146", detail: "in 14 days", narrowDetail: "14 days", title: "146 tickets in the 14 days to 12 Nov." },
    { id: "costPerTicket", value: "£14.11", detail: "blended · complete windows", narrowDetail: "blended", title: "Blended cost per ticket, complete windows only." },
    { id: "checkoutActions", value: "388", detail: "£5.31 each", narrowDetail: "£5.31 each", title: "Checkouts and add-to-carts. One person can do both." },
    { id: "costPerCheckout", value: "£5.31", detail: "388 actions", narrowDetail: "388 actions", title: "Checkouts and add-to-carts. One person can do both." },
    { id: "lpv", value: "1,240", detail: "in 14 days", narrowDetail: "14 days", title: "Landing page views in the 14 days to 12 Nov." },
    { id: "costPerLpv", value: "£1.66", detail: "1,240 views", narrowDetail: "1,240 views", title: "Spend divided by landing page views." },
    { id: "clicks", value: "4,180", detail: "in 14 days", narrowDetail: "14 days", title: "Clicks in the 14 days to 12 Nov." },
    { id: "cpc", value: "£0.49", detail: "blended", narrowDetail: "blended", title: "Spend divided by clicks." },
    { id: "registrations", value: "—", detail: "signups closed at on-sale", narrowDetail: "signups closed", title: "Signups closed when the show went on sale." },
    { id: "costPerRegistration", value: "—", detail: "signups closed at on-sale", narrowDetail: "signups closed", title: "No signup days in this window." },
  ];
}

const IPC_CAMPAIGNS: SalesCampaignRow[] = [
  {
    id: "onsale",
    name: "[NX26-IPC] On Sale — Adv+",
    status: "spending",
    statusLabel: "Spending",
    periodSpend: "£1,120",
    sinceLaunch: null,
    title: "£1,120 in 14 days. Still spending on 12 Nov.",
  },
  {
    id: "presale",
    name: "[NX26-IPC] Presale",
    status: "stopped",
    statusLabel: "Stopped 6 Nov",
    periodSpend: "£0",
    sinceLaunch: "£1,980 since launch",
    title: "£0 in 14 days. £1,980 since launch. Stopped 6 Nov.",
  },
  {
    id: "tagged",
    name: "[NX26-IPC] Stories — tagged only",
    status: "unlinked",
    statusLabel: "Not linked to event",
    periodSpend: "£80",
    sinceLaunch: null,
    title: "Tagged NX26-IPC. Not linked to the event. £80 in 14 days.",
  },
];

function ipcView(): SalesShowView {
  return {
    title: "Interplanetary Criminal · NX Newcastle",
    narrowTitle: "IPC · NX Newcastle",
    subtitle: "Sat 21 Nov · allocation 1,500",
    narrowSubtitle: "Sat 21 Nov · allocation 1,500",
    umbrellaLine: "Separate NX umbrella spend £640",
    tiles: ipcTiles(),
    endDay: "2026-11-12",
    points: ipcPoints(),
    allocation: IPC_ALLOCATION,
    trajectory: {
      kind: "single",
      wideRange: "Projected on show day: 1,012–1,390 of 1,500 · needed 77 a day · 488 short at this pace",
      narrowRange: "1,012–1,390 of 1,500 on show day",
      narrowNote: "Needed 77 a day · 488 short at this pace.",
      showDay: "21 Nov",
      allocation: 1500,
      sold: 812,
      cases: [
        { id: "holds", label: "Holds", value: 1012 },
        { id: "average", label: "Like your average finish ×2.1", value: 1130 },
        { id: "best", label: "Like your best finish ×3.32", value: 1390 },
      ],
      opensAfter: null,
      libraryNote: LIBRARY_NOTE,
      missingCapacity: null,
    },
    campaigns: IPC_CAMPAIGNS,
  };
}

function robbieView(): SalesShowView {
  const view = ipcView();
  return {
    ...view,
    title: "Robbie Doherty · NX Newcastle",
    narrowTitle: "Robbie · NX Newcastle",
    subtitle: "Fri 27 Nov · allocation 1,500",
    narrowSubtitle: "Fri 27 Nov · allocation 1,500",
    umbrellaLine: "Separate NX umbrella spend £640",
    trajectory: {
      kind: "single",
      wideRange: "Projected on show day: 870–1,320 of 1,500",
      narrowRange: "870–1,320 of 1,500 on show day",
      narrowNote: null,
      showDay: "27 Nov",
      allocation: 1500,
      sold: 600,
      cases: [
        { id: "holds", label: "Holds", value: 870 },
        { id: "average", label: "Like your average finish ×2.1", value: 1100 },
        { id: "best", label: "Like your best finish ×3.32", value: 1320 },
      ],
      opensAfter: null,
      libraryNote: LIBRARY_NOTE,
      missingCapacity: null,
    },
    campaigns: [
      {
        id: "robbie-onsale",
        name: "[NX26-RD] On Sale",
        status: "spending",
        statusLabel: "Spending",
        periodSpend: "£860",
        sinceLaunch: null,
        title: "£860 in 14 days.",
      },
    ],
  };
}

function dodView(): SalesShowView {
  const view = ipcView();
  return {
    ...view,
    title: "DOD · NX Newcastle",
    narrowTitle: "DOD · NX Newcastle",
    subtitle: "Fri 4 Dec · allocation 1,500",
    narrowSubtitle: "Fri 4 Dec · allocation 1,500",
    trajectory: {
      kind: "single",
      wideRange: "Projected on show day: 1,280–1,500 of 1,500",
      narrowRange: "1,280–1,500 of 1,500 on show day",
      narrowNote: null,
      showDay: "4 Dec",
      allocation: 1500,
      sold: 915,
      cases: [
        { id: "holds", label: "Holds", value: 1280 },
        { id: "average", label: "Like your average finish ×2.1", value: 1400 },
        { id: "best", label: "Like your best finish ×3.32", value: 1500 },
      ],
      opensAfter: null,
      libraryNote: LIBRARY_NOTE,
      missingCapacity: null,
    },
    campaigns: [
      {
        id: "dod-onsale",
        name: "[NX26-DOD] On Sale",
        status: "spending",
        statusLabel: "Spending",
        periodSpend: "£740",
        sinceLaunch: null,
        title: "£740 in 14 days.",
      },
    ],
  };
}

function lockleadView(): SalesShowView {
  const view = ipcView();
  return {
    ...view,
    title: "Locklead · NX Newcastle",
    narrowTitle: "Locklead · NX Newcastle",
    subtitle: "Fri 11 Dec",
    narrowSubtitle: "Fri 11 Dec",
    tiles: view.tiles.map((tile) => ({
      ...tile,
      value: "—",
      detail: tile.id === "sold" ? NO_TICKET_COUNTS : "—",
      narrowDetail: tile.id === "sold" ? NO_TICKET_COUNTS : "—",
    })),
    allocation: [],
    trajectory: {
      kind: "single",
      wideRange: MISSING_CAPACITY,
      narrowRange: MISSING_CAPACITY,
      narrowNote: null,
      showDay: "11 Dec",
      allocation: null,
      sold: null,
      cases: [],
      opensAfter: null,
      libraryNote: null,
      missingCapacity: MISSING_CAPACITY,
    },
    campaigns: [],
  };
}

function umbrellaView(): SalesShowView {
  const view = ipcView();
  return {
    ...view,
    title: "NX umbrella",
    narrowTitle: "NX umbrella",
    subtitle: "Not in All shows",
    narrowSubtitle: "Not in All shows",
    umbrellaLine: null,
    tiles: view.tiles.map((tile) =>
      tile.id === "spend"
        ? { ...tile, value: "£640", detail: "Separate from the shows", narrowDetail: "Separate from the shows" }
        : { ...tile, value: "—", detail: "Not in All shows", narrowDetail: "Not in All shows" },
    ),
    allocation: [],
    trajectory: {
      kind: "single",
      wideRange: "Not in All shows.",
      narrowRange: "Not in All shows.",
      narrowNote: null,
      showDay: null,
      allocation: null,
      sold: null,
      cases: [],
      opensAfter: null,
      libraryNote: null,
      missingCapacity: null,
    },
    campaigns: [
      {
        id: "umbrella",
        name: "NX umbrella",
        status: "spending",
        statusLabel: "Spending",
        periodSpend: "£640",
        sinceLaunch: null,
        title: "£640. Kept out of All shows.",
      },
    ],
  };
}

function quietLibraryView(): SalesShowView {
  const view = ipcView();
  return {
    ...view,
    title: "A first show · NX Newcastle",
    narrowTitle: "First show",
    subtitle: "Sat 21 Nov · allocation 1,500",
    narrowSubtitle: "Sat 21 Nov · allocation 1,500",
    trajectory: {
      kind: "single",
      wideRange: "Projected on show day: 1,012 of 1,500",
      narrowRange: "1,012 of 1,500 on show day",
      narrowNote: null,
      showDay: "21 Nov",
      allocation: 1500,
      sold: 812,
      cases: [{ id: "holds", label: "Holds", value: 1012 }],
      opensAfter: LIBRARY_OPENS,
      libraryNote: null,
      missingCapacity: null,
    },
  };
}

export const NX_SALES_FIXTURE: SalesDashboardModel = {
  clientName: "NX Newcastle",
  freshness: [
    { id: "counts", wide: "Counts to 12 Nov", narrow: "Counts 12 Nov", stale: false },
    { id: "spend", wide: "Spend to 12 Nov", narrow: "Spend 12 Nov", stale: false },
    { id: "signups", wide: "Signups to 9 Nov", narrow: "Signups 9 Nov", stale: true },
  ],
  shows: [
    { id: "all", wide: "All shows", narrow: "All", kind: "all", finished: false },
    { id: "ipc", wide: "IPC · 21 Nov", narrow: "IPC", kind: "show", finished: false },
    { id: "robbie", wide: "Robbie Doherty · 27 Nov", narrow: "Robbie", kind: "show", finished: false },
    { id: "dod", wide: "DOD · 4 Dec", narrow: "DOD", kind: "show", finished: false },
    { id: "locklead", wide: "Locklead · 11 Dec", narrow: "Locklead", kind: "show", finished: false },
    { id: "umbrella", wide: "NX umbrella", narrow: "Umbrella", kind: "umbrella", finished: false },
  ],
  finishedShows: [{ id: "djez", wide: "DJ EZ · 2 Oct", narrow: "DJ EZ", kind: "show", finished: true }],
  initialShowId: "ipc",
  initialPeriod: "14",
  crossClientNote: null,
  reviewLine: null,
  views: {
    all: {
      title: "All shows · NX Newcastle",
      narrowTitle: "All shows",
      subtitle: "3 shows with a capacity · Locklead left out",
      narrowSubtitle: "3 shows · Locklead left out",
      umbrellaLine: "Separate NX umbrella spend £640",
      tiles: ipcTiles(),
      endDay: "2026-11-12",
      points: ipcPoints(),
      allocation: [],
      trajectory: {
        kind: "all",
        wideRange: "Projected on show day: 3,162–4,210 of 4,500 across 3 shows (Locklead has no capacity; umbrella excluded)",
        narrowRange: "3,162–4,210 of 4,500 on show day",
        bars: [
          { id: "ipc", label: "IPC", sold: 812, low: 1012, high: 1390, allocation: 1500, caption: "812 · 1,012–1,390" },
          { id: "robbie", label: "Robbie Doherty", sold: 600, low: 870, high: 1320, allocation: 1500, caption: "600 · 870–1,320" },
          { id: "dod", label: "DOD", sold: 915, low: 1280, high: 1500, allocation: 1500, caption: "915 · 1,280–1,500" },
          { id: "locklead", label: "Locklead", sold: null, low: null, high: null, allocation: null, caption: MISSING_CAPACITY_SHORT },
        ],
        note: ALL_NOTE,
      },
      campaigns: IPC_CAMPAIGNS,
    },
    ipc: ipcView(),
    robbie: robbieView(),
    dod: dodView(),
    locklead: lockleadView(),
    umbrella: umbrellaView(),
    djez: {
      ...ipcView(),
      title: "DJ EZ · NX Newcastle",
      narrowTitle: "DJ EZ · NX Newcastle",
      subtitle: "Fri 2 Oct · finished",
      narrowSubtitle: "Fri 2 Oct · finished",
    },
    quiet: quietLibraryView(),
  },
};

export const NX_SHARE_FIXTURE_TOKEN = "nx-12-nov";
