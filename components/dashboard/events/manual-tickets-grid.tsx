"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Bulk catch-up grid for manual-provider events. The operator types
 * or pastes 30 rows of (date, cumulative tickets sold). On save we
 * serialise only the rows that actually have a number in them and
 * post them to the bulk API.
 *
 * The paste-handler accepts tab-separated (Excel / Google Sheets
 * "copy column") and newline-separated inputs; each pasted value is
 * assigned to rows starting at the row the user pasted into, so the
 * operator doesn't have to manually align their clipboard to the
 * first row of the grid.
 */

export interface ManualTicketsSnapshot {
  snapshotAt: string;
  ticketsSold: number;
}

interface Props {
  eventId: string;
  initialSnapshots: ManualTicketsSnapshot[];
}

interface GridRow {
  date: string;
  value: string;
}

const GRID_DAYS = 30;

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

function buildInitialGrid(initial: ManualTicketsSnapshot[]): GridRow[] {
  const byDate = new Map<string, number>();
  for (const s of initial) byDate.set(s.snapshotAt, s.ticketsSold);
  const rows: GridRow[] = [];
  for (let i = 0; i < GRID_DAYS; i++) {
    const d = isoDate(i);
    const existing = byDate.get(d);
    rows.push({
      date: d,
      value: typeof existing === "number" ? String(existing) : "",
    });
  }
  return rows;
}

export function ManualTicketsGrid({ eventId, initialSnapshots }: Props) {
  const [rows, setRows] = useState<GridRow[]>(() =>
    buildInitialGrid(initialSnapshots),
  );
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    kind: "info" | "error" | "ok";
    text: string;
  } | null>(null);

  const dirtyCount = useMemo(() => {
    const initialByDate = new Map<string, number>();
    for (const s of initialSnapshots) initialByDate.set(s.snapshotAt, s.ticketsSold);
    let count = 0;
    for (const r of rows) {
      const trimmed = r.value.trim();
      if (!trimmed) continue;
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) continue;
      const original = initialByDate.get(r.date);
      if (typeof original !== "number" || Math.trunc(parsed) !== original) {
        count++;
      }
    }
    return count;
  }, [rows, initialSnapshots]);

  function updateRow(index: number, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, value } : r)),
    );
  }

  function handlePaste(
    e: React.ClipboardEvent<HTMLInputElement>,
    startIndex: number,
  ) {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    // Split on newlines first, then on tabs (so a column copy from
    // Sheets splits row-wise). Single values fall through untouched.
    const lines = text
      .split(/\r?\n/)
      .flatMap((l) => l.split("\t"))
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (lines.length <= 1) return;
    e.preventDefault();
    setRows((prev) => {
      const next = [...prev];
      for (let i = 0; i < lines.length && startIndex + i < next.length; i++) {
        next[startIndex + i] = {
          ...next[startIndex + i],
          value: lines[i],
        };
      }
      return next;
    });
  }

  async function handleSave() {
    setSubmitting(true);
    setMessage(null);
    const payloadRows: ManualTicketsSnapshot[] = [];
    for (const r of rows) {
      const trimmed = r.value.trim();
      if (!trimmed) continue;
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setSubmitting(false);
        setMessage({
          kind: "error",
          text: `Invalid ticket count on ${r.date}: "${trimmed}"`,
        });
        return;
      }
      payloadRows.push({
        snapshotAt: r.date,
        ticketsSold: Math.trunc(parsed),
      });
    }
    if (payloadRows.length === 0) {
      setSubmitting(false);
      setMessage({ kind: "info", text: "Nothing to save — all cells are empty." });
      return;
    }
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/manual-tickets/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: payloadRows }),
        },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        rowsWritten?: number;
        rowsAttempted?: number;
      };
      if (!res.ok || !json.ok) {
        setMessage({
          kind: "error",
          text: json.error ?? `Save failed (${res.status})`,
        });
      } else {
        setMessage({
          kind: "ok",
          text: `Saved ${json.rowsWritten ?? payloadRows.length} of ${json.rowsAttempted ?? payloadRows.length} rows.`,
        });
      }
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 text-sm">
        <div className="font-medium">How to use this grid</div>
        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
          <li>
            Enter the <em>cumulative</em> number of tickets sold as of
            each date (not the daily delta).
          </li>
          <li>
            You can paste a column of values from Sheets / Excel — click
            the first empty cell and paste; the rest fill in automatically.
          </li>
          <li>
            Empty rows are skipped on save. Re-saving the same values is
            idempotent.
          </li>
        </ul>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[360px] text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Cumulative tickets sold</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.date} className="border-t">
                <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                  {r.date}
                </td>
                <td className="px-3 py-1">
                  <Input
                    inputMode="numeric"
                    placeholder="—"
                    value={r.value}
                    onChange={(e) => updateRow(i, e.target.value)}
                    onPaste={(e) => handlePaste(e, i)}
                    className="h-8 w-36"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="text-xs text-muted-foreground">
          {dirtyCount > 0
            ? `${dirtyCount} row${dirtyCount === 1 ? "" : "s"} changed`
            : "No changes pending"}
        </div>
        <Button onClick={handleSave} disabled={submitting}>
          {submitting ? "Saving..." : "Save changes"}
        </Button>
      </div>

      {message ? (
        <div
          className={
            "rounded-md border px-3 py-2 text-sm " +
            (message.kind === "error"
              ? "border-destructive/50 bg-destructive/5 text-destructive"
              : message.kind === "ok"
                ? "border-emerald-500/50 bg-emerald-500/5 text-emerald-700"
                : "border-muted bg-muted/30 text-muted-foreground")
          }
        >
          {message.text}
        </div>
      ) : null}
    </div>
  );
}
