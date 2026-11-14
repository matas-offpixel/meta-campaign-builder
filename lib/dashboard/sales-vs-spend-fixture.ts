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
 * Live-like (dashboard v2 on a phone, MB1): the widest rows the live NX page
 * has. Four venue options, nine shows with their real long names, a
 * five-figure spend, and the longest header sentence (the "each show's last
 * count" clause). The overflow guard and the MB overflow frames mount it;
 * NX_SALES_FIXTURE and its DV/NV frames are unchanged.
 */
const LIVE_NX_SHOWS: { id: string; name: string; day: string }[] = [
  { id: "ipc", name: "Interplanetary Criminal", day: "21 Nov" },
  { id: "robbie", name: "Robbie Doherty", day: "27 Nov" },
  { id: "dod", name: "D.O.D", day: "4 Dec" },
  { id: "locklead", name: "Locklead", day: "11 Dec" },
  { id: "rudimental", name: "Rudimental", day: "12 Dec" },
  { id: "schak", name: "Schak", day: "18 Dec" },
  { id: "ewan", name: "Ewan McVicar", day: "26 Feb" },
  { id: "julian", name: "Julian Fijma", day: "19 Mar" },
  { id: "eed", name: "East End Dubs", day: "13 Nov" },
];

const LIVE_NX_CHIPS: SalesDashboardModel["shows"] = [
  { id: "venue:nx newcastle", wide: "All shows", narrow: "All", kind: "all", finished: false },
  ...LIVE_NX_SHOWS.map((s) => ({ id: s.id, wide: `${s.name} · ${s.day}`, narrow: s.name, kind: "show" as const, finished: false })),
  { id: "umbrella", wide: "Umbrella", narrow: "Umbrella", kind: "umbrella" as const, finished: false },
];

const LIVE_LAUNCH: SalesTotal = {
  ...NX_LAUNCH,
  amount: 14216,
  text: "£14,216",
  channels: [
    { platform: "meta", label: "Meta", amount: 14078, text: "£14,078" },
    { platform: "tiktok", label: "TikTok", amount: 119, text: "£119" },
    { platform: "google", label: "Google", amount: 19, text: "£19" },
  ],
  headline: "£14,216 since launch · to 13 Nov",
  notIncluded: "Not in this total: NX Newcastle umbrella £4,309. Finished shows (Include finished adds them).",
};


/**
 * The live-like NX Newcastle view for the phone frames (MBV1–MBV4): the
 * record's live figures from the #1230 preview at 160e017 (14 Nov), and a
 * since-launch series long enough for the phone's 30-day scroller. The line
 * shape is schematic, as in the record; count days are the real NX ones.
 */
const LIVE_COUNT_DAYS = new Set([
  "2026-09-11", "2026-09-14", "2026-09-17", "2026-09-18", "2026-09-22", "2026-09-24", "2026-09-30",
  "2026-10-01", "2026-10-05", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14",
  "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28",
  "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06",
  "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12",
]);
const LIVE_SOLD_ANCHORS: [string, number][] = [
  ["2026-09-11", 3300],
  ["2026-09-30", 4173],
  ["2026-10-23", 5170],
  ["2026-11-12", 6795],
];

function liveDay(i: number): string {
  return new Date(Date.parse("2026-08-14T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
}

function liveSold(day: string): number | null {
  if (day < LIVE_SOLD_ANCHORS[0][0]) return null;
  for (let k = 1; k < LIVE_SOLD_ANCHORS.length; k++) {
    const [d0, v0] = LIVE_SOLD_ANCHORS[k - 1];
    const [d1, v1] = LIVE_SOLD_ANCHORS[k];
    if (day <= d1) {
      const t = (Date.parse(day) - Date.parse(d0)) / (Date.parse(d1) - Date.parse(d0));
      return Math.round(v0 + (v1 - v0) * t);
    }
  }
  return LIVE_SOLD_ANCHORS[LIVE_SOLD_ANCHORS.length - 1][1];
}

function livePoints(): SalesChartPoint[] {
  const days = Array.from({ length: 91 }, (_, i) => liveDay(i));
  const counts = days.filter((d) => LIVE_COUNT_DAYS.has(d));
  return days.map((day, i) => {
    const count = LIVE_COUNT_DAYS.has(day);
    const prev = counts.filter((d) => d < day).pop() ?? null;
    const next = counts.find((d) => d > day) ?? null;
    const estimated = !count && prev != null && next != null;
    const spend = day === "2026-09-30" ? 164 : Math.round(60 + i * 2.6 + (i % 7 === 3 ? 40 : 0));
    const sold = liveSold(day);
    return {
      day,
      count,
      estimated,
      estimateNote: estimated ? `Estimated between counts on ${shortLabel(prev!)} and ${shortLabel(next!)}` : null,
      values: {
        spend,
        sold: sold ?? undefined,
        tickets: sold == null ? undefined : 40 + (i % 5) * 6,
        costPerTicket: sold == null ? undefined : 2.08,
        checkoutActions: 18 + (i % 9),
        costPerCheckout: 5.26,
        lpv: 380 + i * 3,
        costPerLpv: 0.31,
        clicks: 470 + i * 4,
        cpc: 0.25,
      },
    };
  });
}

function shortLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

function liveTiles(): SalesTile[] {
  return [
    { id: "spend", value: "£14,216", detail: "NX Newcastle · Meta £14,078 · TikTok £119 · Google £19", narrowDetail: "Meta £14,078 · TikTok £119 · Google £19", title: "" },
    { id: "sold", value: "6,795", detail: "to date · Internal Counts, 12 Nov · 7 shows", narrowDetail: "to date · Internal Counts, 12 Nov", title: "" },
    { id: "tickets", value: "6,795", detail: "since launch, to 12 Nov", narrowDetail: "since launch", title: "" },
    {
      id: "costPerTicket",
      value: "£2.08",
      detail: "since launch · the 7 shows with counts",
      narrowDetail: "since launch · blended",
      title: "All channels' spend to each show's latest count, over tickets sold, on spend to the 12 Nov count.",
    },
    { id: "checkoutActions", value: "2,674", detail: "since launch · actions, one person can do both", narrowDetail: "since launch · actions", title: "" },
    { id: "costPerCheckout", value: "£5.26", detail: "since launch", narrowDetail: "since launch", title: "Meta spend divided by checkouts and add-to-carts." },
    { id: "lpv", value: "46,023", detail: "since launch", narrowDetail: "since launch", title: "Landing page views on Meta." },
    { id: "costPerLpv", value: "£0.31", detail: "since launch", narrowDetail: "since launch", title: "Meta spend divided by landing page views." },
    { id: "clicks", value: "57,144", detail: "since launch", narrowDetail: "since launch", title: "Link clicks on Meta." },
    { id: "cpc", value: "£0.25", detail: "since launch", narrowDetail: "since launch", title: "Meta spend divided by clicks." },
    { id: "registrations", value: "4,276", detail: "to date · signup pages close at on-sale", narrowDetail: "to date", title: "" },
    { id: "costPerRegistration", value: "£1.24", detail: "show pages, inside their signup windows", narrowDetail: "show pages", title: "" },
  ];
}

function liveTrajectory(): SalesShowView["trajectory"] {
  const bar = (id: string, label: string, sold: number | null, low: number | null, high: number | null, caption: string, sellsOut: "holds" | null = null) => ({
    id,
    label,
    sold,
    low,
    high,
    allocation: 2000,
    caption,
    sellsOut,
  });
  return {
    kind: "all",
    wideRange: "Projected on show day: 9,540–10,796 of 14,000 across 7 shows (Ewan McVicar has no ticket counts yet; umbrella excluded)",
    narrowRange: "9,540–10,796 of 14,000 on show day",
    bars: [
      bar("ipc", "Interplanetary Criminal · 21 Nov", 1828, 1867, 1972, "1,828 → 1,867–1,972"),
      bar("robbie", "Robbie Doherty · 27 Nov", 497, 677, 972, "497 → 677–972"),
      bar("dod", "D.O.D · 4 Dec", 932, 1051, 1185, "932 → 1,051–1,185"),
      bar("locklead", "Locklead · 11 Dec", 372, 1078, 1677, "372 → 1,078–1,677"),
      bar("rudimental", "Rudimental · 12 Dec", 717, 867, 990, "717 → 867–990"),
      bar("schak", "Schak · 18 Dec", 1870, 2000, 2000, "1,870 → sells out at this pace", "holds"),
      bar("ewan", "Ewan McVicar · 26 Feb", null, null, null, "No ticket counts yet"),
      bar("julian", "Julian Fijma · 19 Mar", 579, 2000, 2000, "579 → sells out at this pace", "holds"),
    ],
    note: ALL_NOTE,
    summary: {
      sold: { label: "Sold · count of 12 Nov", value: "6,795", detail: "49% of 14,000 across 7 shows" },
      projected: { label: "Projected on show day", value: "9,540–10,796", detail: "up to 77% of 14,000 · each show capped at its capacity" },
      pace: { label: "Pace, last 7 days", value: "68.9 a day", detail: "14-day 121.7 a day" },
    },
  };
}

function liveCampaigns(): SalesCampaignRow[] {
  const shows = LIVE_NX_SHOWS.slice(0, 8);
  const kinds = ["On Sale — Adv+", "Presale", "Stories", "Retargeting"];
  const rows: SalesCampaignRow[] = [];
  for (const show of shows) {
    for (const kind of kinds) {
      if (rows.length >= 29) break;
      const spending = rows.filter((r) => r.delivery === "Spending").length < 7 && kind === "On Sale — Adv+";
      rows.push({
        id: `${show.id}-${kind}`,
        name: `[NX26-${show.id.toUpperCase()}] ${kind}`,
        delivery: spending ? "Spending" : "Stopped 6 Nov",
        unlinked: false,
        periodSpend: spending ? "£420" : "£0",
        sinceLaunch: spending ? "£1,980" : "£310",
        title: "",
      });
    }
  }
  return rows;
}

export const NX_SALES_LIVE_LIKE: SalesDashboardModel = {
  ...NX_SALES_FIXTURE,
  freshness: [
    { id: "counts", wide: "Counts to 12 Nov", narrow: "Counts 12 Nov", stale: false },
    { id: "spend", wide: "Spend to 13 Nov", narrow: "Spend 13 Nov", stale: false },
    { id: "signups", wide: "Signups to 13 Nov", narrow: "Signups 13 Nov", stale: false },
  ],
  shows: LIVE_NX_CHIPS,
  initialShowId: "venue:nx newcastle",
  venues: [
    { key: "nx newcastle", name: "NX Newcastle", liveShows: 9, viewId: "venue:nx newcastle", shows: LIVE_NX_CHIPS, finishedShows: NX_SALES_FIXTURE.finishedShows },
    {
      key: "electric bristol",
      name: "Electric Bristol",
      liveShows: 1,
      viewId: "locklead",
      shows: [{ id: "locklead", wide: "Locklead · 11 Dec", narrow: "Locklead", kind: "show", finished: false }],
      finishedShows: [],
    },
    {
      key: "electric studios",
      name: "Electric Studios",
      liveShows: 1,
      viewId: "dod",
      shows: [{ id: "dod", wide: "D.O.D · 4 Dec", narrow: "D.O.D", kind: "show", finished: false }],
      finishedShows: [],
    },
  ],
  views: {
    ...NX_SALES_FIXTURE.views,
    "venue:nx newcastle": {
      ...NX_SALES_FIXTURE.views["venue:nx newcastle"],
      header: {
        sentence:
          "NX Newcastle to date: £14,216 spend since launch, 6,795 tickets sold across 8 shows (Internal Counts, to 12 Nov), so £2.08 of spend per ticket, on spend to each show's last count (latest 12 Nov). Separate NX Newcastle umbrella spend: £4,309.",
        channelLine: "Meta £14,078 · TikTok £119 · Google £19 · to 13 Nov · finished shows not included",
      },
      spendTotal: LIVE_LAUNCH,
      tiles: liveTiles(),
      points: livePoints(),
      endDay: "2026-11-12",
      countDay: "2026-11-12",
      trajectory: liveTrajectory(),
      campaigns: liveCampaigns(),
      showCounts: { counted: 7, shows: 8 },
      periods: {
        ...NX_SALES_FIXTURE.views["venue:nx newcastle"].periods,
        launch: { tiles: liveTiles(), campaigns: liveCampaigns(), spendTotal: LIVE_LAUNCH },
      },
    },
  },
};
