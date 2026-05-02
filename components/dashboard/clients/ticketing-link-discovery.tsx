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
 *   2. Each row seeds its selection with the top candidate IFF the
 *      confidence is >= 0.5 (the brief's auto-confirm threshold). Below
 *      that we leave the checkbox unticked so the operator consciously
 *      opts in.
 *   3. "Link selected" → `POST .../bulk-link` in one shot. Server upserts
 *      each `event_ticketing_links` row, then triggers rollup-sync per
 *      event with a concurrency of 5 (same budget as "Sync all").
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
  results?: Array<{
    eventId: string;
    ok: boolean;
    linkId: string | null;
    syncOk: boolean | null;
    syncError: string | null;
    linkError: string | null;
  }>;
}

type SelectionState = Record<string, { externalEventId: string; checked: boolean }>;

const AUTO_CONFIRM_THRESHOLD = 0.9;

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
  if (score >= 0.55) return "text-yellow-500";
  return "text-muted-foreground";
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
  const [summary, setSummary] = useState<
    | { linked: number; failed: number; failures: Array<{ eventId: string; reason: string }> }
    | null
  >(null);

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
        const initial: SelectionState = {};
        for (const row of json.events ?? []) {
          const top = row.candidates[0];
          if (top) {
            initial[row.eventId] = {
              externalEventId: top.externalEventId,
              checked: top.autoConfirm && !top.manualDisambiguationRequired,
            };
          }
        }
        setSelections(initial);
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

  const events = payload?.events ?? [];
  const connections = payload?.connections ?? [];
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

  const selectAllConfident = () => {
    setSelections((prev) => {
      const next: SelectionState = { ...prev };
      for (const row of events) {
        const top = row.candidates[0];
        if (!top) continue;
        if (top.autoConfirm && !top.manualDisambiguationRequired) {
          next[row.eventId] = {
            externalEventId: top.externalEventId,
            checked: true,
          };
        }
      }
      return next;
    });
  };

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

  const onLinkSelected = async () => {
    if (!payload) return;
    const rows: Array<{
      eventId: string;
      connectionId: string;
      externalEventId: string;
      externalEventUrl: string | null;
    }> = [];
    for (const row of events) {
      const sel = selections[row.eventId];
      if (!sel?.checked) continue;
      const candidate = row.candidates.find(
        (c) => c.externalEventId === sel.externalEventId,
      );
      if (!candidate) continue;
      rows.push({
        eventId: row.eventId,
        connectionId: candidate.connectionId,
        externalEventId: candidate.externalEventId,
        externalEventUrl: candidate.externalEventUrl,
      });
    }
    if (rows.length === 0) return;
    setSubmitting(true);
    setError(null);
    setSummary(null);
    try {
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
      const linked = json.linkedCount ?? 0;
      const failed = json.failedCount ?? 0;
      const failures = (json.results ?? [])
        .filter((r) => !r.ok)
        .map((r) => ({
          eventId: r.eventId,
          reason: r.linkError ?? r.syncError ?? "Unknown error",
        }));
      setSummary({ linked, failed, failures });

      // Strip the successful links from the local table. A full refetch
      // after bulk-link re-issues every Eventbrite listEvents() call
      // which is 5–15 seconds for a client with multiple connections —
      // feels sluggish. Removing locally and waiting for the next
      // explicit refresh lines up with the per-row flow everywhere else.
      const linkedIds = new Set(
        (json.results ?? [])
          .filter((r) => r.ok)
          .map((r) => r.eventId),
      );
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
    }
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
            summary.failed === 0
              ? "border-green-500/40 bg-green-500/5"
              : "border-yellow-500/40 bg-yellow-500/5"
          }
        >
          <div className="flex items-start gap-2 text-sm">
            {summary.failed === 0 ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-500" />
            )}
            <div>
              <p className="font-medium text-foreground">
                Linked {summary.linked} event
                {summary.linked === 1 ? "" : "s"}
                {summary.failed > 0 ? `, ${summary.failed} failed` : ""}
              </p>
              {summary.failures.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {summary.failures.map((f) => (
                    <li key={f.eventId} className="font-mono">
                      {f.eventId} — {f.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
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
                onClick={selectAllConfident}
                disabled={submitting}
              >
                Select auto-confirmed
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
  selectedCandidate: CandidateRow | null;
  onToggle: (eventId: string, externalEventId: string) => void;
}

function EventDiscoveryRow({
  row,
  selectedCandidateId,
  checked,
  disabled,
  selectedCandidate,
  onToggle,
}: RowProps) {
  const hasCandidates = row.candidates.length > 0;
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
              {row.candidates.slice(0, 3).map((c) => {
                const isSelected = c.externalEventId === selectedCandidateId;
                return (
                  <label
                    key={c.externalEventId}
                    className="flex cursor-pointer items-start gap-2"
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
                      <span className="block text-foreground">
                        {c.externalEventName}
                      </span>
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
                      <span className="block text-[10px] text-muted-foreground">
                        venue {fmtConfidence(c.venueScore)} · date{" "}
                        {fmtConfidence(c.dateScore)} · name{" "}
                        {fmtConfidence(c.nameScore)}
                        {c.capacityMatch ? " · capacity match" : ""}
                      </span>
                      {c.manualDisambiguationRequired ? (
                        <span className="block text-[11px] font-medium text-yellow-600">
                          Manual disambiguation needed
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
              {row.candidates.length > 3 ? (
                <p className="text-[11px] text-muted-foreground">
                  …{row.candidates.length - 3} more below threshold
                </p>
              ) : null}
            </div>
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
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled || !hasCandidates || !selectedCandidateId}
            onChange={() => {
              if (!selectedCandidateId) return;
              onToggle(row.eventId, selectedCandidateId);
            }}
          />
        </td>
      </tr>
    </>
  );
}
