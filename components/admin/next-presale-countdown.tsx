"use client";

import { useEffect, useState } from "react";

import {
  computeCountdown,
  padCountdownValue,
  type CountdownParts,
} from "@/lib/landing-pages/countdown";

/**
 * components/admin/next-presale-countdown.tsx — dashboard "next presale"
 * widget (OP909 Sprint 2 PR 7). Reuses the fan-facing LP countdown math
 * (lib/landing-pages/countdown) and mirrors its 4-cell days/hours/mins/secs
 * visual, restyled with admin tokens + the client accent. Ticks every second
 * and hides itself once the target passes (an SSR-cached page can't show a
 * stuck 00:00:00).
 */
export function NextPresaleCountdown({
  targetAt,
  eventName,
  accent,
}: {
  targetAt: string;
  eventName: string;
  accent: string;
}) {
  const [parts, setParts] = useState<CountdownParts | null>(() =>
    computeCountdown(targetAt, Date.now()),
  );

  useEffect(() => {
    const tick = () => setParts(computeCountdown(targetAt, Date.now()));
    tick();
    const interval = setInterval(tick, 1_000);
    return () => clearInterval(interval);
  }, [targetAt]);

  if (!parts) return null;

  const cells: Array<[string, number]> = [
    ["days", parts.days],
    ["hours", parts.hours],
    ["mins", parts.mins],
    ["secs", parts.secs],
  ];

  return (
    <div>
      <p className="admin-heading text-[16px] leading-tight">{eventName}</p>
      <p className="mt-1 font-[family-name:var(--admin-mono)] text-[11px] text-[#666]">
        {absolutePresale(targetAt)}
      </p>
      <div className="mt-4 grid max-w-md grid-cols-4 divide-x-[0.5px] divide-black border-[0.5px] border-black">
        {cells.map(([unit, value]) => (
          <div key={unit} className="px-2 py-3 text-center">
            <span
              className="admin-heading block text-[28px] leading-none tabular-nums"
              style={{ color: accent }}
              suppressHydrationWarning
            >
              {padCountdownValue(value)}
            </span>
            <span className="mt-1.5 block font-[family-name:var(--admin-mono)] text-[9px] uppercase tracking-[1.5px] text-[#666]">
              {unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function absolutePresale(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(d);
}
