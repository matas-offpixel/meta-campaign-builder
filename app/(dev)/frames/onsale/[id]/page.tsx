import { notFound } from "next/navigation";

import { OnSaleRefreshFrameMount } from "@/components/dashboard/events/onsale-refresh-frame-mount";
import { REFRESH_FRAME_IDS } from "@/scripts/plan-frames/refresh-fixtures";

/**
 * The on-sale refresh frames (OR series) at /frames/onsale/{id}, a nested
 * route under the public /frames/ prefix, while app/(dev)/frames/[id]/page.tsx
 * sits in an open Cursor PR; scripts/plan-frames/run.mjs lists the OR shots
 * with frame "onsale/OR1". The viewport decides the stack.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return REFRESH_FRAME_IDS.map((id) => ({ id }));
}

export default async function RefreshFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(REFRESH_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <OnSaleRefreshFrameMount id={id} />;
}
