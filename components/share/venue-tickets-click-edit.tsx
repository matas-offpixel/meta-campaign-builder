"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import type { PortalEvent } from "@/lib/db/client-portal-server";

/**
 * Click-to-edit widget for the tickets figure on the collapsed
 * venue header. Replaces the plain `<span>{formatNumber(tickets)}</span>`
 * so operators can update a single event's ticket count without
 * expanding the venue card first.
 *
 * UX:
 *   - Single-event venue: clicking the number opens an inline
 *     numeric input. Blur / Enter saves, Esc cancels.
 *   - Multi-event venue: clicking the number opens a small popover
 *     listing the venue's events; picking one rotates the input
 *     into "editing {eventName}" mode.
 *   - Internal (empty token): editing is gated — the click opens
 *     the picker in "link to event page" mode instead of inline
 *     edit, since the /api/share/client/[token]/tickets route is
 *     token-auth and the internal flow lives on the per-event page.
 *
 * Save path:
 *   Same endpoint used by the expanded-card NumericCell
 *   (`POST /api/share/client/[token]/tickets`). Reusing the endpoint
 *   means snapshot resolution, auth, and audit logging behave
 *   identically regardless of whether the operator edited from
 *   collapsed or expanded state.
 *
 * Revenue is passed through unchanged (read from latest snapshot)
 * so saving tickets doesn't clobber an existing revenue value.
 */
interface Props {
  events: PortalEvent[];
  totalTickets: number;
  token: string;
  isInternal: boolean;
  onSnapshotSaved: (
    eventId: string,
    snapshot: {
      tickets_sold: number;
      revenue: number | null;
      captured_at: string;
      week_start: string;
    },
  ) => void;
  /** Pre-formatted tickets string (e.g. "247") — the parent owns
   *  formatting so the display stays consistent with the rest of
   *  the header regardless of locale preferences. */
  displayValue: string;
}

type Mode =
  | { kind: "closed" }
  | { kind: "picker" }
  | { kind: "editing"; eventId: string };

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

const GBP = new Intl.NumberFormat("en-GB");

