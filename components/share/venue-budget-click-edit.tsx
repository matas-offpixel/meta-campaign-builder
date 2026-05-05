"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { formatCurrency } from "@/lib/dashboard/currency";

/**
 * components/share/venue-budget-click-edit.tsx
 *
 * Click-to-edit widget for the venue header's "Total marketing"
 * paid-media budget. The venue total is the sum of each event's
 * `events.budget_marketing` so editing the venue total directly
 * doesn't make sense without an opinion on how to split. We mirror
 * the `VenueTicketsClickEdit` pattern instead: clicking the figure
 * opens a small popover listing every event in the venue group with
 * an editable input per event. The header re-sums on every save.
 *
 * Save path: PATCH /api/share/venue/[token]/budget when the share
 * token is set; the route gates on the share's `can_edit=true`.
 * Internal callers pass `mode="dashboard"` and an empty token —
 * editing internally is intentionally NOT wired in this PR (existing
 * event-form covers the internal path; adding a parallel popover
 * would invite drift).
 */

interface EventBudgetEntry {
  id: string;
  name: string;
  budget_marketing: number | null;
}

interface Props {
  events: EventBudgetEntry[];
  shareToken: string;
  canEdit: boolean;
  onSaved?: (eventId: string, nextValue: number | null) => void;
}

type Mode =
  | { kind: "closed" }
  | { kind: "open" };

export function VenueBudgetClickEdit({
  events,
  shareToken,
  canEdit,
  onSaved,
}: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "closed" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Map<string, string>>(() => new Map());
  const popoverRef = useRef<HTMLSpanElement | null>(null);

  const venueTotal = events.reduce(
    (sum, event) => sum + (event.budget_marketing ?? 0),
    0,
  );

  useEffect(() => {
    if (mode.kind === "closed") return;
    function onMouseDown(event: MouseEvent) {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(event.target as Node)) return;
      setMode({ kind: "closed" });
      setError(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMode({ kind: "closed" });
        setError(null);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mode.kind]);

  async function save(eventId: string, value: string) {
    if (!canEdit || !shareToken) return;
    const trimmed = value.trim();
    let payload: number | null;
    if (trimmed === "") {
      payload = null;
    } else {
      const num = Number(trimmed.replace(/[,£$€]/g, ""));
      if (!Number.isFinite(num) || num < 0) {
        setError("Budget must be a non-negative number");
        return;
      }
      payload = num;
    }
    setBusyId(eventId);
    setError(null);
    try {
      const res = await fetch(
        `/api/share/venue/${encodeURIComponent(shareToken)}/budget`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_id: eventId,
            budget_marketing: payload,
          }),
        },
      );
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        budget_marketing?: number | null;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      onSaved?.(eventId, json.budget_marketing ?? payload);
      setDrafts((current) => {
        const next = new Map(current);
        next.delete(eventId);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <span ref={popoverRef} className="relative inline-flex items-baseline">
      <button
        type="button"
        onClick={() =>
          setMode((current) =>
            current.kind === "closed" ? { kind: "open" } : { kind: "closed" },
          )
        }
        className={
          canEdit
            ? "rounded font-heading text-xl tabular-nums tracking-wide text-foreground underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 hover:bg-muted hover:decoration-foreground"
            : "font-heading text-xl tabular-nums tracking-wide text-foreground"
        }
        disabled={!canEdit}
        title={canEdit ? "Click to edit per-event marketing budgets" : undefined}
      >
        {venueTotal > 0 ? formatCurrency(venueTotal) : "—"}
      </button>

      {mode.kind === "open" ? (
        <span className="absolute left-0 top-full z-50 mt-2 flex w-80 flex-col rounded-md border border-border-strong bg-card p-3 text-xs shadow-lg">
          <span className="mb-2 flex items-baseline justify-between border-b border-border pb-2 text-muted-foreground">
            <span>Edit per-event marketing budget</span>
            <button
              type="button"
              onClick={() => setMode({ kind: "closed" })}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
          <span className="flex flex-col gap-2">
            {events.map((event) => {
              const draft = drafts.get(event.id);
              const display =
                draft != null
                  ? draft
                  : event.budget_marketing != null
                    ? String(event.budget_marketing)
                    : "";
              return (
                <span
                  key={event.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 truncate text-foreground">
                    {event.name}
                  </span>
                  <input
                    value={display}
                    onChange={(e) => {
                      const next = new Map(drafts);
                      next.set(event.id, e.target.value);
                      setDrafts(next);
                    }}
                    onBlur={(e) => void save(event.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void save(event.id, (e.target as HTMLInputElement).value);
                      }
                    }}
                    inputMode="decimal"
                    disabled={!canEdit || busyId === event.id}
                    className="h-7 w-24 rounded-md border border-border bg-background px-2 text-right tabular-nums focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </span>
              );
            })}
          </span>
          {error ? (
            <span className="mt-2 text-[11px] text-destructive">{error}</span>
          ) : null}
          <span className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
            Saves on blur · venue total = sum of per-event budgets
          </span>
        </span>
      ) : null}
    </span>
  );
}
