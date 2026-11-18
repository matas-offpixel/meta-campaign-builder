import { notFound } from "next/navigation";

import { TopTracksFrameMount } from "@/components/dashboard/events/creative-lab/top-tracks-frame-mount";
import { TOP_TRACKS_FRAME_IDS, type TopTracksFrameId } from "@/scripts/plan-frames/top-tracks-ids";

/**
 * Top tracks frames at /frames/top-tracks/{id}
 * (docs/design-record/2026-11-18-creative-lab-top-tracks.html, HK8): the
 * composition stills TK-A to TK-E, the diagrams TK-F2 and TK-F3, and the Lab
 * tab TK-G. Fixture only: nothing here fetches or writes.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return TOP_TRACKS_FRAME_IDS.map((id) => ({ id }));
}

export default async function TopTracksFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(TOP_TRACKS_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <TopTracksFrameMount id={id as TopTracksFrameId} />;
}
