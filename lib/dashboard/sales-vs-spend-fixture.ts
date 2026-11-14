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
  type SalesTotal,
} from "./sales-vs-spend.ts";
import { buildSalesDashboard } from "./sales-calc/model.ts";
import { LIVE_LIKE_INPUT, LIVE_LIKE_MIXED_INPUT } from "./sales-live-like-input.ts";

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
    const count = day === "2026-11-05" || day === "2026-11-12";
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
    points.push({ day, estimated, count, estimateNote: estimated ? ESTIMATE : null, values });
  }
  return points;
}

const IPC_ALLOCATION: AllocationStep[] = [
  { day: "2026-10-30", value: 1000 },
  { day: "2026-11-03", value: 1200 },
  { day: "2026-11-09", value: 1500 },
];

function allPoints(): SalesChartPoint[] {
  return ipcPoints().map((point) => ({
    ...point,
    values: {
      spend: Math.round((point.values.spend ?? 0) * (4730 / 2060)),
      sold: Math.round((point.values.sold ?? 0) * (2327 / 812)),
      tickets: Math.round((point.values.tickets ?? 0) * (454 / 146)),
      costPerTicket: 10.42,
      checkoutActions: Math.round((point.values.checkoutActions ?? 0) * (938 / 388)),
      costPerCheckout: 5.04,
      lpv: Math.round((point.values.lpv ?? 0) * (3090 / 1240)),
      costPerLpv: 1.53,
      clicks: Math.round((point.values.clicks ?? 0) * (9840 / 4180)),
      cpc: 0.48,
    },
  }));
}

function allTiles(): SalesTile[] {
  return [
    { id: "spend", value: "£4,730", detail: "Meta £4,210 · TikTok £520 · of £9,840 since launch", narrowDetail: "Meta £4,210 · TikTok £520", title: "Meta £4,210 · TikTok £520 across the shows with counts. Umbrella is separate." },
    { id: "sold", value: "2,327", detail: "Internal Counts, 12 Nov", narrowDetail: "Internal Counts, 12 Nov", title: "812 + 600 + 915. Locklead has no counts." },
    { id: "tickets", value: "454", detail: "in 14 days", narrowDetail: "14 days", title: "Tickets across the shows with counts." },
    { id: "costPerTicket", value: "£10.42", detail: "blended · complete windows", narrowDetail: "blended", title: "Spend over tickets, the shows with counts." },
    { id: "checkoutActions", value: "938", detail: "£5.04 each", narrowDetail: "£5.04 each", title: "Checkouts and add-to-carts. One person can do both." },
    { id: "costPerCheckout", value: "£5.04", detail: "938 actions", narrowDetail: "938 actions", title: "Checkouts and add-to-carts. One person can do both." },
    { id: "lpv", value: "3,090", detail: "in 14 days", narrowDetail: "14 days", title: "Landing page views across the shows with counts." },
    { id: "costPerLpv", value: "£1.53", detail: "3,090 views", narrowDetail: "3,090 views", title: "Spend divided by landing page views." },
    { id: "clicks", value: "9,840", detail: "in 14 days", narrowDetail: "14 days", title: "Clicks across the shows with counts." },
    { id: "cpc", value: "£0.48", detail: "blended", narrowDetail: "blended", title: "Spend divided by clicks." },
    { id: "registrations", value: "—", detail: "signups closed at on-sale", narrowDetail: "signups closed", title: "Signups closed when the shows went on sale." },
    { id: "costPerRegistration", value: "—", detail: "signups closed at on-sale", narrowDetail: "signups closed", title: "No signup days in this window." },
  ];
}

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
    delivery: "Spending",
    unlinked: false,
    periodSpend: "£1,120",
    sinceLaunch: "£3,350",
    title: "£1,120 in 14 days. £3,350 since launch. Still spending on 12 Nov.",
  },
  {
    id: "presale",
    name: "[NX26-IPC] Presale",
    delivery: "Stopped 6 Nov",
    unlinked: false,
    periodSpend: "£0",
    sinceLaunch: "£1,980",
    title: "£0 in 14 days. £1,980 since launch. Stopped 6 Nov.",
  },
  {
    id: "tagged",
    name: "[NX26-IPC] Stories — tagged only",
    delivery: "Spending",
    unlinked: true,
    periodSpend: "£80",
    sinceLaunch: "£80",
    title: "Tagged NX26-IPC. £80 in 14 days. £80 since launch.",
  },
];

