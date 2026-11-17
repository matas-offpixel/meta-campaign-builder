import { notFound } from "next/navigation";

import { VideoWindowFrameMount } from "@/components/dashboard/events/creative-lab/video-window-frame-mount";
import { VIDEO_WINDOW_FRAME_IDS } from "@/scripts/plan-frames/video-window-fixtures";

/**
 * The Lab video window frames at /frames/video-window/{id}: VW-A and VW-B of
 * docs/design-record/2026-11-17-creative-lab-video-window.html. A nested
 * route under the shared /frames/ prefix.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return VIDEO_WINDOW_FRAME_IDS.map((id) => ({ id }));
}

export default async function VideoWindowFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(VIDEO_WINDOW_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <VideoWindowFrameMount id={id} />;
}
