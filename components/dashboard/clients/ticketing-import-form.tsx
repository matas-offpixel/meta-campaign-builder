"use client";

import { useCallback, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Upload } from "lucide-react";

/**
 * Two-stage xlsx import UX:
 *
 *   1. Pick a file → POST to `/parse`. The response lays out
 *      matched events, unmatched labels, and any parser errors.
 *      Operator inspects the table and decides whether to
 *      proceed.
 *   2. Click "Import N rows" → POST the matched rows to
 *      `/commit`. Result chip shows written / skipped counts.
 *
 * Unmatched labels + parse errors are purely informational —
 * the UI doesn't block commit on their presence. The operator
 * routinely has a sheet with test rows we don't want to import;
 * the preview gives them full visibility without forcing an
 * all-or-nothing posture.
 *
 * Re-running the commit for the same sheet is safe: migration
 * 049's unique index on (event_id, snapshot_at, source) makes
 * the upsert idempotent. We show "N rows written" even on a
 * re-run because postgres's ON CONFLICT DO UPDATE counts the
 * affected row whether it actually changed or not — callers
 * shouldn't rely on this number to gauge delta.
 */

interface ParseSnapshot {
  eventLabel: string;
  snapshotAt: string;
  ticketsSold: number | null;
  weeklyIncrease: number | null;
  sheetName: string;
}

interface ParsedMatch {
  eventLabel: string;
  eventId: string;
  eventName: string;
  eventDate: string | null;
  venueName: string | null;
  snapshots: ParseSnapshot[];
}

interface ParsedUnmatched {
  eventLabel: string;
  snapshots: ParseSnapshot[];
  candidates: Array<{ id: string; name: string; score: number }>;
}

interface ParseError {
  sheetName: string;
  row: number;
  column: number | null;
  kind: string;
  raw: string | null;
  message: string;
}

interface ParsePreview {
  ok: true;
  filename: string;
  sheets: Array<{
    name: string;
    eventsDetected: string[];
    weeksDetected: string[];
    snapshotCount: number;
  }>;
  matches: ParsedMatch[];
  unmatched: ParsedUnmatched[];
  errors: ParseError[];
  totalSnapshots: number;
}

interface CommitResult {
  ok: true;
  rowsAttempted: number;
  rowsWritten: number;
  rowsSkipped: number;
}

interface Props {
  clientId: string;
  clientName: string;
}

async function safeJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`HTTP ${res.status}: empty response body`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `HTTP ${res.status}: non-JSON response — ${text.slice(0, 160)}`,
    );
  }
}

