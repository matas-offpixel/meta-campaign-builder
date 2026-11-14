import type { SalesPeriod, SalesSurface } from "@/lib/dashboard/sales-vs-spend";

/** DV1–DV3 stay on 14 days. NV1–NV6 are the record's Since-launch frames. Widths live in the shots file. */
/** MBO / MBS: the live-like fixture (MB1), internal and share, for the overflow shots and the 320–430 px overflow guard. */
export const DASHBOARD_V2_FRAME_IDS = ["DV1", "DV2", "DV3", "NV1", "NV2", "NV5", "NV6", "MBO", "MBS"] as const;

export type DashboardV2FrameId = (typeof DASHBOARD_V2_FRAME_IDS)[number];

export const DASHBOARD_V2_FRAMES: Record<
  DashboardV2FrameId,
  { surface: SalesSurface; showId: string; period: SalesPeriod; pinHover?: boolean; pinSpend?: boolean; venueKey?: string; fixture?: "live" }
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
};
