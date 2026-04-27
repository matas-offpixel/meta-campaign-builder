"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Share2,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  ReadinessStatus,
  ReadinessTicketingMode,
} from "@/lib/db/event-readiness";

/**
 * Rollout audit view — a flat table of every event for a client with:
 *   - checkboxes to select rows for bulk actions
 *   - per-row pill indicating readiness (ready / partial / blocked)
 *   - hover tooltip listing the missing requirements
 *   - bulk actions: generate share links, run rollup-sync, audit Meta
 *   - individual row actions: copy share link, sync now, edit, report
 *   - "Copy table for client comms" → markdown snippet of share URLs
 *
 * Component receives a flattened row shape prebuilt by the SSR page so
 * the DB types / table joins don't leak into the client bundle.
 */

type ReadinessMode = ReadinessTicketingMode;

export interface RolloutRowProps {
  eventId: string;
  name: string | null;
  eventCode: string | null;
  eventDate: string | null;
  venueName: string | null;
  capacity: number | null;
  generalSaleAt: string | null;
  status: ReadinessStatus;
  missing: string[];
  warnings: string[];
  ticketingMode: ReadinessMode;
  hasShare: boolean;
  shareToken: string | null;
  shareCanEdit: boolean;
  shareEnabled: boolean;
  primaryProvider: string | null;
  primaryConnectionStatus: string | null;
  externalEventId: string | null;
}

interface Props {
  clientId: string;
  clientName: string;
  metaAdAccountId: string | null;
  counts: { ready: number; partial: number; blocked: number; total: number };
  rows: RolloutRowProps[];
}

type RowOp = {
  kind: "share" | "sync";
  status: "running" | "ok" | "error";
  message?: string;
};

const STATUS_LABEL: Record<ReadinessStatus, string> = {
  ready: "Ready",
  partial: "Needs attention",
  blocked: "Blocked",
};

const STATUS_VARIANT: Record<
  ReadinessStatus,
  "success" | "warning" | "destructive"
> = {
  ready: "success",
  partial: "warning",
  blocked: "destructive",
};

