"use client";

import { AdditionalTicketEntriesCard } from "@/components/dashboard/events/additional-ticket-entries-card";

export function AdditionalTicketSalesCard({
  eventId,
  tiers = [],
  className = "",
  onAfterMutate,
}: {
  eventId: string;
  tiers?: string[];
  className?: string;
  onAfterMutate?: () => void;
}) {
  return (
    <AdditionalTicketEntriesCard
      eventId={eventId}
      tiers={tiers}
      className={className}
      onAfterMutate={onAfterMutate}
    />
  );
}
