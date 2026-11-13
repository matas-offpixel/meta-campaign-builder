import { notFound } from "next/navigation";

import { SalesFrameMount } from "@/components/dashboard/sales/frame-mount";
import { DASHBOARD_V2_FRAME_IDS } from "@/scripts/plan-frames/dashboard-v2-ids";

/**
 * Sales vs spend frames (DV1–DV3) at /frames/sales/{id}. A nested route
 * under the public /frames/ prefix, so this page does not import the
 * shared frames page (that one pulls node:crypto through the Lab mounts).
 * scripts/plan-frames/run.mjs lists the shots with frame "sales/DV1".
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return DASHBOARD_V2_FRAME_IDS.map((id) => ({ id }));
}

export default async function SalesFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(DASHBOARD_V2_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <SalesFrameMount id={id} />;
}
