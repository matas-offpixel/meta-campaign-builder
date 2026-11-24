"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";

import { Card, CardTitle } from "@/components/ui/card";
import { LocationPicker } from "@/components/steps/budget-schedule";
import type { LocationSelection, LocationTargetingGroup } from "@/lib/types";
import { locationPinFrame, type LocationPinFrameId } from "@/scripts/plan-frames/location-pins-fixtures";

/**
 * LP-A, LP-B and LP-C of the location pin record, plus the states the
 * brief lists (a hand-added pin row, the empty form, each error, after
 * Keep), from fixtures at the width the runner opens. The real picker, with
 * its state held here. data-frame-ready carries the shot's frame
 * ("location-pins/LP-A"), which scripts/plan-frames/run.mjs waits for.
 */
export function LocationPinsFrameMount({ id }: { id: LocationPinFrameId }) {
  const frame = locationPinFrame(id);
  const [groups, setGroups] = useState<LocationTargetingGroup[]>(frame.groups);
  const [exclusions, setExclusions] = useState<LocationSelection[]>([]);
  return (
    <main data-frame-ready={`location-pins/${id}`} className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-[56rem]">
        <Card>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <CardTitle>Location Targeting</CardTitle>
          </div>
          <div className="mt-4">
            <LocationPicker
              groups={groups}
              onChange={(update) => setGroups(update)}
              exclusions={exclusions}
              onExclusionsChange={(update) => setExclusions(update)}
              adSetSuggestions={[]}
              frame={frame.state}
            />
          </div>
        </Card>
      </div>
    </main>
  );
}
