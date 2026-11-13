import type { SalesSurface } from "@/lib/dashboard/sales-vs-spend";

/** DV1 single show, DV2 all shows, DV3 the share. Widths live in the shots file. */
export const DASHBOARD_V2_FRAME_IDS = ["DV1", "DV2", "DV3"] as const;

export type DashboardV2FrameId = (typeof DASHBOARD_V2_FRAME_IDS)[number];

export const DASHBOARD_V2_FRAMES: Record<DashboardV2FrameId, { surface: SalesSurface; showId: string }> = {
  DV1: { surface: "internal", showId: "ipc" },
  DV2: { surface: "internal", showId: "all" },
  DV3: { surface: "share", showId: "ipc" },
};
