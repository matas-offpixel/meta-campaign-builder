"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { VIZ_TYPE } from "@/lib/viz/tokens";

/** "Refresh · 4 to review" (R4 of the on-sale refresh record). Nothing at 0. */
export function refreshChipText(count: number): string | null {
  return count > 0 ? `Refresh · ${count} to review` : null;
}

/**
 * The on-sale refresh's count chip on the canvas's Meta card (R4): the
 * lines still To review on the event's latest proposals. It opens the
 * event page's Refresh panel; nothing is decided on the canvas.
 */
export function RefreshCountChip({ eventId, initialCount }: { eventId: string; initialCount?: number }) {
  const [count, setCount] = useState<number>(initialCount ?? 0);
  useEffect(() => {
    if (initialCount != null) return;
    let cancelled = false;
    fetch(`/api/events/${eventId}/onsale-refresh/count`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { count: 0 }))
      .then((body: { count?: number }) => {
        if (!cancelled) setCount(Number(body.count) || 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [eventId, initialCount]);
  const text = refreshChipText(count);
  if (!text) return null;
  return (
    <Link
      href={`/events/${eventId}?tab=overview#onsale-refresh`}
      data-refresh-chip={count}
      className={`rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 ${VIZ_TYPE.label} text-foreground hover:underline`}
    >
      {text}
    </Link>
  );
}
