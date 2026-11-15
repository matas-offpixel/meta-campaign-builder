import { notFound } from "next/navigation";

import { AudiencePanelFrameMount } from "@/components/dashboard/audience-panels/frame-mount";
import { AUDIENCE_PANEL_FRAME_IDS } from "@/scripts/plan-frames/audience-panels-ids";

/**
 * HE1 + HE3 panel frames (WR1, DF1) at /frames/audience/{id}. A nested
 * route under the public /frames/ prefix, like /frames/sales/{id}, so it
 * doesn't import the shared frames page.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return AUDIENCE_PANEL_FRAME_IDS.map((id) => ({ id }));
}

export default async function AudiencePanelFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(AUDIENCE_PANEL_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <AudiencePanelFrameMount id={id} />;
}
