import { notFound } from "next/navigation";

import { LaunchChecksFrameMount } from "@/components/launch-guard/launch-checks-frame-mount";
import { LAUNCH_CHECKS_FRAME_IDS, type LaunchChecksFrameId } from "@/scripts/plan-frames/launch-checks-fixtures";

/**
 * Review & launch's launch checks (RC-C, RC-C-clean, RC-C-venue) of
 * docs/design-record/2026-11-24-campaign-creator-replicate.html at
 * /frames/launch-checks/{id}. A nested route under the shared /frames/
 * prefix, like event-config and retargeting. Fixture only: nothing fetches.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return LAUNCH_CHECKS_FRAME_IDS.map((id) => ({ id }));
}

export default async function LaunchChecksFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(LAUNCH_CHECKS_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <LaunchChecksFrameMount id={id as LaunchChecksFrameId} />;
}