const TICKETING_LABEL: Record<ReadinessMode, string> = {
  eventbrite: "Eventbrite",
  fourthefans: "4thefans",
  manual: "Manual",
  none: "None",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

function shareUrl(origin: string, token: string): string {
  return `${origin}/share/report/${token}`;
}

export function ClientRolloutView({
  clientId,
  clientName,
  metaAdAccountId,
  counts,
  rows: initialRows,
}: Props) {
  const [rows, setRows] = useState<RolloutRowProps[]>(initialRows);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [rowOps, setRowOps] = useState<Record<string, RowOp | undefined>>({});
  const [bulkRunning, setBulkRunning] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [auditState, setAuditState] = useState<{
    running: boolean;
    message: string | null;
    orphans: Array<{ id: string; name: string }>;
    matched: number;
    opened: boolean;
  }>({ running: false, message: null, orphans: [], matched: 0, opened: false });
  const [copied, setCopied] = useState(false);

  const origin =
    typeof window === "undefined" ? "" : window.location.origin;

  const allSelected =
    rows.length > 0 && rows.every((r) => selection.has(r.eventId));
  const noneSelected = selection.size === 0;

  const toggleRow = (eventId: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelection(new Set());
    } else {
      setSelection(new Set(rows.map((r) => r.eventId)));
    }
  };

  const markOp = (eventId: string, op: RowOp | undefined) => {
    setRowOps((prev) => ({ ...prev, [eventId]: op }));
  };

  const updateRow = useCallback(
    (eventId: string, patch: Partial<RolloutRowProps>) => {
      setRows((prev) =>
        prev.map((r) => (r.eventId === eventId ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  const createShareFor = useCallback(
    async (eventId: string): Promise<RolloutRowProps | null> => {
      markOp(eventId, { kind: "share", status: "running" });
      try {
        const res = await fetch("/api/share/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId }),
        });
        const text = await res.text();
        const json = text ? (JSON.parse(text) as {
          share?: {
            token: string;
            can_edit: boolean;
            enabled: boolean;
            event_id: string | null;
          };
          error?: string;
        }) : {};
        if (!res.ok || !json.share) {
          throw new Error(
            json.error ?? `HTTP ${res.status}: ${text.slice(0, 120)}`,
          );
        }
        markOp(eventId, { kind: "share", status: "ok" });
        const patch: Partial<RolloutRowProps> = {
          shareToken: json.share.token,
          shareCanEdit: json.share.can_edit,
          shareEnabled: json.share.enabled,
          hasShare: true,
        };
        updateRow(eventId, patch);
        return { ...patch, eventId } as RolloutRowProps;
      } catch (err) {
        markOp(eventId, {
          kind: "share",
          status: "error",
          message: err instanceof Error ? err.message : "Share create failed",
        });
        return null;
      }
    },
    [updateRow],
  );

  const runSyncFor = useCallback(async (eventId: string) => {
    markOp(eventId, { kind: "sync", status: "running" });
    try {
      const res = await fetch(
        `/api/ticketing/rollup-sync?eventId=${encodeURIComponent(eventId)}`,
        { method: "POST" },
      );
      const text = await res.text();
      const json = text ? (JSON.parse(text) as {
        ok?: boolean;
        error?: string;
      }) : {};
      if (!res.ok || json.ok === false) {
        throw new Error(
          json.error ?? `HTTP ${res.status}: ${text.slice(0, 120)}`,
        );
      }
      markOp(eventId, { kind: "sync", status: "ok" });
    } catch (err) {
      markOp(eventId, {
        kind: "sync",
        status: "error",
        message: err instanceof Error ? err.message : "Sync failed",
      });
    }
  }, []);

  const bulkGenerateShares = useCallback(async () => {
    const targets = rows.filter(
      (r) => selection.has(r.eventId) && !r.hasShare,
    );
    if (targets.length === 0) {
      setBulkMessage("Every selected row already has a share link.");
      return;
    }
    setBulkRunning("share");
    setBulkMessage(null);
    const results = await Promise.allSettled(
      targets.map((r) => createShareFor(r.eventId)),
    );
    const ok = results.filter(
      (r) => r.status === "fulfilled" && r.value !== null,
    ).length;
    const err = results.length - ok;
    setBulkMessage(
      err === 0
        ? `Generated ${ok} share link${ok === 1 ? "" : "s"}.`
        : `Generated ${ok} · ${err} failed — see row errors below.`,
    );
    setBulkRunning(null);
  }, [rows, selection, createShareFor]);

  const bulkRunSync = useCallback(async () => {
    const targets = rows.filter((r) => selection.has(r.eventId));
    if (targets.length === 0) return;
    setBulkRunning("sync");
    setBulkMessage(null);
    await Promise.allSettled(targets.map((r) => runSyncFor(r.eventId)));
    const errs = targets.filter((r) => rowOps[r.eventId]?.status === "error");
    setBulkMessage(
      `Sync fired for ${targets.length} event${targets.length === 1 ? "" : "s"}${
        errs.length ? ` · ${errs.length} failed` : ""
      }.`,
    );
    setBulkRunning(null);
  }, [rows, selection, runSyncFor, rowOps]);

  const auditMetaCampaigns = useCallback(async () => {
    if (!metaAdAccountId) {
      setAuditState({
        running: false,
        opened: true,
        message:
          "Client has no meta_ad_account_id — set one on /clients/[id]/edit first.",
        orphans: [],
        matched: 0,
      });
      return;
    }
    setAuditState((prev) => ({
      ...prev,
      running: true,
      opened: true,
      message: null,
    }));
    try {
      const res = await fetch(
        `/api/meta/campaigns?adAccountId=${encodeURIComponent(metaAdAccountId)}&filter=all&limit=50`,
      );
      const text = await res.text();
      const json = text ? (JSON.parse(text) as {
        data?: Array<{ id: string; name: string }>;
        error?: string;
        paging?: { hasMore?: boolean };
      }) : {};
      if (!res.ok) {
        throw new Error(
          json.error ?? `HTTP ${res.status}: ${text.slice(0, 120)}`,
        );
      }
      const campaigns = json.data ?? [];
      const codes = rows
        .map((r) => r.eventCode?.trim())
        .filter((c): c is string => !!c);
      const orphans: Array<{ id: string; name: string }> = [];
      let matched = 0;
      for (const c of campaigns) {
        const hit = codes.find((code) => c.name.includes(`[${code}]`));
        if (hit) matched++;
        else orphans.push({ id: c.id, name: c.name });
      }
      const more = json.paging?.hasMore
        ? " (first 50 campaigns only — narrow search if needed)"
        : "";
      setAuditState({
        running: false,
        opened: true,
        message: `${matched} campaign${matched === 1 ? "" : "s"} match an event_code · ${orphans.length} without a [code] bracket${more}.`,
        orphans,
        matched,
      });
    } catch (err) {
      setAuditState({
        running: false,
        opened: true,
        message:
          err instanceof Error ? err.message : "Audit failed — see console",
        orphans: [],
        matched: 0,
      });
    }
  }, [metaAdAccountId, rows]);

  const copyCommsBlock = useMemo(() => {
    const lines: string[] = [];
    lines.push(
      `Hey ${clientName} — here are the dashboard links for your upcoming events:`,
    );
    lines.push("");
    const linkable = rows
      .filter((r) => r.hasShare && r.shareToken && r.shareEnabled)
      .slice()
      .sort((a, b) => {
        const aT = a.eventDate ? Date.parse(a.eventDate) : 0;
        const bT = b.eventDate ? Date.parse(b.eventDate) : 0;
        return aT - bT;
      });
    if (linkable.length === 0) {
      lines.push("_No generated share links yet — use bulk action above._");
    } else {
      for (const r of linkable) {
        const label = `${r.name ?? r.eventCode ?? r.eventId}${r.eventDate ? ` (${formatDate(r.eventDate)})` : ""}`;
        lines.push(`- ${label}: ${shareUrl(origin, r.shareToken!)}`);
      }
    }
    lines.push("");
    lines.push(
      "Click any link to see live ticket sales, ad performance, and add PR / influencer spend yourself.",
    );
    return lines.join("\n");
  }, [clientName, rows, origin]);

  const handleCopyComms = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyCommsBlock);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [copyCommsBlock]);

  const handleCopyShareUrl = useCallback(
    async (eventId: string) => {
      const row = rows.find((r) => r.eventId === eventId);
      if (!row?.shareToken) return;
      try {
        await navigator.clipboard.writeText(shareUrl(origin, row.shareToken));
        markOp(eventId, { kind: "share", status: "ok", message: "Copied" });
        setTimeout(() => markOp(eventId, undefined), 1400);
      } catch {
        markOp(eventId, {
          kind: "share",
          status: "error",
          message: "Clipboard blocked",
        });
      }
    },
    [rows, origin],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="success">
            {counts.ready} ready
          </Badge>
          <Badge variant="warning">{counts.partial} partial</Badge>
          <Badge variant="destructive">{counts.blocked} blocked</Badge>
          <span className="text-muted-foreground">
            across {counts.total} event{counts.total === 1 ? "" : "s"}
          </span>
          {selection.size > 0 ? (
            <span className="text-muted-foreground">
              · {selection.size} selected
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={bulkGenerateShares}
            disabled={noneSelected || bulkRunning !== null}
          >
            {bulkRunning === "share" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Share2 className="h-3.5 w-3.5" />
            )}
            Generate share links
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={bulkRunSync}
            disabled={noneSelected || bulkRunning !== null}
          >
            {bulkRunning === "sync" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Run rollup sync
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={auditMetaCampaigns}
            disabled={auditState.running}
          >
            {auditState.running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            Audit Meta campaigns
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopyComms}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy table for client comms"}
          </Button>
        </div>
      </div>

      {bulkMessage ? (
        <p className="text-xs text-muted-foreground">{bulkMessage}</p>
      ) : null}

      {auditState.opened ? (
        <div className="rounded-md border border-border bg-card p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-medium">Meta campaigns audit</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() =>
                setAuditState((prev) => ({ ...prev, opened: false }))
              }
              aria-label="Close audit"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          </div>
          {auditState.message ? (
            <p className="text-muted-foreground">{auditState.message}</p>
          ) : null}
          {auditState.orphans.length > 0 ? (
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-muted-foreground">
              {auditState.orphans.slice(0, 20).map((o) => (
                <li key={o.id}>
                  <span className="font-medium text-foreground">{o.name}</span>
                  <span className="text-muted-foreground"> · {o.id}</span>
                </li>
              ))}
              {auditState.orphans.length > 20 ? (
                <li>…+{auditState.orphans.length - 20} more</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[960px] border-collapse text-xs">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2 text-left">
                <Checkbox
                  id="select-all"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all events"
                />
              </th>
              <th className="px-2 py-2 text-left">Event</th>
              <th className="px-2 py-2 text-left">Date</th>
              <th className="px-2 py-2 text-left">Venue</th>
              <th className="px-2 py-2 text-right">Capacity</th>
              <th className="px-2 py-2 text-left">Event code</th>
              <th className="px-2 py-2 text-left">Ticketing</th>
              <th className="px-2 py-2 text-left">Share link</th>
              <th className="px-2 py-2 text-left">Ready?</th>
              <th className="px-2 py-2 text-right"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  No events for this client yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const op = rowOps[r.eventId];
                const selected = selection.has(r.eventId);
                const tooltipLines = [
                  ...r.missing.map((m) => `✖ ${m}`),
                  ...r.warnings.map((w) => `⚠ ${w}`),
                ];
                const tooltip = tooltipLines.length
                  ? tooltipLines.join("\n")
                  : "All checks passing.";
                return (
                  <tr
                    key={r.eventId}
                    className={`border-t border-border ${selected ? "bg-primary/5" : "odd:bg-background even:bg-card/40"}`}
                  >
                    <td className="px-2 py-2 align-top">
                      <Checkbox
                        id={`row-${r.eventId}`}
                        checked={selected}
                        onChange={() => toggleRow(r.eventId)}
                        aria-label={`Select ${r.name ?? r.eventId}`}
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <Link
                        href={`/events/${r.eventId}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {r.name ?? "(untitled)"}
                      </Link>
                    </td>
                    <td className="px-2 py-2 align-top tabular-nums text-muted-foreground">
                      {formatDate(r.eventDate)}
                    </td>
                    <td className="px-2 py-2 align-top text-muted-foreground">
                      {r.venueName ?? "—"}
                    </td>
                    <td className="px-2 py-2 align-top text-right tabular-nums">
                      {r.capacity != null
                        ? r.capacity.toLocaleString("en-GB")
                        : "—"}
                    </td>
                    <td className="px-2 py-2 align-top font-mono text-[10px]">
                      {r.eventCode ?? "—"}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <Badge
                        variant={
                          r.ticketingMode === "none" ? "outline" : "default"
                        }
                      >
                        {TICKETING_LABEL[r.ticketingMode]}
                      </Badge>
                      {r.externalEventId ? (
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          ext: {r.externalEventId}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 align-top">
                      {r.hasShare && r.shareToken ? (
                        <div className="flex items-center gap-1">
                          <Link
                            href={`/share/report/${r.shareToken}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span className="font-mono text-[10px]">
                              {r.shareToken.slice(0, 6)}…
                            </span>
                          </Link>
                          <button
                            type="button"
                            aria-label="Copy share link"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => handleCopyShareUrl(r.eventId)}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          {!r.shareCanEdit ? (
                            <Badge variant="outline" className="text-[10px]">
                              view-only
                            </Badge>
                          ) : null}
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => void createShareFor(r.eventId)}
                          disabled={op?.kind === "share" && op.status === "running"}
                        >
                          {op?.kind === "share" && op.status === "running" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Share2 className="h-3 w-3" />
                          )}
                          Generate
                        </Button>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <span
                        title={tooltip}
                        className="inline-flex items-center gap-1"
                      >
                        <Badge variant={STATUS_VARIANT[r.status]}>
                          {STATUS_LABEL[r.status]}
                        </Badge>
                        {r.missing.length > 0 || r.warnings.length > 0 ? (
                          <AlertTriangle
                            className="h-3 w-3 text-muted-foreground"
                            aria-label="hover for details"
                          />
                        ) : null}
                      </span>
                      {op?.status === "error" ? (
                        <p className="mt-0.5 text-[10px] text-destructive">
                          {op.message}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right align-top">
                      <div className="inline-flex items-center gap-0.5">
                        <Link
                          href={`/events/${r.eventId}/edit`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Edit event"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </Link>
                        <button
                          type="button"
                          aria-label="Run rollup sync"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                          disabled={op?.kind === "sync" && op.status === "running"}
                          onClick={() => void runSyncFor(r.eventId)}
                        >
                          {op?.kind === "sync" && op.status === "running" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                        </button>
                        <Link
                          href={`/events/${r.eventId}?tab=reporting`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="View report"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <details className="rounded-md border border-border bg-card p-3 text-xs">
        <summary className="cursor-pointer font-medium">
          Preview comms block ({rows.filter((r) => r.hasShare).length} links)
        </summary>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
          {copyCommsBlock}
        </pre>
      </details>

      <p className="text-[10px] text-muted-foreground">
        Client id: <span className="font-mono">{clientId}</span>
        {metaAdAccountId ? (
          <>
            {" · Meta ad account: "}
            <span className="font-mono">{metaAdAccountId}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
