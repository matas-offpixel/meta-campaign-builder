"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreatePlanError, createPlanForEvent } from "@/lib/db/ad-plans";
import type { EventRow } from "@/lib/db/events";

/**
 * Empty-state CTA for the Plan tab. Branches on event.event_date:
 *  - present → "Create plan" enabled, on click seeds the plan + days
 *  - missing → button disabled with explanatory copy ("Add event date
 *    first") so the user knows where to go
 *
 * On success: router.refresh() so the parent server component re-fetches
 * the plan + days; the tab will re-render with the grid in the next pass.
 */
export function EventPlanCreateCta({ event }: { event: EventRow }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasEventDate = !!event.event_date;

  const handleCreate = async () => {
    setWorking(true);
    setError(null);
    try {
      await createPlanForEvent(event);
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof CreatePlanError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to create plan.";
      setError(msg);
      setWorking(false);
    }
  };

  return (
    <section className="rounded-md border border-dashed border-border bg-card p-10 text-center">
      <div className="mx-auto max-w-md space-y-3">
        <h2 className="font-heading text-lg tracking-wide">
          {hasEventDate ? "No plan yet" : "Event needs a date first"}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {hasEventDate ? (
            <>
              The marketing plan is the daily ad-budget pacing artefact —
              one row per day from announcement through event day, columns
              for each objective.
            </>
          ) : (
            <>
              Plans are seeded from the announcement date through the event
              date. Add an event date on the Overview tab to create a plan.
            </>
          )}
        </p>

        {error && (
          <p className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="pt-2">
          {hasEventDate ? (
            <Button onClick={handleCreate} disabled={working}>
              {working ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Create plan
            </Button>
          ) : (
            <Button disabled>
              <CalendarOff className="h-4 w-4" />
              Add event date first
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
