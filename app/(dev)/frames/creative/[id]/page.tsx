import { notFound } from "next/navigation";

import { CreativeFrameMount } from "@/components/dashboard/creative-section/frame-mount";
import { CREATIVE_FRAME_IDS } from "@/scripts/plan-frames/creative-section-ids";

/**
 * HE5 creative frames (CR1, CR1S) at /frames/creative/{id}. A nested route
 * under the public /frames/ prefix, like /frames/audience/{id}.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return CREATIVE_FRAME_IDS.map((id) => ({ id }));
}

export default async function CreativeFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(CREATIVE_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <CreativeFrameMount id={id} />;
}
