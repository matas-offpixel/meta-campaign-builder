"use client";

import { planTimeFromInput } from "@/lib/plan/schedule";

/**
 * One start (or end) control: date + optional time.
 *
 * Native datetime-local cannot tell midnight from "no time", so this keeps
 * the two values separate. Empty time stays null; 00:00 is midnight.
 */
export function PlanDateTimeField({
  label,
  date,
  time,
  onChange,
}: {
  label: string;
  date: string | null;
  time: string | null;
  onChange: (next: { date: string | null; time: string | null }) => void;
}) {
  return (
    <div className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1">
        <input
          type="date"
          aria-label={`${label} date`}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none"
          value={date ?? ""}
          onChange={(e) =>
            onChange({ date: e.target.value || null, time })
          }
        />
        <input
          type="time"
          aria-label={`${label} time`}
          className="w-[7.5rem] bg-transparent py-1 text-sm outline-none"
          value={time ?? ""}
          onChange={(e) =>
            onChange({ date, time: planTimeFromInput(e.target.value) })
          }
        />
        {time != null ? (
          <button
            type="button"
            className="shrink-0 px-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => onChange({ date, time: null })}
          >
            Clear time
          </button>
        ) : null}
      </div>
    </div>
  );
}
