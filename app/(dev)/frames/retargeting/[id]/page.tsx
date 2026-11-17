import { notFound } from "next/navigation";

import { RetargetingFrameMount } from "@/components/dashboard/events/retargeting-frame-mount";
import { RETARGETING_FRAME_IDS } from "@/scripts/plan-frames/retargeting-fixtures";

/**
 * The Retargeting campaign frames at /frames/retargeting/{id}: RB and RD of
 * docs/design-record/2026-11-17-retargeting-campaign.html (PR A). RA lands
 * with PR B (the tiers' figures, holds and moves) and RC with PR C (cuts
 * and steps). A nested route under the shared /frames/ prefix, while
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
