"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Ticket } from "lucide-react";

import { updateEventRow } from "@/lib/db/events";

interface Props {
  eventId: string;
  /**
   * Server-rendered current value. Null = "not yet recorded" (the
   * column default; renders as an empty input).
   */
  initialTicketsSold: number | null;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

/**
 * Per-event manual ticket sales input.
 *
 * Source of truth for `events.tickets_sold` (see migration 012). The
 * write is a direct `updateEventRow` from the browser client — RLS on
 * `events` already restricts writes to `auth.uid() = user_id`, so no
 * dedicated API route is needed for what is just a one-column patch.
 *
 * Save trigger is `onBlur` (not onChange) so the agent isn't peppered
 * with writes per keystroke. An empty input persists as `null` —
 * "not yet recorded" — which the public report renders as an em-dash.
 */
export function TicketsSoldPanel({ eventId, initialTicketsSold }: Props) {
  const [value, setValue] = useState<string>(
    initialTicketsSold != null ? String(initialTicketsSold) : "",
  );
  const [committed, setCommitted] = useState<string>(value);
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  // Auto-clear the "Saved" badge after a couple seconds so the row
  // settles back to its resting state.
  useEffect(() => {
    if (state.kind !== "saved") return;
    const t = window.setTimeout(() => setState({ kind: "idle" }), 2000);
    return () => window.clearTimeout(t);
  }, [state]);

  const persist = async () => {
    const trimmed = value.trim();
    if (trimmed === committed) return; // No-op blur
    if (state.kind === "saving") return;

    let parsed: number | null;
    if (trimmed === "") {
      parsed = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        setState({
          kind: "error",
          message: "Enter a non-negative whole number.",
        });
        return;
      }
      parsed = n;
    }

    setState({ kind: "saving" });
    try {
      await updateEventRow(eventId, { tickets_sold: parsed });
      setCommitted(trimmed);
      setState({ kind: "saved", at: Date.now() });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed.",
      });
    }
  };

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <Ticket className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-base tracking-wide">Tickets sold</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Manually-entered actual tickets sold to date — pulled from the
            ticketing platform, not Meta. Surfaces on the event report as
            Tickets Sold + Cost per Ticket. Leave blank to render as
            &ldquo;not yet recorded&rdquo;.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="uppercase tracking-wider text-[10px]">
            Tickets to date
          </span>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={value}
            placeholder="—"
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void persist()}
            disabled={state.kind === "saving"}
            className="w-32 rounded-md border border-border-strong bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
          />
        </label>

        <div className="flex h-6 items-center gap-1.5 text-[11px] text-muted-foreground">
          {state.kind === "saving" ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving…
            </>
          ) : state.kind === "saved" ? (
            <>
              <Check className="h-3 w-3 text-emerald-600" />
              Saved
            </>
          ) : state.kind === "error" ? (
            <span className="text-destructive">{state.message}</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
