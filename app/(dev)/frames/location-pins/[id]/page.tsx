import { notFound } from "next/navigation";

import { LocationPinsFrameMount } from "@/components/steps/location-pins-frame-mount";
import { LOCATION_PIN_FRAME_IDS, type LocationPinFrameId } from "@/scripts/plan-frames/location-pins-fixtures";

/**
 * The location pin frames at /frames/location-pins/{id}: LP-A, LP-B and
 * LP-C of docs/design-record/2026-11-24-campaign-creator-location-pin.html,
 * with the brief's extra states. A nested route under the shared /frames/
 * prefix, like the retargeting and launch-check frames.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return LOCATION_PIN_FRAME_IDS.map((id) => ({ id }));
}

export default async function LocationPinsFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(LOCATION_PIN_FRAME_IDS as readonly string[]).includes(id)) notFound();
  return <LocationPinsFrameMount id={id as LocationPinFrameId} />;
}
