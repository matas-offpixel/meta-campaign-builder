"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  SearchX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * components/dashboard/clients/ticketing-link-discovery.tsx
 *
 * Operator table for the `/clients/[id]/ticketing-link-discovery`
 * sweep:
 *
 *   1. On mount, fetches `GET /api/clients/[id]/ticketing-link-discovery`.
 *      The server returns every unlinked internal event plus a pre-sorted
 *      list of candidate matches from every active ticketing connection.
 *   2. Each row seeds its selection with the top candidate when the
 *      confidence is >= 0.65. These are pre-checked for operator review
 *      but still require clicking "Link N selected" to persist.
 *   3. "Link selected" → `POST .../bulk-link` in one shot. Server upserts
 *      each `event_ticketing_links` row, then queues throttled rollup-sync
 *      in the background.
 *   4. On success we clear the linked rows from the table rather than
 *      doing a full refetch — the operator keeps a live list of what's
 *      still outstanding.
 *
 * We deliberately avoid per-row inline edits for the external event
 * selection. Operators should either (a) use one of the top candidates
 * or (b) drop into the per-event `EventbriteLinkPanel` for a bespoke
 * link. Giving them a third, bespoke "type the external id" flow here
 * tripled the code-path count with little gain.
 */

interface CandidateRow {
  externalEventId: string;
  externalEventName: string;
  externalEventStartsAt: string | null;
  externalEventUrl: string | null;
  externalVenue: string | null;
  externalCapacity: number | null;
  confidence: number;
  venueScore: number;
  opponentScore: number;
  dateScore: number;
  nameScore: number;
  capacityMatch: boolean;
  autoConfirm: boolean;
  manualDisambiguationRequired: boolean;
  connectionId: string;
  connectionProvider: string;
}

interface EventRow {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  venueName: string | null;
  skipReason: string | null;
  candidates: CandidateRow[];
}

interface ConnectionRow {
  id: string;
  provider: string;
  external_account_id: string | null;
  status: string;
  externalEventCount: number;
  error: string | null;
}

interface DiscoveryResponse {
  ok: boolean;
  error?: string;
  clientId?: string;
  clientName?: string;
  events?: EventRow[];
  connections?: ConnectionRow[];
  unlinkedEventCount?: number;
  totalEventCount?: number;
}

interface BulkLinkResponse {
  ok: boolean;
  error?: string;
  linkedCount?: number;
  failedCount?: number;
  syncQueuedCount?: number;
  throttled?: boolean;
  syncWarningCount?: number;
  results?: Array<{
    eventId: string;
    eventName: string | null;
    externalEventId: string | null;
    connectionProvider: string | null;
    ok: boolean;
    linkId: string | null;
    syncOk: boolean | null;
    syncError: string | null;
    linkError: string | null;
  }>;
}

type SelectionState = Record<string, { externalEventId: string; checked: boolean }>;

interface LinkSelection {
  eventId: string;
  connectionId: string;
  externalEventId: string;
  externalEventUrl: string | null;
}

interface LinkSummary {
  linked: number;
  failed: number;
  failures: Array<{ eventId: string; eventName: string | null; reason: string }>;
  syncWarnings: Array<{
    eventId: string;
    eventName: string | null;
    reason: string;
  }>;
  retryRows: LinkSelection[];
  syncQueued: number;
  throttled: boolean;
}

const AUTO_CONFIRM_THRESHOLD = 0.75;
const AUTO_SELECT_THRESHOLD = 0.65;
const SURFACE_THRESHOLD = 0.55;

function fmtConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function confidenceClasses(score: number): string {
  if (score >= AUTO_CONFIRM_THRESHOLD) return "text-green-500";
  if (score >= AUTO_SELECT_THRESHOLD) return "text-yellow-500";
  if (score >= SURFACE_THRESHOLD) return "text-orange-500";
  return "text-muted-foreground";
}

function isAutoSelectable(candidate: CandidateRow | undefined): boolean {
  return Boolean(
    candidate &&
      candidate.confidence >= AUTO_SELECT_THRESHOLD &&
      !candidate.manualDisambiguationRequired,
  );
}

