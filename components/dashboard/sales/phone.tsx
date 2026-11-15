"use client";

/** Dashboard v2 on a phone (MB2–MB7): the small pieces the page uses below 640 px. */

import { useState, useSyncExternalStore, type ReactNode } from "react";

import { SALES_PERIODS, type SalesPeriod } from "@/lib/dashboard/sales-vs-spend";

/**
 * MB4 / MB7: an open state remembered per device. Browser storage only, and
 * it can fail (private mode, blocked storage): the page then just opens closed.
 * A frame can pin it with `forced`.
 */
const REMEMBERED_EVENT = "sales-v2:remembered";

function readRemembered(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function subscribeRemembered(onChange: () => void): () => void {
  window.addEventListener(REMEMBERED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(REMEMBERED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useRemembered(key: string, forced?: boolean): [boolean, (next: boolean) => void] {
  // Closed on the server and on first paint; storage decides after that. Storage can't be read: closed.
  const stored = useSyncExternalStore(subscribeRemembered, () => readRemembered(key), () => false);
  const [local, setLocal] = useState<boolean | null>(null);
  function set(next: boolean) {
    setLocal(next);
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
      window.dispatchEvent(new Event(REMEMBERED_EVENT));
    } catch {
      /* storage unavailable: the state still changes for this visit */
    }
  }
  return [forced ?? local ?? stored, set];
}

/** MB5: the period as one select chip in the title row ("Since launch ▾"). The phone's own picker is the sheet. */
export function PeriodSelect({ period, onChange }: { period: SalesPeriod; onChange: (next: SalesPeriod) => void }) {
  const label = SALES_PERIODS.find((item) => item.id === period)?.label ?? "Since launch";
  return (
    <label className="relative inline-flex shrink-0 items-center rounded-full border border-border bg-card px-3 py-1 text-xs sm:hidden">
      <span aria-hidden>{label} ▾</span>
      <select
        aria-label="Period"
        value={period}
        onChange={(event) => onChange(event.target.value as SalesPeriod)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {SALES_PERIODS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** MB7: "Campaigns · 29 · 7 spending ›". A tap opens what's under it. */
export function CollapsedRow({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-border pt-2 sm:hidden">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center justify-between py-1 text-left text-sm">
        <span>{label}</span>
        <span aria-hidden className={`text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open ? children : null}
    </div>
  );
}