const IPC_PATH = {
  showDayIso: "2026-11-21",
  counts: [
    { day: "2026-11-05", sold: 719 },
    { day: "2026-11-12", sold: 812 },
  ],
  pace: {
    fromDay: "2026-11-05",
    fromSold: 719,
    toDay: "2026-11-12",
    toSold: 812,
    fanDay: "2026-11-14",
    fanSold: 839,
  },
  needed: { showDaySold: 1500 },
};

const NO_PATH = {
  showDayIso: null,
  counts: [],
  pace: null,
  needed: null,
};

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
      ...IPC_PATH,
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
      showDayIso: "2026-11-27",
      counts: [
        { day: "2026-11-05", sold: 520 },
        { day: "2026-11-12", sold: 600 },
      ],
      pace: { fromDay: "2026-11-05", fromSold: 520, toDay: "2026-11-12", toSold: 600, fanDay: "2026-11-20", fanSold: 680 },
      needed: { showDaySold: 1500 },
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
        delivery: "Spending",
        unlinked: false,
        periodSpend: "£860",
        sinceLaunch: "£2,140",
        title: "£860 in 14 days. £2,140 since launch.",
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
      showDayIso: "2026-12-04",
      counts: [
        { day: "2026-11-05", sold: 840 },
        { day: "2026-11-12", sold: 915 },
      ],
      pace: { fromDay: "2026-11-05", fromSold: 840, toDay: "2026-11-12", toSold: 915, fanDay: "2026-11-27", fanSold: 1060 },
      needed: { showDaySold: 1500 },
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
        delivery: "Spending",
        unlinked: false,
        periodSpend: "£740",
        sinceLaunch: "£1,860",
        title: "£740 in 14 days. £1,860 since launch.",
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
      ...NO_PATH,
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

const NX_LAUNCH: SalesTotal = {
  scope: "NX Newcastle",
  amount: 9840,
  text: "£9,840",
  channels: [
    { platform: "meta", label: "Meta", amount: 4210, text: "£4,210" },
    { platform: "tiktok", label: "TikTok", amount: 520, text: "£520" },
  ],
  parts: [
    {
      id: "ipc",
      label: "Interplanetary Criminal",
      amount: 5410,
      text: "£5,410",
      channels: [
        { platform: "meta", label: "Meta", amount: 1840, text: "£1,840" },
        { platform: "tiktok", label: "TikTok", amount: 220, text: "£220" },
      ],
    },
  ],
  headline: "£9,840 since launch · to 12 Nov",
  notIncluded: "Not in this total: NX Newcastle umbrella £640. Finished shows (Include finished adds them).",
};

const NX_WINDOW: SalesTotal = {
  scope: "NX Newcastle",
  amount: 4730,
  text: "£4,730",
  channels: [
    { platform: "meta", label: "Meta", amount: 4210, text: "£4,210" },
    { platform: "tiktok", label: "TikTok", amount: 520, text: "£520" },
  ],
  parts: [
    {
      id: "ipc",
      label: "Interplanetary Criminal",
      amount: 2060,
      text: "£2,060",
      channels: [
        { platform: "meta", label: "Meta", amount: 1840, text: "£1,840" },
        { platform: "tiktok", label: "TikTok", amount: 220, text: "£220" },
      ],
    },
  ],
  headline: "£4,730 in 14 days · to 12 Nov",
  notIncluded: "Not in this total: NX Newcastle umbrella £640. Finished shows (Include finished adds them).",
};

const ALL_VENUES_LAUNCH: SalesTotal = {
  ...NX_LAUNCH,
  scope: "All venues",
  parts: [{ id: "venue:nx newcastle", label: "NX Newcastle", amount: 9840, text: "£9,840", channels: NX_LAUNCH.channels }],
};