function seedSelectionsFromEvents(events: EventRow[]): SelectionState {
  const initial: SelectionState = {};
  for (const row of events) {
    const top = row.candidates[0];
    if (top) {
      initial[row.eventId] = {
        externalEventId: top.externalEventId,
        checked: isAutoSelectable(top),
      };
    }
  }
  return initial;
}

interface Props {
  clientId: string;
}

export function TicketingLinkDiscovery({ clientId }: Props) {
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<DiscoveryResponse | null>(null);
  const [selections, setSelections] = useState<SelectionState>({});
  const [submitting, setSubmitting] = useState(false);
  const [linkingEventIds, setLinkingEventIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [summary, setSummary] = useState<LinkSummary | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  const fetchDiscovery = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setReloading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/clients/${encodeURIComponent(clientId)}/ticketing-link-discovery`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as DiscoveryResponse;
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? `Request failed (${res.status})`);
        }
        setPayload(json);
        const rows = json.events ?? [];
        const initial = seedSelectionsFromEvents(rows);
        const autoMatched = Object.values(initial).filter((s) => s.checked).length;
        setSelections(initial);
        setSelectionNotice(
          autoMatched > 0
            ? `${autoMatched} of ${rows.length} events auto-matched. Review and adjust below.`
            : null,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Discovery failed");
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [clientId],
  );

  useEffect(() => {
    void fetchDiscovery("initial");
  }, [fetchDiscovery]);

  const events = useMemo(() => payload?.events ?? [], [payload?.events]);
  const connections = useMemo(
    () => payload?.connections ?? [],
    [payload?.connections],
  );
  const hasAnyConnection = connections.length > 0;
  const activeConnectionCount = connections.filter(
    (c) => c.error === null && c.status !== "paused",
  ).length;

  const selectedCount = useMemo(
    () =>
      Object.values(selections).filter(
        (s) => s.checked && s.externalEventId.length > 0,
      ).length,
    [selections],
  );

  const matchStats = useMemo(() => {
    let autoMatched = 0;
    let needsReview = 0;
    let noCandidates = 0;
    for (const row of events) {
      const selected = selections[row.eventId];
      if (selected?.checked) {
        autoMatched += 1;
      } else if (row.candidates.length > 0) {
        needsReview += 1;
      } else {
        noCandidates += 1;
      }
    }
    return { autoMatched, needsReview, noCandidates };
  }, [events, selections]);

  const clearAll = () => {
    setSelections((prev) => {
      const next: SelectionState = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = { ...next[key], checked: false };
      }
      return next;
    });
  };

  const toggleRow = (eventId: string, externalEventId: string) => {
    setSelections((prev) => {
      const cur = prev[eventId];
      if (cur && cur.externalEventId === externalEventId) {
        return {
          ...prev,
          [eventId]: { externalEventId, checked: !cur.checked },
        };
      }
      return {
        ...prev,
        [eventId]: { externalEventId, checked: true },
      };
    });
  };

  const linkRows = async (
    rows: LinkSelection[],
  ) => {
    if (rows.length === 0) return;
    const rowEventIds = new Set(rows.map((row) => row.eventId));
    const rowByEventId = new Map(rows.map((row) => [row.eventId, row]));
    setSubmitting(true);
    setLinkingEventIds(rowEventIds);
    setError(null);
    setSummary(null);
    try {
      console.info(
        `[ticketing-link-discovery] linking ${rows.length} row(s)`,
        rows.map((row) => ({
          eventId: row.eventId,
          connectionId: row.connectionId,
          externalEventId: row.externalEventId,
        })),
      );
      const res = await fetch(
        `/api/clients/${encodeURIComponent(clientId)}/ticketing-link-discovery/bulk-link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selections: rows, syncAfterLink: true }),
        },
      );
      const json = (await res.json()) as BulkLinkResponse;
      if (!res.ok && !json.results) {
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }
      const failures = (json.results ?? [])
        .filter((r) => !r.ok)
        .map((r) => ({
          eventId: r.eventId,
          eventName: r.eventName,
          reason: r.linkError ?? "Unknown link error",
        }));
      const syncWarnings = (json.results ?? [])
        .filter((r) => r.ok && r.syncOk === false)
        .map((r) => ({
          eventId: r.eventId,
          eventName: r.eventName,
          reason: r.syncError ?? "Sync completed with errors",
        }));
      const retryRows = syncWarnings
        .map((warning) => rowByEventId.get(warning.eventId))
        .filter((row): row is LinkSelection => Boolean(row));
      const linkedIds = new Set(
        (json.results ?? [])
          .filter((r) => r.ok)
          .map((r) => r.eventId),
      );
      setSummary({
        linked: linkedIds.size,
        failed: failures.length,
        failures,
        syncWarnings,
        retryRows,
        syncQueued: json.syncQueuedCount ?? 0,
        throttled: Boolean(json.throttled),
      });

      // Strip the successful links from the local table. A full refetch
      // after bulk-link re-issues every provider listEvents() call,
      // which is sluggish for clients with large rosters.
      if (linkedIds.size > 0) {
        setPayload((prev) =>
          prev
            ? {
                ...prev,
                events: (prev.events ?? []).filter(
                  (e) => !linkedIds.has(e.eventId),
                ),
                unlinkedEventCount: Math.max(
                  0,
                  (prev.unlinkedEventCount ?? 0) - linkedIds.size,
                ),
              }
            : prev,
        );
        setSelections((prev) => {
          const next: SelectionState = { ...prev };
          for (const id of linkedIds) delete next[id];
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk link failed");
    } finally {
      setSubmitting(false);
      setLinkingEventIds(new Set());
    }
  };

  const candidateToSelection = (eventId: string, candidate: CandidateRow) => ({
    eventId,
    connectionId: candidate.connectionId,
    externalEventId: candidate.externalEventId,
    externalEventUrl: candidate.externalEventUrl,
  });

  const onAutoLinkAll = () => {
    const next = seedSelectionsFromEvents(events);
    const autoMatched = Object.values(next).filter((s) => s.checked).length;
    setSelections(next);
    setSelectionNotice(
      `${autoMatched} of ${events.length} events auto-matched. Review and adjust below.`,
    );
  };

  const onLinkSelected = async () => {
    if (!payload) return;
    const rows: LinkSelection[] = [];
    for (const row of events) {
      const sel = selections[row.eventId];
      if (!sel?.checked) continue;
      const candidate = row.candidates.find(
        (c) => c.externalEventId === sel.externalEventId,
      );
      if (!candidate) continue;
      rows.push(candidateToSelection(row.eventId, candidate));
    }
    await linkRows(rows);
  };

  if (loading) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Sweeping unlinked events…
        </div>
      </Card>
    );
  }

  if (error && !payload) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium">Discovery failed</p>
            <p className="mt-1 text-destructive/80">{error}</p>
          </div>
        </div>
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchDiscovery("initial")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg tracking-wide text-foreground">
              Link discovery
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {payload?.unlinkedEventCount ?? 0} unlinked event
              {(payload?.unlinkedEventCount ?? 0) === 1 ? "" : "s"} of{" "}
              {payload?.totalEventCount ?? 0} total ·{" "}
              {activeConnectionCount} active connection
              {activeConnectionCount === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {matchStats.autoMatched} events auto-matched,{" "}
              {matchStats.needsReview} need review, {matchStats.noCandidates} no
              candidates
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchDiscovery("refresh")}
              disabled={reloading || submitting}
            >
              {reloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Re-scan
            </Button>
          </div>
        </div>

        {connections.length > 0 ? (
          <div className="mt-4 rounded-md border border-border bg-background p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Connections
            </p>
            <ul className="space-y-1 text-xs">
              {connections.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-2">
                  <span className="font-mono text-foreground">{c.provider}</span>
                  <span className="text-muted-foreground">
                    {c.external_account_id ?? "—"}
                  </span>
                  <span className="text-muted-foreground">
                    · {c.externalEventCount} external
                  </span>
                  {c.error ? (
                    <span className="text-destructive">· {c.error}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!hasAnyConnection ? (
          <div className="mt-4 rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-xs text-yellow-600">
            No ticketing connections are configured for this client. Connect
            one from the client settings page before running discovery.
          </div>
        ) : null}
      </Card>

      {summary ? (
        <Card
          className={
            summary.failed === 0 && summary.syncWarnings.length === 0
              ? "border-green-500/40 bg-green-500/5"
              : "border-yellow-500/40 bg-yellow-500/5"
          }
        >
          <div className="flex items-start gap-2 text-sm">
            {summary.failed === 0 && summary.syncWarnings.length === 0 ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-500" />
            )}
            <div>
              <p className="font-medium text-foreground">
                Linked {summary.linked} event
                {summary.linked === 1 ? "" : "s"}
                {summary.failed > 0 ? `, ${summary.failed} failed` : ""}
                {summary.syncWarnings.length > 0
                  ? `. Syncing tickets for ${summary.syncWarnings.length} event${
                      summary.syncWarnings.length === 1 ? "" : "s"
                    } needs attention.`
                  : ""}
                {summary.syncQueued > 0 && summary.syncWarnings.length === 0
                  ? `. Syncing ${summary.syncQueued} ticket update${
                      summary.syncQueued === 1 ? "" : "s"
                    } in background.`
                  : ""}
              </p>
              {summary.throttled ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Throttled to respect 4thefans rate limits — sync continues in
                  background.
                </p>
              ) : null}
              {summary.failures.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {summary.failures.map((f) => (
                    <li key={f.eventId} className="font-mono">
                      {f.eventName ?? f.eventId} — {f.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
              {summary.syncWarnings.length > 0 ? (
                <div className="mt-2 space-y-2">
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {summary.syncWarnings.map((warning) => (
                      <li key={warning.eventId}>
                        <span className="font-medium text-foreground">
                          {warning.eventName ?? warning.eventId}
                        </span>{" "}
                        — {warning.reason}
                      </li>
                    ))}
                  </ul>
                  {summary.retryRows.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void linkRows(summary.retryRows)}
                      disabled={submitting}
                    >
                      {submitting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Retry ticket sync
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {selectionNotice ? (
        <Card className="border-yellow-500/40 bg-yellow-500/5">
          <div className="flex items-start gap-2 text-sm text-yellow-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{selectionNotice}</p>
          </div>
        </Card>
      ) : null}

      {error && payload ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        </Card>
      ) : null}

      {events.length === 0 ? (
        <Card>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SearchX className="h-4 w-4" />
            Every event under this client already has a ticketing link.
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
            <p className="text-sm text-foreground">
              {selectedCount} selected / {events.length} unlinked
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onAutoLinkAll()}
                disabled={submitting}
              >
                Auto-link all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                disabled={submitting}
              >
                Clear
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void onLinkSelected()}
                disabled={submitting || selectedCount === 0}
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Link {selectedCount} selected
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Event</th>
                  <th className="px-4 py-2 text-left font-medium">Venue</th>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Candidate</th>
                  <th className="px-4 py-2 text-right font-medium">Score</th>
                  <th className="px-4 py-2 text-center font-medium">Link</th>
                </tr>
              </thead>
              <tbody>
                {events.map((row) => {
                  const sel = selections[row.eventId];
                  const selectedCandidate = row.candidates.find(
                    (c) => c.externalEventId === sel?.externalEventId,
                  );
                  return (
                    <EventDiscoveryRow
                      key={row.eventId}
                      row={row}
                      selectedCandidateId={sel?.externalEventId ?? null}
                      checked={Boolean(sel?.checked)}
                      disabled={submitting}
                      onToggle={toggleRow}
                      onLinkCandidate={(candidate) =>
                        void linkRows([
                          candidateToSelection(row.eventId, candidate),
                        ])
                      }
                      linking={linkingEventIds.has(row.eventId)}
                      selectedCandidate={selectedCandidate ?? null}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

interface RowProps {
  row: EventRow;
  selectedCandidateId: string | null;
  checked: boolean;
  disabled: boolean;
  linking: boolean;
  selectedCandidate: CandidateRow | null;
  onToggle: (eventId: string, externalEventId: string) => void;
  onLinkCandidate: (candidate: CandidateRow) => void;
}

function EventDiscoveryRow({
  row,
  selectedCandidateId,
  checked,
  disabled,
  linking,
  selectedCandidate,
  onToggle,
  onLinkCandidate,
}: RowProps) {
  const hasCandidates = row.candidates.length > 0;
  const [debugOpen, setDebugOpen] = useState<Set<string>>(() => new Set());
  const toggleDebug = (externalEventId: string) => {
    setDebugOpen((prev) => {
      const next = new Set(prev);
      if (next.has(externalEventId)) next.delete(externalEventId);
      else next.add(externalEventId);
      return next;
    });
  };
  return (
    <>
      <tr className="border-t border-border align-top">
        <td className="px-4 py-3 text-foreground">{row.eventName}</td>
        <td className="px-4 py-3 text-muted-foreground">
          {row.venueName ?? "—"}
        </td>
        <td className="px-4 py-3 text-muted-foreground">
          {fmtDate(row.eventDate)}
        </td>
        <td className="px-4 py-3 text-muted-foreground">
          {hasCandidates ? (
            <div className="space-y-1">
              <select
                value={selectedCandidateId ?? ""}
                disabled={disabled}
                onChange={(event) => {
                  if (!event.target.value) return;
                  onToggle(row.eventId, event.target.value);
                }}
                className="mb-2 h-8 w-full max-w-md rounded-md border border-border bg-background px-2 text-xs text-foreground"
              >
                <option value="">Pick a candidate…</option>
                {row.candidates.map((c) => (
                  <option key={c.externalEventId} value={c.externalEventId}>
                    {fmtConfidence(c.confidence)} · {c.externalEventName}
                  </option>
                ))}
              </select>
              {row.candidates.slice(0, 3).map((c) => {
                const isSelected = c.externalEventId === selectedCandidateId;
                const isDebugOpen = debugOpen.has(c.externalEventId);
                return (
                  <div
                    key={c.externalEventId}
                    className="flex items-start gap-2"
                  >
                    <input
                      type="radio"
                      name={`candidate-${row.eventId}`}
                      value={c.externalEventId}
                      checked={isSelected}
                      disabled={disabled}
                      onChange={() => onToggle(row.eventId, c.externalEventId)}
                      className="mt-1"
                    />
                    <span className="flex-1">
                      <button
                        type="button"
                        className="block text-left text-foreground hover:underline"
                        onClick={() => onToggle(row.eventId, c.externalEventId)}
                      >
                        {c.externalEventName}
                      </button>
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {c.connectionProvider} · {c.externalEventId}
                        {c.externalEventStartsAt
                          ? ` · ${fmtDate(c.externalEventStartsAt)}`
                          : ""}
                      </span>
                      {c.externalVenue ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {c.externalVenue}
                          {c.externalCapacity != null
                            ? ` · cap ${c.externalCapacity.toLocaleString("en-GB")}`
                            : ""}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="mt-0.5 block text-left text-[10px] font-medium text-primary hover:text-primary-hover underline underline-offset-2"
                        onClick={() => toggleDebug(c.externalEventId)}
                      >
                        {isDebugOpen ? "Hide" : "Show"} debug breakdown
                      </button>
                      {isDebugOpen ? (
                        <span className="block text-[10px] text-muted-foreground">
                          venue {fmtConfidence(c.venueScore)} · opponent{" "}
                          {fmtConfidence(c.opponentScore)} · date{" "}
                          {fmtConfidence(c.dateScore)} · name{" "}
                          {fmtConfidence(c.nameScore)}
                          {c.capacityMatch ? " · capacity match" : ""}
                        </span>
                      ) : null}
                      {c.manualDisambiguationRequired ? (
                        <span className="block text-[11px] font-medium text-yellow-600">
                          Manual disambiguation needed
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
              {row.candidates.length > 3 ? (
                <p className="text-[11px] text-muted-foreground">
                  …{row.candidates.length - 3} more below threshold
                </p>
              ) : null}
            </div>
          ) : row.skipReason ? (
            <span className="text-xs italic text-yellow-600">
              {row.skipReason}
            </span>
          ) : (
            <span className="text-xs italic text-muted-foreground">
              No candidates above 55% confidence
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-right font-mono">
          {selectedCandidate ? (
            <span className={confidenceClasses(selectedCandidate.confidence)}>
              {fmtConfidence(selectedCandidate.confidence)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-center">
          <div className="flex flex-col items-center gap-2">
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled || !hasCandidates || !selectedCandidateId}
              onChange={() => {
                if (!selectedCandidateId) return;
                onToggle(row.eventId, selectedCandidateId);
              }}
            />
            {selectedCandidate ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || linking}
                onClick={() => onLinkCandidate(selectedCandidate)}
                className="whitespace-nowrap"
              >
                {linking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Link this match
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
    </>
  );
}
