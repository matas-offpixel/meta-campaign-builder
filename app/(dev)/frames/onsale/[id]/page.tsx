import { notFound } from "next/navigation";

import { OnSaleRefreshFrameMount } from "@/components/dashboard/events/onsale-refresh-frame-mount";
import { REFRESH_FRAME_IDS } from "@/scripts/plan-frames/refresh-fixtures";

/**
 * The on-sale refresh frames (OR series) at /frames/onsale/{id}, a nested
 * route under the public /frames/ prefix, while app/(dev)/frames/[id]/page.tsx
 * and scripts/plan-frames/run.mjs sit in an open Cursor PR. `?w=393` renders
 * the narrow stack. Folds into the shared registry when that PR lands.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return REFRESH_FRAME_IDS.map((id) => ({ id }));
}

export default async function RefreshFramePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ w?: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!(REFRESH_FRAME_IDS as readonly string[]).includes(id)) notFound();
  const width = Number(sp.w ?? 1280);
  return <OnSaleRefreshFrameMount id={id} width={Number.isFinite(width) ? width : 1280} />;
}