export function VenueTicketsClickEdit({
  events,
  totalTickets,
  token,
  isInternal,
  onSnapshotSaved,
  displayValue,
}: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "closed" });
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Close on outside click / Esc so the popover feels like a
  // transient menu rather than a modal. Mounted only while open so
  // we don't run a document-level listener on every venue card.
  useEffect(() => {
    if (mode.kind === "closed") return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setMode({ kind: "closed" });
      setSave({ kind: "idle" });
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMode({ kind: "closed" });
        setSave({ kind: "idle" });
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [mode.kind]);

  // Auto-focus the input when we flip into edit mode so the
  // operator can start typing without a second click.
  useEffect(() => {
    if (mode.kind === "editing") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [mode.kind]);

  const canEdit = !isInternal && token.length > 0 && events.length > 0;
  const singleEvent = events.length === 1 ? events[0] : null;

  const onTriggerClick = (e: React.MouseEvent) => {
    // Contains the click so the venue card's header doesn't
    // toggle expand-state when the ticket figure is tapped.
    e.preventDefault();
    e.stopPropagation();
    if (!canEdit) {
      // Internal: link to /events/[id]?tab=reporting. For single-event
      // venues open directly; for multi-event venues show the picker
      // so the operator can pick which game to open.
      if (singleEvent && isInternal) {
        window.open(`/events/${singleEvent.id}?tab=reporting`, "_blank");
        return;
      }
      setMode((m) => (m.kind === "closed" ? { kind: "picker" } : { kind: "closed" }));
      return;
    }
    if (singleEvent) {
      setMode({ kind: "editing", eventId: singleEvent.id });
    } else {
      setMode((m) => (m.kind === "closed" ? { kind: "picker" } : { kind: "closed" }));
    }
  };

  async function submit(eventId: string) {
    const event = events.find((e) => e.id === eventId);
    if (!event) return;
    const raw = inputRef.current?.value ?? "";
    const trimmed = raw.trim();
    if (trimmed === "") {
      setSave({ kind: "error", message: "Required" });
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      setSave({ kind: "error", message: "Whole numbers only" });
      return;
    }

    const currentTickets =
      event.latest_snapshot?.tickets_sold ?? event.tickets_sold ?? 0;
    if (n === currentTickets) {
      setMode({ kind: "closed" });
      setSave({ kind: "idle" });
      return;
    }

    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/api/share/client/${token}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          tickets_sold: n,
          revenue: event.latest_snapshot?.revenue ?? null,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        snapshot?: {
          tickets_sold: number | null;
          revenue: number | null;
          captured_at: string;
          week_start: string;
        };
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.snapshot) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      onSnapshotSaved(event.id, {
        tickets_sold: n,
        revenue: event.latest_snapshot?.revenue ?? null,
        captured_at: json.snapshot.captured_at,
        week_start: json.snapshot.week_start,
      });
      setMode({ kind: "closed" });
      setSave({ kind: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setSave({ kind: "error", message });
    }
  }

  // Current prefill value for the input when editing a single event.
  const currentEditEvent =
    mode.kind === "editing"
      ? events.find((e) => e.id === mode.eventId) ?? null
      : null;
  const currentEditValue =
    currentEditEvent?.latest_snapshot?.tickets_sold ??
    currentEditEvent?.tickets_sold ??
    "";

  const tooltip = canEdit
    ? "Click to update tickets sold"
    : isInternal
      ? "Open event to edit"
      : "";

  return (
    <span ref={containerRef} className="relative inline-flex items-baseline">
      {mode.kind === "editing" ? (
        <span className="inline-flex items-center gap-1">
          <input
            ref={inputRef}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            defaultValue={String(currentEditValue)}
            onBlur={() => void submit(mode.eventId)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit(mode.eventId);
              }
            }}
            className="w-20 rounded border border-border-strong bg-background px-1.5 py-0.5 text-right font-semibold tabular-nums text-foreground focus:border-foreground focus:outline-none"
          />
          {save.kind === "saving" && (
            <span className="text-[10px] text-muted-foreground">saving…</span>
          )}
          {save.kind === "error" && (
            <span className="text-[10px] text-red-600">{save.message}</span>
          )}
        </span>
      ) : (
        <button
          type="button"
          onClick={onTriggerClick}
          className={
            canEdit || isInternal
              ? "rounded px-1 font-semibold text-foreground underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:bg-muted hover:decoration-foreground"
              : "font-semibold text-foreground"
          }
          title={tooltip}
          aria-label={tooltip || undefined}
          disabled={!canEdit && !isInternal}
        >
          {displayValue}
        </button>
      )}

      {mode.kind === "picker" && (
        <span
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 flex w-64 flex-col rounded-md border border-border-strong bg-card p-2 shadow-lg"
        >
          <span className="mb-1 flex items-baseline justify-between border-b border-border pb-1 text-[11px] text-muted-foreground">
            <span>
              {canEdit
                ? "Pick an event to update"
                : "Pick an event to open"}
            </span>
            <button
              type="button"
              onClick={() => setMode({ kind: "closed" })}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close picker"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
          <span className="flex flex-col gap-0.5">
            {events.map((ev) => {
              const current =
                ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? null;
              const currentLabel =
                current === null ? "—" : GBP.format(current);
              if (canEdit) {
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() =>
                      setMode({ kind: "editing", eventId: ev.id })
                    }
                    className="flex w-full items-baseline justify-between gap-3 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                  >
                    <span className="truncate">{ev.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {currentLabel}
                    </span>
                  </button>
                );
              }
              return (
                <a
                  key={ev.id}
                  href={`/events/${ev.id}?tab=reporting`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-baseline justify-between gap-3 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                >
                  <span className="truncate">{ev.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {currentLabel}
                  </span>
                </a>
              );
            })}
          </span>
          <span className="mt-1 border-t border-border pt-1 text-[10px] text-muted-foreground">
            Venue total:{" "}
            <span className="font-medium text-foreground">
              {GBP.format(totalTickets)}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
