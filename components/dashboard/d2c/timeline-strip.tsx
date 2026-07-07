"use client";

import type { TimelineBar } from "@/lib/d2c/dashboard-view";
import { jobTypeLabel } from "@/lib/d2c/dashboard-view";

/**
 * components/dashboard/d2c/timeline-strip.tsx
 *
 * Horizontal chronological strip: one vertical bar per scheduled send,
 * positioned across the earliest→latest span, coloured + sized by channel.
 * Clicking a bar smooth-scrolls to that send's preview anchor.
 */

export function TimelineStrip({ bars }: { bars: TimelineBar[] }) {
  if (bars.length === 0) return null;

  function jumpTo(id: string) {
    const el = document.getElementById(`send-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="relative h-24 w-full rounded-lg border border-border bg-muted/30 px-4 py-3">
      {/* baseline */}
      <div className="absolute inset-x-4 bottom-6 h-px bg-border" />
      {bars.map((bar) => {
        const heightPx = 12 + bar.heightRatio * 44;
        return (
          <button
            key={bar.id}
            type="button"
            onClick={() => jumpTo(bar.id)}
            title={`${jobTypeLabel(bar.jobType)} · ${new Date(bar.scheduledFor).toLocaleString()}`}
            className="group absolute bottom-6 -translate-x-1/2 cursor-pointer"
            style={{ left: `calc(${bar.offsetPct}% )` }}
          >
            <span
              className="block w-1.5 rounded-t transition-all group-hover:w-2.5"
              style={{
                height: heightPx,
                backgroundColor: bar.color,
                opacity: bar.status === "cancelled" ? 0.3 : 1,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
