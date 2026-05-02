"use client";

import type { PortalEvent } from "@/lib/db/client-portal-server";

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function LastUpdatedIndicator({
  iso,
  className = "",
}: {
  iso: string | null;
  className?: string;
}) {
  return (
    <span
      className={`text-[11px] font-medium tabular-nums ${freshnessStatusClass(iso)} ${className}`}
      title={iso ?? undefined}
    >
      {formatLastUpdated(iso)}
    </span>
  );
}

export function oldestFreshness(events: PortalEvent[]): string | null {
  return events
    .map((event) => event.freshness_at ?? null)
    .filter((value): value is string => !!value)
    .sort()[0] ?? null;
}

export function formatLastUpdated(iso: string | null): string {
  if (!iso) return "Last updated unavailable";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Last updated unavailable";
  const now = new Date();
  const today = startOfLocalDay(now).getTime();
  const day = startOfLocalDay(date).getTime();
  const daysAgo = Math.max(0, Math.floor((today - day) / 86_400_000));
  if (daysAgo === 0) return `Last updated ${formatTime(date)}`;
  if (daysAgo === 1) {
    return `Last updated yesterday at ${formatTime(date)}`;
  }
  return `Last updated ${daysAgo} days ago`;
}

function freshnessStatusClass(iso: string | null): string {
  if (!iso) return "text-muted-foreground";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "text-muted-foreground";
  const ageHours = (Date.now() - ms) / 3_600_000;
  if (ageHours < 4) return "text-emerald-600";
  if (ageHours <= 12) return "text-amber-600";
  return "text-red-600";
}

function formatTime(date: Date): string {
  return TIME.format(date).toUpperCase();
}

function startOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