export function TicketingImportForm({ clientId }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  const onParse = useCallback(async () => {
    if (!file || parsing) return;
    setParsing(true);
    setParseError(null);
    setPreview(null);
    setCommitResult(null);
    setCommitError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/ticketing-import/parse`,
        { method: "POST", body: form },
      );
      const body = await safeJson<ParsePreview | { ok: false; error: string }>(
        res,
      );
      if (!("ok" in body) || body.ok !== true) {
        const err =
          "error" in body && typeof body.error === "string"
            ? body.error
            : `HTTP ${res.status}`;
        throw new Error(err);
      }
      setPreview(body);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Parse failed");
    } finally {
      setParsing(false);
    }
  }, [clientId, file, parsing]);

  const onCommit = useCallback(async () => {
    if (!preview || committing) return;
    setCommitting(true);
    setCommitError(null);
    setCommitResult(null);
    try {
      const rows = preview.matches.flatMap((m) =>
        m.snapshots
          .filter((s) => s.ticketsSold != null)
          .map((s) => ({
            eventId: m.eventId,
            snapshotAt: s.snapshotAt,
            ticketsSold: s.ticketsSold as number,
          })),
      );
      if (rows.length === 0) {
        throw new Error("No matched rows to import.");
      }
      const res = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/ticketing-import/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        },
      );
      const body = await safeJson<
        CommitResult | { ok: false; error: string }
      >(res);
      if (!("ok" in body) || body.ok !== true) {
        const err =
          "error" in body && typeof body.error === "string"
            ? body.error
            : `HTTP ${res.status}`;
        throw new Error(err);
      }
      setCommitResult(body);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  }, [clientId, committing, preview]);

  const matchedSnapshotCount = preview?.matches.reduce(
    (acc, m) => acc + m.snapshots.filter((s) => s.ticketsSold != null).length,
    0,
  );

  return (
    <div className="space-y-6">
      <section className="rounded border border-border-subtle bg-surface-card p-4">
        <h2 className="text-sm font-semibold">1. Upload spreadsheet</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Accepts .xlsx with weekly Total/Increase columns per event. Parser
          handles the 4theFans TICKETING format and the J2-style variant —
          header rows are auto-detected.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.currentTarget.files?.[0] ?? null);
              setPreview(null);
              setCommitResult(null);
              setParseError(null);
              setCommitError(null);
            }}
            className="text-xs"
          />
          <button
            type="button"
            onClick={onParse}
            disabled={!file || parsing}
            className="inline-flex items-center gap-1.5 rounded border border-border-strong bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {parsing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Parsing…
              </>
            ) : (
              <>
                <Upload className="h-3 w-3" aria-hidden="true" />
                Parse + preview
              </>
            )}
          </button>
        </div>
        {parseError && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-red-600">
            <AlertCircle className="h-3 w-3" /> {parseError}
          </p>
        )}
      </section>

      {preview && <PreviewPanel preview={preview} />}

      {preview && preview.matches.length > 0 && (
        <section className="rounded border border-border-subtle bg-surface-card p-4">
          <h2 className="text-sm font-semibold">2. Import matched rows</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Writes {matchedSnapshotCount} snapshot
            {matchedSnapshotCount === 1 ? "" : "s"} with
            <code className="mx-1 rounded bg-muted px-1">source=&apos;xlsx_import&apos;</code>
            — idempotent on (event_id, snapshot_at, source). Unmatched labels
            are not written.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={onCommit}
              disabled={committing || matchedSnapshotCount === 0}
              className="inline-flex items-center gap-1.5 rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {committing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Importing…
                </>
              ) : (
                `Import ${matchedSnapshotCount} snapshot${matchedSnapshotCount === 1 ? "" : "s"}`
              )}
            </button>
            {commitResult && (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
                <CheckCircle2 className="h-3 w-3" />
                {commitResult.rowsWritten} written · {commitResult.rowsSkipped} skipped
              </span>
            )}
            {commitError && (
              <span className="inline-flex items-center gap-1.5 text-xs text-red-600">
                <AlertCircle className="h-3 w-3" />
                {commitError}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function PreviewPanel({ preview }: { preview: ParsePreview }) {
  const allWeeks = Array.from(
    new Set(
      preview.matches.flatMap((m) => m.snapshots.map((s) => s.snapshotAt)),
    ),
  ).sort();
  return (
    <section className="space-y-4 rounded border border-border-subtle bg-surface-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Preview — {preview.filename}</h2>
        <p className="text-[11px] text-muted-foreground">
          {preview.matches.length} matched events · {preview.unmatched.length} unmatched ·{" "}
          {preview.errors.length} error{preview.errors.length === 1 ? "" : "s"} ·{" "}
          {preview.totalSnapshots} total snapshots
        </p>
      </header>

      {preview.sheets.length > 0 && (
        <div className="rounded border border-border-subtle bg-background p-3 text-[11px]">
          <p className="mb-1 font-semibold text-muted-foreground">Sheets</p>
          <ul className="space-y-0.5">
            {preview.sheets.map((s) => (
              <li key={s.name}>
                <span className="font-mono">{s.name}</span> —{" "}
                {s.eventsDetected.length} event label
                {s.eventsDetected.length === 1 ? "" : "s"}, {s.weeksDetected.length} week
                {s.weeksDetected.length === 1 ? "" : "s"}, {s.snapshotCount} snapshot
                {s.snapshotCount === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.matches.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
            Matched events
          </p>
          <div className="overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Label → Event</th>
                  {allWeeks.map((w) => (
                    <th key={w} className="py-1 px-2 text-right font-normal">
                      {w.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.matches.map((m) => {
                  const byDate = new Map(
                    m.snapshots.map((s) => [s.snapshotAt, s.ticketsSold]),
                  );
                  return (
                    <tr key={m.eventId} className="border-t border-border-subtle">
                      <td className="py-1 pr-3">
                        <div className="font-medium">{m.eventName}</div>
                        <div className="text-muted-foreground">
                          sheet label: {m.eventLabel}
                        </div>
                      </td>
                      {allWeeks.map((w) => (
                        <td key={w} className="py-1 px-2 text-right font-mono">
                          {byDate.get(w) ?? "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {preview.unmatched.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold text-amber-700">
            Unmatched labels ({preview.unmatched.length})
          </p>
          <ul className="space-y-1.5 text-[11px]">
            {preview.unmatched.map((u) => (
              <li
                key={u.eventLabel}
                className="rounded border border-amber-200 bg-amber-50 p-2"
              >
                <div className="font-semibold">{u.eventLabel}</div>
                <div className="text-muted-foreground">
                  {u.snapshots.length} snapshot
                  {u.snapshots.length === 1 ? "" : "s"} — not written.{" "}
                  {u.candidates.length > 0 && (
                    <>
                      Closest candidates:{" "}
                      {u.candidates
                        .map(
                          (c) =>
                            `${c.name} (${(c.score * 100).toFixed(0)}%)`,
                        )
                        .join(", ")}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.errors.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold text-red-700">
            Parser errors ({preview.errors.length})
          </p>
          <ul className="space-y-1 text-[11px]">
            {preview.errors.slice(0, 20).map((e, i) => (
              <li
                key={`${e.sheetName}-${e.row}-${i}`}
                className="rounded bg-red-50 px-2 py-1"
              >
                <span className="font-mono">
                  {e.sheetName}:{e.row}
                </span>{" "}
                {e.kind} — {e.message}
                {e.raw && <span className="ml-1 text-muted-foreground">(“{e.raw}”)</span>}
              </li>
            ))}
            {preview.errors.length > 20 && (
              <li className="text-muted-foreground">
                +{preview.errors.length - 20} more
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