const NX_HEADER = {
  sentence:
    "NX Newcastle to date: £9,840 spend since launch, 2,327 tickets sold across 3 shows (Internal Counts, 12 Nov), so £4.23 of spend per ticket. Separate NX Newcastle umbrella spend: £640.",
  channelLine: "Meta £4,210 · TikTok £520 · to 12 Nov · finished shows not included",
};

const ALL_VENUES_HEADER = {
  sentence:
    "NX Newcastle to date, 2 venues: £9,840 spend since launch. 2,327 tickets sold on the 3 shows with counts (Internal Counts, 12 Nov), so £4.23 of spend per ticket on those shows. Separate umbrella spend: NX Newcastle £640.",
  channelLine: "Meta £4,210 · TikTok £520 · to 12 Nov · finished shows not included",
};

function allTrajectory(): SalesShowView["trajectory"] {
  return {
    kind: "all",
    wideRange: "Projected on show day: 3,162–4,210 of 4,500 across 3 shows (Locklead has no capacity; umbrella excluded)",
    narrowRange: "3,162–4,210 of 4,500 on show day",
    bars: [
      { id: "ipc", label: "IPC · 21 Nov", sold: 812, low: 1012, high: 1390, allocation: 1500, caption: "812 · 1,012–1,390", sellsOut: null },
      { id: "robbie", label: "Robbie Doherty · 27 Nov", sold: 600, low: 870, high: 1320, allocation: 1500, caption: "600 · 870–1,320", sellsOut: null },
      { id: "dod", label: "DOD · 4 Dec", sold: 915, low: 1280, high: 1500, allocation: 1500, caption: "915 · 1,280–1,500", sellsOut: "best" },
      { id: "locklead", label: "Locklead · 11 Dec", sold: null, low: null, high: null, allocation: null, caption: MISSING_CAPACITY_SHORT, sellsOut: null },
    ],
    note: ALL_NOTE,
    summary: {
      sold: { label: "Sold · count of 12 Nov", value: "2,327", detail: "52% of 4,500 across 3 shows" },
      projected: { label: "Projected on show day", value: "3,162–4,210", detail: "up to 94% of 4,500 · each show capped at its capacity" },
      pace: { label: "Pace, last 7 days", value: "— a day", detail: "14-day — a day" },
    },
  };
}

