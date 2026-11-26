import { notFound } from "next/navigation";

import { RetargetingFrameMount } from "@/components/dashboard/events/retargeting-frame-mount";
import { FUNNEL_FRAME_IDS } from "@/scripts/plan-frames/retargeting-funnel-fixtures";

/** RD stands from the 17 Nov records; RF-A, RF-B, RF-C and RF-E are the funnel's (they re-rule RA, RB, RE and RG). */
const RETARGETING_FRAME_IDS = ["RD", ...FUNNEL_FRAME_IDS] as const;

/**
 * The Retargeting frames at /frames/retargeting/{id}: RD of
 * docs/design-record/2026-11-17-retargeting-campaign.html, and RF-A, RF-B,
 * RF-C and RF-E of docs/design-record/2026-11-26-retargeting-funnel.html. A nested route under the shared /frames/ prefix, while
 * app/(dev)/frames/[id]/page.tsx sits in an open Cursor PR.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return RETARGETING_FRAME_IDS.map((id) => ({ id }));
}

export default async function RetargetingFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(RETARGETING_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <RetargetingFrameMount id={id} />;
}
