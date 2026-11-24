import { notFound } from "next/navigation";

import { CampaignTreeFrameMount } from "@/components/campaign-tree/campaign-tree-frame-mount";
import { CAMPAIGN_TREE_FRAME_IDS, type CampaignTreeFrameId } from "@/scripts/plan-frames/campaign-tree-fixtures";

/**
 * Campaign creator, part 4 frames at /frames/campaign-tree/{id}: RC-A, RC-B,
 * RC-B-notset, RC-F and RC-F-sheet of
 * docs/design-record/2026-11-24-campaign-creator-replicate.html. A nested
 * route under the shared /frames/ prefix, while app/(dev)/frames/[id]/page.tsx
 * sits in an open Cursor PR.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return CAMPAIGN_TREE_FRAME_IDS.map((id) => ({ id }));
}

export default async function CampaignTreeFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(CAMPAIGN_TREE_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <CampaignTreeFrameMount id={id as CampaignTreeFrameId} />;
}
