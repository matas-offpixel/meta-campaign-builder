"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { VIZ_TYPE } from "@/lib/viz/tokens";

/**
 * CT9's canvas chip on the Meta card: "Test {n} running" or "Test {n} ready
 * to call". Nothing when no test is running. It opens the event page, where
 * the Test plan panel sits under the Refresh panel.
 */
export function TestPlanChip({ eventId, initialText }: { eventId: string; initialText?: string | null }) {
  const [text, setText] = useState<string | null>(initialText ?? null);
  useEffect(() => {
    if (initialText !== undefined) return;
    let cancelled = false;
    fetch(`/api/events/${eventId}/creative-tests`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { view?: { chip?: string | null } } | null) => {
        if (!cancelled) setText(body?.view?.chip ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [eventId, initialText]);
  if (!text) return null;
  return (
    <Link
      href={`/events/${eventId}?tab=overview#test-plan`}
      data-test-plan-chip
      className={`rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 ${VIZ_TYPE.label} text-foreground hover:underline`}
    >
      {text}
    </Link>
  );
}
