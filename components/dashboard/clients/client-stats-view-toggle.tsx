"use client";

/**
 * components/dashboard/clients/client-stats-view-toggle.tsx
 *
 * Three-state segmented control on the internal client dashboard
 * (Workstream C): Stats / Pacing / Performance vs Allocation.
 *
 *   - Stats  → the existing topline view, passed in as a server-rendered
 *              slot (`statsView`) so `ClientPortal` is untouched.
 *   - Pacing → per-venue horizontal funnel bars.
 *   - Performance vs Allocation → sales% vs spend% overlay bars.
 *
 * Toggle choice persists in localStorage (`client-dashboard-toggle-{id}`)
 * via a useSyncExternalStore-backed store (SSR snapshot = "stats", so no
 * hydration mismatch). Internal-only.
 */

import { useSyncExternalStore } from "react";

import type { VenuePacingRow } from "@/lib/dashboard/venue-pacing-summary";
import { ClientPacingView } from "./client-pacing-view";
import { ClientAllocationView } from "./client-allocation-view";

type ViewMode = "stats" | "pacing" | "allocation";

const VALID: ViewMode[] = ["stats", "pacing", "allocation"];

// ── localStorage-backed view store ────────────────────────────────────────
const cache = new Map<string, ViewMode>();
const listeners = new Map<string, Set<() => void>>();

function read(key: string): ViewMode {
  if (cache.has(key)) return cache.get(key)!;
  try {
    const v = window.localStorage.getItem(key);
    if (v && (VALID as string[]).includes(v)) {
      cache.set(key, v as ViewMode);
      return v as ViewMode;
    }
  } catch {
    /* unavailable */
  }
  cache.set(key, "stats");
  return "stats";
}
function write(key: string, next: ViewMode) {
  cache.set(key, next);
  try {
    window.localStorage.setItem(key, next);
  } catch {
    /* ignore */
  }
  listeners.get(key)?.forEach((l) => l());
}
function subscribe(key: string, cb: () => void) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

const OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "stats", label: "Stats" },
  { value: "pacing", label: "Pacing" },
  { value: "allocation", label: "Performance vs Allocation" },
];

export function ClientStatsViewToggle({
  clientId,
  rows,
  statsView,
}: {
  clientId: string;
  rows: VenuePacingRow[];
  /** Server-rendered existing topline view (ClientPortal). */
  statsView: React.ReactNode;
}) {
  const storageKey = `client-dashboard-toggle-${clientId}`;
  const mode = useSyncExternalStore(
    (cb) => subscribe(storageKey, cb),
    () => read(storageKey),
    () => "stats" as ViewMode,
  );

  return (
    <div>
      <div className="mx-auto flex max-w-7xl justify-end px-6 pt-4">
        <div
          role="tablist"
          aria-label="Dashboard view"
          className="inline-flex gap-1 rounded-full border border-border p-0.5"
        >
          {OPTIONS.map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => write(storageKey, opt.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Stats stays mounted (display:none when inactive) so toggling back
          is instant and ClientPortal's internal state is preserved. */}
      <div className={mode === "stats" ? "" : "hidden"}>{statsView}</div>
      {mode === "pacing" ? (
        <main className="mx-auto max-w-7xl px-6 py-8">
          <ClientPacingView rows={rows} />
        </main>
      ) : null}
      {mode === "allocation" ? (
        <main className="mx-auto max-w-7xl px-6 py-8">
          <ClientAllocationView rows={rows} />
        </main>
      ) : null}
    </div>
  );
}
