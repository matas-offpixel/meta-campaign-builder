"use client";

import { useRouter } from "next/navigation";

import { AdditionalSpendCard } from "@/components/dashboard/events/additional-spend-card";

/**
 * Client wrapper so share mutations can `router.refresh()` and pick up
 * new additional-spend rows on the RSC payload (report + daily block).
 */
export function ShareAdditionalSpendSection({
  shareToken,
  eventId,
  readOnly = false,
}: {
  shareToken: string;
  eventId: string;
  /** When true, additional spend is list-only (share `can_edit=false`). */
  readOnly?: boolean;
}) {
  const router = useRouter();
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <AdditionalSpendCard
        mode="share"
        shareToken={shareToken}
        eventId={eventId}
        readOnly={readOnly}
        onAfterMutate={() => router.refresh()}
      />
    </section>
  );
}
