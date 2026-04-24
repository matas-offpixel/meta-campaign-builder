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
  additionalMarketingAllocation = null,
}: {
  shareToken: string;
  eventId: string;
  /** Derived total marketing − paid media; null when no total marketing cap. */
  additionalMarketingAllocation?: number | null;
}) {
  const router = useRouter();
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <AdditionalSpendCard
        mode="share"
        shareToken={shareToken}
        eventId={eventId}
        additionalMarketingAllocation={additionalMarketingAllocation}
        onAfterMutate={() => router.refresh()}
      />
    </section>
  );
}
