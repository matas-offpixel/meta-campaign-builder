import { notFound } from "next/navigation";

import { PageAudienceFrameMount } from "@/components/dashboard/page-audience/frame-mount";
import { PAGE_AUDIENCE_FRAME_IDS } from "@/scripts/plan-frames/page-audience-ids";

/**
 * HE2 panel frames (SC1, SC2, WR2) at /frames/page-audience/{id}. A nested
 * route under the public /frames/ prefix, like /frames/audience/{id}, so it
 * doesn't import the shared frames page.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return PAGE_AUDIENCE_FRAME_IDS.map((id) => ({ id }));
}

export default async function PageAudienceFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(PAGE_AUDIENCE_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <PageAudienceFrameMount id={id} />;
}
