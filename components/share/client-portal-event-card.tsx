"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import type { PortalEvent } from "@/lib/db/client-portal-server";

interface Props {
  token: string;
  event: PortalEvent;
  onSnapshotSaved: (snapshot: {
    tickets_sold: number;
    captured_at: string;
    week_start: string;
  }) => void;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

function formatDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...opts,
  }).format(d);
}

/**
 * Per-event card on the client portal. Owns the editable input,
 * the optimistic save flow against POST /api/share/client/[token]/tickets,
 * and the collapsible recent-history panel.
 *
 * Save UX:
 *   - Pre-fills the input from the latest snapshot (or events.tickets_sold
 *     legacy column, or 0).
 *   - On submit: spinner on button, input disabled, optimistic update of
 *     the displayed count.
 *   - Success: brief 2s green border + "Saved" text under input.
 *   - Failure: red text under input, input re-enabled, no state change.
 */
export function ClientPortalEventCard({ token, event, onSnapshotSaved }: Props) {
  const initialValue =
    event.latest_snapshot?.tickets_sold ?? event.tickets_sold ?? 0;
  const [value, setValue] = useState<string>(String(initialValue));
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [historyOpen, setHistoryOpen] = useState(false);

  // Auto-clear the success flash after 2s.
  useEffect(() => {
    if (save.kind !== "saved") return;
    const t = setTimeout(() => setSave({ kind: "idle" }), 2000);
    return () => clearTimeout(t);
  }, [save]);

  const sold =
    event.latest_snapshot?.tickets_sold ?? event.tickets_sold ?? 0;
  const cap = event.capacity ?? 0;
  const pct = cap > 0 ? Math.round((sold / cap) * 100) : 0;

  const lastUpdatedLabel = useMemo(() => {
    if (event.latest_snapshot?.captured_at) {
      return `Last updated: ${formatDate(event.latest_snapshot.captured_at)}`;
    }
    return "No tickets logged yet";
  }, [event.latest_snapshot]);

  const venueLine = [event.venue_name, event.venue_city]
    .filter(Boolean)
    .join(" · ");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(value);
    if (
      !Number.isFinite(parsed) ||
      parsed < 0 ||
      !Number.isInteger(parsed)
    ) {
      setSave({
        kind: "error",
        message: "Enter a whole number (no decimals).",
      });
      return;
    }

    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/api/share/client/${token}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          tickets_sold: parsed,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        snapshot?: {
          tickets_sold: number | null;
          captured_at: string;
          week_start: string;
        };
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.snapshot) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      onSnapshotSaved({
        tickets_sold: parsed,
        captured_at: json.snapshot.captured_at,
        week_start: json.snapshot.week_start,
      });
      setSave({ kind: "saved", at: Date.now() });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save — try again";
      setSave({ kind: "error", message: `Failed to save — ${message}` });
    }
  };

  const cardBorderClass =
    save.kind === "saved"
      ? "border-emerald-400 transition-colors"
      : "border-zinc-200";

  return (
    <article
      className={`rounded-md border ${cardBorderClass} bg-white px-5 py-4 space-y-4`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg leading-tight tracking-wide">
            {event.name}
          </h2>
          {venueLine && (
            <p className="mt-0.5 text-xs text-zinc-500">{venueLine}</p>
          )}
        </div>
        <p className="text-[11px] text-zinc-500">
          {event.event_date ? formatDate(event.event_date) : "Date TBC"}
        </p>
      </header>

      <div className="space-y-1.5">
        <p className="text-[11px] text-zinc-500">{lastUpdatedLabel}</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full bg-zinc-900 transition-all"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
        <p className="text-sm">
          <span className="font-semibold">{formatNumber(sold)}</span>
          {cap > 0 && (
            <>
              <span className="text-zinc-500"> / {formatNumber(cap)}</span>
              <span className="ml-2 text-xs text-zinc-500">
                ({pct}%)
              </span>
            </>
          )}
          <span className="ml-1 text-xs text-zinc-500">sold</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <label
          htmlFor={`tickets-${event.id}`}
          className="block text-xs font-medium text-zinc-700"
        >
          Update tickets sold
        </label>
        <input
          id={`tickets-${event.id}`}
          name="tickets_sold"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={save.kind === "saving"}
          className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-50"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={save.kind === "saving"}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
          >
            {save.kind === "saving" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Save update"
            )}
          </button>
          {save.kind === "saved" && (
            <span className="text-xs font-medium text-emerald-600">
              Saved ✓
            </span>
          )}
        </div>
        {save.kind === "error" && (
          <p className="text-xs text-red-600">{save.message}</p>
        )}
      </form>

      <div className="border-t border-zinc-100 pt-3">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 transition-colors"
        >
          {historyOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          History (last {Math.min(5, event.history.length)} entr
          {event.history.length === 1 ? "y" : "ies"})
        </button>
        {historyOpen && (
          <ul className="mt-2 space-y-1 text-xs text-zinc-600">
            {event.history.length === 0 ? (
              <li className="text-zinc-400">No history yet.</li>
            ) : (
              event.history.map((h, i) => (
                <li
                  key={`${h.captured_at}-${i}`}
                  className="flex items-center justify-between"
                >
                  <span>{formatDate(h.captured_at)}</span>
                  <span className="font-mono">
                    {h.tickets_sold !== null
                      ? `${formatNumber(h.tickets_sold)} tickets`
                      : "—"}
                  </span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </article>
  );
}
