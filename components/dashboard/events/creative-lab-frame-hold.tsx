"use client";

import { MmlCreativeIntake } from "@/components/plan/mml-creative-intake";

/**
 * CL11 only. The frame page is a server component, so the click handler
 * stays on this side of the boundary.
 */
export function CreativeLabFrameHold({
  eventName,
  holdRows,
}: {
  eventName: string;
  holdRows: { id: string; filename: string; width: number; height: number; bucket: "4:5" | "1:1" | "9:16" | "other" }[];
}) {
  return (
    <MmlCreativeIntake
      planId="frame-plan"
      clientId={null}
      persisted
      onLaunches={() => undefined}
      fixture={{ eventName, rows: [], holdRows }}
    />
  );
}