function umbrellaView(): SalesShowView {
  const view = ipcView();
  return {
    ...view,
    title: "NX umbrella",
    narrowTitle: "NX umbrella",
    subtitle: "NX umbrella · not a show: no tickets and no trajectory",
    narrowSubtitle: "NX umbrella · not a show: no tickets and no trajectory",
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
      ...NO_PATH,
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
        delivery: "Spending",
        unlinked: false,
        periodSpend: "£640",
        sinceLaunch: "£640",
        title: "£640. Kept out of All shows.",
      },
    ],
    header: {
      sentence: "NX Newcastle umbrella to date: £640 spend since launch, kept out of every show total.",
      channelLine: "to 12 Nov",
    },
    spendTotal: {
      scope: "NX Newcastle umbrella",
      amount: 640,
      text: "£640",
      channels: [],
      parts: [],
      headline: "£640 since launch · to 12 Nov",
      notIncluded: null,
    },
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
      ...IPC_PATH,
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
  initialVenueViewId: "venue:nx newcastle",
  crossClientNote: null,
  reviewLine: null,
  venues: [
    {
      key: "nx newcastle",
      name: "NX Newcastle",
      liveShows: 3,
      viewId: "venue:nx newcastle",
      shows: [
        { id: "venue:nx newcastle", wide: "All shows", narrow: "All", kind: "all", finished: false },
        { id: "ipc", wide: "IPC · 21 Nov", narrow: "IPC", kind: "show", finished: false },
        { id: "robbie", wide: "Robbie Doherty · 27 Nov", narrow: "Robbie", kind: "show", finished: false },
        { id: "dod", wide: "DOD · 4 Dec", narrow: "DOD", kind: "show", finished: false },
        { id: "umbrella", wide: "NX umbrella", narrow: "Umbrella", kind: "umbrella", finished: false },
      ],
      finishedShows: [{ id: "djez", wide: "DJ EZ · 2 Oct", narrow: "DJ EZ", kind: "show", finished: true }],
    },
    {
      key: "electric bristol",
      name: "Electric Bristol",
      liveShows: 1,
      viewId: "locklead",
      shows: [{ id: "locklead", wide: "Locklead · 11 Dec", narrow: "Locklead", kind: "show", finished: false }],
      finishedShows: [],
    },
  ],
  views: {
    all: {
      title: "All venues · NX Newcastle",
      narrowTitle: "All venues",
      subtitle: "3 shows with a capacity · Locklead left out",
      narrowSubtitle: "3 shows · Locklead left out",
      umbrellaLine: "Separate NX umbrella spend £640",
      tiles: allTiles(),
      endDay: "2026-11-12",
      points: allPoints(),
      allocation: [],
      trajectory: allTrajectory(),
      campaigns: IPC_CAMPAIGNS,
      venueKey: null,
      header: ALL_VENUES_HEADER,
      spendTotal: ALL_VENUES_LAUNCH,
      periods: {
        "14": { tiles: allTiles(), campaigns: IPC_CAMPAIGNS, spendTotal: { ...NX_WINDOW, scope: "All venues" } },
      },
    },
    "venue:nx newcastle": {
      title: "All shows · NX Newcastle",
      narrowTitle: "All shows",
      subtitle: "3 shows with a capacity · Locklead left out",
      narrowSubtitle: "3 shows · Locklead left out",
      umbrellaLine: "Separate NX umbrella spend £640",
      tiles: allTiles(),
      endDay: "2026-11-12",
      points: allPoints(),
      allocation: [],
      trajectory: allTrajectory(),
      campaigns: IPC_CAMPAIGNS,
      venueKey: "nx newcastle",
      header: NX_HEADER,
      spendTotal: NX_LAUNCH,
      periods: {
        "14": { tiles: allTiles(), campaigns: IPC_CAMPAIGNS, spendTotal: NX_WINDOW },
      },
    },
    ipc: {
      ...ipcView(),
      header: {
        sentence: "Interplanetary Criminal to date: £5,410 spend since launch, 812 tickets sold (Internal Counts, 12 Nov), so £6.66 per ticket.",
        channelLine: "Meta £1,840 · TikTok £220 · to 12 Nov",
      },
      spendTotal: {
        scope: "Interplanetary Criminal",
        amount: 5410,
        text: "£5,410",
        channels: [
          { platform: "meta", label: "Meta", amount: 1840, text: "£1,840" },
          { platform: "tiktok", label: "TikTok", amount: 220, text: "£220" },
        ],
        parts: [],
        headline: "£5,410 since launch · to 12 Nov",
        notIncluded: "Not in this total: NX Newcastle umbrella £640.",
      },
      periods: {
        "14": {
          tiles: ipcTiles(),
          campaigns: IPC_CAMPAIGNS,
          spendTotal: {
            scope: "Interplanetary Criminal",
            amount: 2060,
            text: "£2,060",
            channels: [
              { platform: "meta", label: "Meta", amount: 1840, text: "£1,840" },
              { platform: "tiktok", label: "TikTok", amount: 220, text: "£220" },
            ],
            parts: [],
            headline: "£2,060 in 14 days · to 12 Nov",
            notIncluded: "Not in this total: NX Newcastle umbrella £640.",
          },
        },
      },
    },
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

/**
 * Live-like (dashboard v2 on a phone): the real calc over invented rows shaped
 * like the live NX data on 14 Nov (lib/dashboard/sales-live-like-input.ts),
 * so the header, tiles, chart, stamps and campaigns can't disagree (design's
 * note on #1232). Four venue options, eight NX shows with their real long
 * names, a five-figure spend. NX_SALES_FIXTURE and its DV/NV frames are
 * unchanged.
 */
export const NX_SALES_LIVE_LIKE: SalesDashboardModel = buildSalesDashboard(LIVE_LIKE_INPUT).model;

/** The same rows with one show last counted a day earlier: the longest header sentence, for MB1's guard. */
export const NX_SALES_LIVE_LIKE_MIXED: SalesDashboardModel = buildSalesDashboard(LIVE_LIKE_MIXED_INPUT).model;
