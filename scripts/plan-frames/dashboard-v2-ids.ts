import type { SalesPeriod, SalesSurface } from "@/lib/dashboard/sales-vs-spend";

/** DV1–DV3 stay on 14 days. NV1, NV2 and NV6 are the record's Since-launch frames. Widths live in the shots file. */
export const DASHBOARD_V2_FRAME_IDS = ["DV1", "DV2", "DV3", "NV1", "NV2", "NV6"] as const;

export type DashboardV2FrameId = (typeof DASHBOARD_V2_FRAME_IDS)[number];

export const DASHBOARD_V2_FRAMES: Record<
  DashboardV2FrameId,
  { surface: SalesSurface; showId: string; period: SalesPeriod; pinHover?: boolean }
> = {
  DV1: { surface: "internal", showId: "ipc", period: "14" },
  DV2: { surface: "internal", showId: "all", period: "14" },
  DV3: { surface: "share", showId: "ipc", period: "14" },
  /** NV1 at 1280 and NV3 at 393: All shows, Since launch. */
  NV1: { surface: "internal", showId: "all", period: "launch" },
  /** NV2 at 1280 and NV4 at 393: the chart, with the hover card pinned on the last day. */
  NV2: { surface: "internal", showId: "all", period: "launch", pinHover: true },
  /** NV6: the umbrella. NV5 is the spend hover and waits on the new fields. */
  NV6: { surface: "internal", showId: "umbrella", period: "launch" },
};
