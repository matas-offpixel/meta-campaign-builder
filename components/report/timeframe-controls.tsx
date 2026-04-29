"use client";

import { useState } from "react";

import { fmtDate } from "@/lib/dashboard/format";
import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  type CustomDateRange,
  type DatePreset,
} from "@/lib/insights/types";

export function TimeframeSelector({
  active,
  disabled,
  onChange,
}: {
  active: DatePreset;
  disabled: boolean;
  onChange: (preset: DatePreset) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Timeframe
      </p>
      <div className="flex flex-wrap gap-1.5">
        {DATE_PRESETS.map((p) => {
          const isActive = p === active;
          return (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() => onChange(p)}
              className={`rounded-md border px-2.5 py-1 text-[11px] tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50 ${
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground"
              }`}
            >
              {DATE_PRESET_LABELS[p]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * From / To date inputs that own their own draft state until Apply.
 * Bounds mirror Meta's retention guard used by the insights routes.
 */
export function CustomRangePicker({
  active,
  disabled,
  initialRange,
  onApply,
}: {
  active: boolean;
  disabled: boolean;
  initialRange: CustomDateRange | null;
  onApply: (range: CustomDateRange) => void;
}) {
  const todayIso = todayIsoUtc();
  const minIso = minSinceIsoUtc();

  const [from, setFrom] = useState<string>(initialRange?.since ?? "");
  const [to, setTo] = useState<string>(initialRange?.until ?? "");

  const initialKey = `${initialRange?.since ?? ""}|${initialRange?.until ?? ""}`;
  const [trackedKey, setTrackedKey] = useState<string>(initialKey);
  if (trackedKey !== initialKey) {
    setTrackedKey(initialKey);
    setFrom(initialRange?.since ?? "");
    setTo(initialRange?.until ?? "");
  }

  const isValid =
    from !== "" &&
    to !== "" &&
    from >= minIso &&
    to <= todayIso &&
    from <= to;

  const activeLabel =
    active && initialRange
      ? `${fmtDate(initialRange.since)} → ${fmtDate(initialRange.until)}`
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`flex flex-wrap items-end gap-2 rounded-md border px-2.5 py-2 transition ${
          active ? "border-primary bg-primary/5" : "border-border bg-background"
        }`}
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            From
          </span>
          <input
            type="date"
            min={minIso}
            max={todayIso}
            value={from}
            disabled={disabled}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border-strong bg-background px-2 py-1 text-[12px] text-foreground disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            To
          </span>
          <input
            type="date"
            min={minIso}
            max={todayIso}
            value={to}
            disabled={disabled}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border-strong bg-background px-2 py-1 text-[12px] text-foreground disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          disabled={disabled || !isValid}
          onClick={() => {
            if (isValid) onApply({ since: from, until: to });
          }}
          className="rounded-md border border-primary bg-primary px-2.5 py-1 text-[11px] font-medium tracking-wide text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply
        </button>
        {activeLabel ? (
          <span className="text-[11px] font-medium tracking-wide text-primary">
            {activeLabel}
          </span>
        ) : (
          <span className="text-[11px] tracking-wide text-muted-foreground">
            Custom range
          </span>
        )}
      </div>
      {from !== "" && to !== "" && from > to ? (
        <p className="text-[10px] text-destructive">
          From date must be on or before To date.
        </p>
      ) : null}
    </div>
  );
}

function todayIsoUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function minSinceIsoUtc(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 37);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
