import type { SalesPeriod, SalesSurface } from "@/lib/dashboard/sales-vs-spend";

/** DV1–DV3 stay on 14 days. NV1–NV6 are the record's Since-launch frames. Widths live in the shots file. */
/** MBO / MBS: the live-like fixture (MB1), internal and share, for the overflow shots and the 320–430 px overflow guard. */
/**
 * MBF375/390/430 … MB14: the phone layout (HMB2, HMB3) on the live-like fixture, share link.
 * A fold frame draws the record's first-screen line at its width's budget.
 */
export const DASHBOARD_V2_FRAME_IDS = [
  "DV1", "DV2", "DV3", "NV1", "NV2", "NV5", "NV6", "MBO", "MBS",
  "MBF375", "MBF390", "MBF430", "MBM", "MBA", "MBC", "MBH1", "MBH2", "MB14",
] as const;

export type DashboardV2FrameId = (typeof DASHBOARD_V2_FRAME_IDS)[number];

export const DASHBOARD_V2_FRAMES: Record<
  DashboardV2FrameId,
  {
    surface: SalesSurface;
    showId: string;
    period: SalesPeriod;
    pinHover?: boolean;
    pinSpend?: boolean;
    venueKey?: string;
    fixture?: "live";
    /** The first-screen line: the record's budget for this width (MB2). */
    fold?: { width: number; height: number };
    moreOpen?: boolean;
    holdDay?: string;
    chartOpenAt?: string;
  }
> = {
  DV1: { surface: "internal", showId: "ipc", period: "14" },
  DV2: { surface: "internal", showId: "venue:nx newcastle", period: "14" },
  DV3: { surface: "share", showId: "ipc", period: "14" },
  /** NV1 at 1280 and NV3 at 393: the default venue, Since launch. */
  NV1: { surface: "internal", showId: "venue:nx newcastle", period: "launch" },
  /** NV2 at 1280 and NV4 at 393: the chart, with the hover card pinned on the last day. */
  NV2: { surface: "internal", showId: "venue:nx newcastle", period: "launch", pinHover: true },
  /** NV5: All venues, with the spend breakdown pinned open. */
  NV5: { surface: "internal", showId: "all", period: "launch", pinSpend: true, venueKey: "all" },
  NV6: { surface: "internal", showId: "umbrella", period: "launch" },
  /** MB1: NX Newcastle, Since launch, on the live-like fixture (nine long show names, four venue options). */
  MBO: { surface: "internal", showId: "venue:nx newcastle", period: "launch", fixture: "live" },
  MBS: { surface: "share", showId: "venue:nx newcastle", period: "launch", fixture: "live" },
  /** MBV1 / MBV2 and 390: the first screen, with the fold at 375×548, 390×664 and 430×739. */
  MBF375: { surface: "share", showId: "venue:nx newcastle", period: "launch", fixture: "live", fold: { width: 375, height: 548 } },
  MBF390: { surface: "share", showId: "venue:nx newcastle", period: "launch", fixture: "live", fold: { width: 390, height: 664 } },
  MBF430: { surface: "share", showId: "venue:nx newcastle", period: "launch", fixture: "live", fold: { width: 430, height: 739 } },
  /** MBV4: More figures open. */
  MBM: { surface: "share", showId: "venue:nx newcastle", period: "launch", fixture: "live", moreOpen: true },
  /** All venues: the one grouped scrolling row. */
  MBA: { surface: "share", showId: "all", period: "launch", fixture: "live", venueKey: "all" },
  /** MBV3a: the chart as it opens, on the latest day. */
  MBC: { surface: "share", showId: "venue:nx newcastle", period: "launch", fixture: "live" },
  /** MBV3b: swiped to earlier dates, holding on 30 Sep (a count day) and on 3 Oct (between counts). */
  MBH1: { surface: "share", showId: "venue:nx newcastle", period: "launch", fixture: "live", holdDay: "2026-09-30", chartOpenAt: "2026-09-30" },
  MBH2: { surface: "share", showId: "venue:nx newcastle", period: "launch", fixture: "live", holdDay: "2026-10-03", chartOpenAt: "2026-10-03" },
  /** 14 days: no scroller. */
  MB14: { surface: "share", showId: "venue:nx newcastle", period: "14", fixture: "live" },
};
