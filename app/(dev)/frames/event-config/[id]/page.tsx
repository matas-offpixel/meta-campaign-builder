import { notFound } from "next/navigation";

import { EventConfigPanel } from "@/components/dashboard/events/event-config-panel";
import { EVENT_CONFIG_FRAME_IDS, EVENT_CONFIG_FRAMES, type EventConfigFrameId } from "@/scripts/plan-frames/event-config-fixtures";

/**
 * The event page's Dashboard panel frames (EC1–EC4, D9 / HD2) at
 * /frames/event-config/{id}, a nested route under the public /frames/
 * prefix, while app/(dev)/frames/[id]/page.tsx sits in an open Cursor PR.
 * Fixture only: nothing here fetches, and Save does nothing.
 */
export function generateStaticParams() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") return [];
  return EVENT_CONFIG_FRAME_IDS.map((id) => ({ id }));
}

export default async function EventConfigFramePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") notFound();
  const { id } = await params;
  if (!(EVENT_CONFIG_FRAME_IDS as readonly string[]).includes(id)) notFound();
  const frame = EVENT_CONFIG_FRAMES[id as EventConfigFrameId];
  return (
    <div data-frame-ready={`event-config/${id}`} className="bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto max-w-4xl">
        <EventConfigPanel eventId={frame.eventId} data={frame.data} initial={frame.initial} readOnly />
      </div>
    </div>
  );
}
