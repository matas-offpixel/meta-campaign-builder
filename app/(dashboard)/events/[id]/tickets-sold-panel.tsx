"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Ticket } from "lucide-react";

import { updateEventRow } from "@/lib/db/events";
import { fmtDate } from "@/lib/dashboard/format";

interface Props {
  eventId: string;
  /**
   * Server-rendered current value of the manual `events.tickets_sold`
   * override. Null = column unset. When `planTickets` is present this
   * value is treated as a stashed-but-unused override.
   */
  initialTicketsSold: number | null;
  /**
   * Latest non-null `ad_plan_days.tickets_sold_cumulative` for any of
   * this event's plans. When present, the panel renders in read-only
   * mode showing the plan number, with an "Override manually" toggle
   * to reveal the input — matches the spec where the plan is the
   * authoritative source of truth and the manual column is only a
   * fallback for events with no plan.
   */
  planTickets: { value: number; asOfDay: string } | null;
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
export function TicketsSoldPanel({
  eventId,
  initialTicketsSold,
  planTickets,
}: Props) {
  const [value, setValue] = useState<string>(
    initialTicketsSold != null ? String(initialTicketsSold) : "",
  );
  const [committed, setCommitted] = useState<string>(value);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  // When a plan exists the input is hidden behind an explicit reveal —
  // the plan-day cumulative is the source of truth, and the manual
  // column is only useful as an emergency override (e.g. plan offline,
  // last-minute correction). Default-collapsed so the user is steered
  // towards the Plan tab for routine updates.
  const [overrideOpen, setOverrideOpen] = useState<boolean>(false);
  const planActive = planTickets != null;

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
          {planActive ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Pulled from the campaign plan — last entry on{" "}
              <span className="font-medium text-foreground">
                {fmtDate(planTickets.asOfDay)}
              </span>
              . Update day-by-day on the Plan tab; the report reads the
              latest non-empty cumulative automatically.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Manually-entered actual tickets sold to date — pulled from the
              ticketing platform, not Meta. Surfaces on the event report as
              Tickets Sold + Cost per Ticket. Leave blank to render as
              &ldquo;not yet recorded&rdquo;.
            </p>
          )}
        </div>
      </div>

      {planActive ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-medium tabular-nums text-foreground">
              {planTickets.value.toLocaleString("en-GB")}
            </span>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              tickets · plan-day {fmtDate(planTickets.asOfDay)}
            </span>
          </div>
          {overrideOpen ? (
            <ManualOverrideInput
              value={value}
              setValue={setValue}
              persist={persist}
              state={state}
              hint="Override is stored on `events.tickets_sold` but ignored while the plan has a non-empty cumulative — the plan number always wins on the report."
            />
          ) : (
            <button
              type="button"
              onClick={() => setOverrideOpen(true)}
              className="text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Use manual override instead
            </button>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <ManualOverrideInput
            value={value}
            setValue={setValue}
            persist={persist}
            state={state}
          />
        </div>
      )}
    </section>
  );
}

function ManualOverrideInput({
  value,
  setValue,
  persist,
  state,
  hint,
}: {
  value: string;
  setValue: (v: string) => void;
  persist: () => Promise<void>;
  state: SaveState;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
      {hint ? (
        <p className="text-[10px] leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
