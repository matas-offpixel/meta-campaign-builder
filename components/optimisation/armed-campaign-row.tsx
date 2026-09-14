"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { AutomationArmControl } from "@/components/optimisation/automation-arm-control";
import { PostLaunchControls } from "@/components/optimisation/post-launch-controls";
import { Datum } from "@/components/steps/step-surface";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { VIZ_TYPE } from "@/lib/viz/tokens";
import {
  formatBudgetImpactLine,
  formatMetricImpactLine,
  formatResultImpactLine,
} from "@/lib/optimisation/armed-impact";
import {
  formatActingLine,
  type ArmedCampaignRow as ArmedRow,
} from "@/lib/optimisation/armed-read-model";
import type { AutomationArm } from "@/lib/optimisation/automation-ui";
import { REWIRE_PREVIEW_SENTENCE } from "@/lib/campaign-event-rewire";
import {
  formatDescribeCellLine,
  formatDescribeUnreadable,
  formatEmptyDescribeTable,
  type DescribeCell,
} from "@/lib/optimisation/describe-cells";
import {
  DEFAULT_ARMED_SORT,
  armLabel,
  formatActingCell,
  formatDailyBudgetCell,
  formatMetricCell,
  formatNetChangeCell,
  formatPercentCell,
  formatResultsCell,
  nextArmedSort,
  partitionArmedRows,
  readArmedTableSort,
  writeArmedTableSort,
  sortArmedRows,
  vsCap,
  vsTarget,
  type ArmedSortKey,
  type ArmedSortState,
} from "@/lib/optimisation/armed-table";

function ImpactSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 48;
      const y = 12 - ((value - min) / span) * 12;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width="48" height="12" viewBox="0 0 48 12" aria-hidden="true" className="shrink-0 text-muted-foreground">
      <polyline fill="none" stroke="currentColor" strokeWidth="1" points={points} />
    </svg>
  );
}

function ImpactLines({ row }: { row: ArmedRow }) {
  const budget = formatBudgetImpactLine(row.impact, row.controls.currency);
  const metric = formatMetricImpactLine(row.impact);
  const results = formatResultImpactLine(row.impact);
  return (
    <div className="mt-1 min-w-0 space-y-0.5">
      <Datum className="text-muted-foreground">{budget}</Datum>
      {metric ? (
        <Datum className="min-w-0 text-muted-foreground">{metric}</Datum>
      ) : null}
      {results ? (
        <Datum className="min-w-0 text-muted-foreground">{results}</Datum>
      ) : null}
      <Datum className="text-muted-foreground">{row.describeLine ?? "not enough data"}</Datum>
    </div>
  );
}

function DescribeCellsTable({
  cells,
  unreadable,
}: {
  cells: DescribeCell[];
  unreadable: boolean;
}) {
  if (unreadable) {
    return <Datum className="text-muted-foreground">{formatDescribeUnreadable()}</Datum>;
  }
  if (cells.length === 0) {
    return <Datum className="text-muted-foreground">{formatEmptyDescribeTable()}</Datum>;
  }
  return (
    <div className="space-y-1">
      {cells.map((cell) => {
        const key = `${cell.key.clientId}|${cell.key.sourceType}|${cell.key.objective}|${cell.key.phaseAtLaunch}|${cell.key.advantagePlusEffective}`;
        return (
          <Datum key={key} className="text-muted-foreground">
            {formatDescribeCellLine(cell)}
          </Datum>
        );
      })}
    </div>
  );
}

function WiringButton({
  row,
  onApplied,
}: {
  row: ArmedRow;
  onApplied: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wiring = row.wiring;
  if (!wiring || wiring.kind === "ambiguous") return null;
  const match = wiring;
  const allowed =
    row.canWrite && (match.kind === "rewire" || (match.kind === "stamp_event" && row.canStampEvent));
  if (!allowed) {
    return <Datum className="text-muted-foreground">{match.buttonLabel}</Datum>;
  }

  async function apply() {
    if (match.kind === "stamp_event") {
      const ok = window.confirm(
        `Set event code on ${match.fromLabel} to ${match.code}? This writes the client's event row.`,
      );
      if (!ok) return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/optimisation/campaigns/${row.id}/wiring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: match.kind }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Could not apply");
        return;
      }
      onApplied();
    } catch {
      setError("Could not apply");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void apply()}>
        {pending ? "Applying…" : match.buttonLabel}
      </Button>
      {error ? <Datum className="text-destructive">{error}</Datum> : null}
    </div>
  );
}

function liveRewireRows(rows: ArmedRow[]): ArmedRow[] {
  return rows.filter((row) => row.arm === "live");
}

function RewireAllBar({
  rows,
  onApplied,
}: {
  rows: ArmedRow[];
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writable = (row: ArmedRow) => row.wiring?.kind === "rewire" && row.canWrite;
  const matched = rows.filter(writable);
  const skipped = rows.filter(
    (row) => row.wiring != null && !writable(row),
  );
  if (matched.length === 0 && skipped.length === 0) return null;
  const live = liveRewireRows(matched);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/optimisation/campaigns/wiring-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: matched.map((row) => row.id) }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        results?: Array<{ draftId: string; ok: boolean; error?: string }>;
      };
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Could not apply");
        return;
      }
      const failed = (json.results ?? []).filter((result) => !result.ok);
      if (failed.length > 0) {
        setError(
          `${failed.length} no longer resolved — the rest applied. Reload and review.`,
        );
      } else {
        setOpen(false);
      }
      onApplied();
    } catch {
      setError("Could not apply");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-card px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Datum className="text-muted-foreground">
          {matched.length} matched, {skipped.length} not included
        </Datum>
        {matched.length > 0 ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
            {open ? "Hide preview" : "Rewire all matched"}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-2">
          <Datum className="text-muted-foreground">{REWIRE_PREVIEW_SENTENCE}</Datum>
          {live.length > 0 ? (
            <Datum className="text-amber-800 dark:text-amber-200">
              Live and will resume on the next tick:{" "}
              {live.map((row) => row.name).join(", ")}
            </Datum>
          ) : null}
          <ul className="space-y-1">
            {matched.map((row) => (
              <li key={row.id}>
                <Datum className="text-muted-foreground">
                  {row.name} — {row.wiring && "fromLabel" in row.wiring
                    ? `${row.wiring.fromLabel} → ${row.wiring.toLabel}`
                    : row.wiring?.kind}
                </Datum>
              </li>
            ))}
          </ul>
          {skipped.length > 0 ? (
            <div className="space-y-1">
              <Datum className="text-muted-foreground">Not included</Datum>
              {skipped.map((row) => (
                <Datum key={row.id} className="text-muted-foreground">
                  {row.name} — {row.wiring?.kind === "ambiguous"
                    ? row.wiring.reason
                    : row.wiring?.kind === "stamp_event"
                      ? "stamp is per-row"
                      : "no write access"}
                </Datum>
              ))}
            </div>
          ) : null}
          <Button type="button" size="sm" disabled={pending} onClick={() => void confirm()}>
            {pending ? "Applying…" : `Apply ${matched.length} matched`}
          </Button>
          {error ? <Datum className="text-destructive">{error}</Datum> : null}
        </div>
      ) : null}
    </div>
  );
}

function AbsentOrValue({
  text,
  title,
  children,
}: {
  text: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5" title={title}>
      <span className={text === "—" ? "text-muted-foreground" : undefined}>{text}</span>
      {children}
    </span>
  );
}

function SortableTh({
  label,
  k,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  k: ArmedSortKey;
  sort: ArmedSortState;
  onSort: (key: ArmedSortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = sort.key === k;
  return (
    <th
      className={`whitespace-nowrap px-2 py-2 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""} hover:text-foreground`}
      >
        {label}
        {isActive ? <span aria-hidden>{sort.dir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
}

function ArmedTableRow({
  row,
  expanded,
  onToggle,
  onRowChange,
  onWiringApplied,
}: {
  row: ArmedRow;
  expanded: boolean;
  onToggle: () => void;
  onRowChange: (next: ArmedRow) => void;
  onWiringApplied: () => void;
}) {
  const [openControls, setOpenControls] = useState(false);
  const acting = formatActingLine(row.arm, row.lastDecision, row.lastWrite);
  const actingCell = formatActingCell(row.lastDecision);
  const daily = formatDailyBudgetCell(row);
  const net = formatNetChangeCell(row);
  const metric = formatMetricCell(row);
  const results = formatResultsCell(row);
  const vsTargetCell = vsTarget(row);
  const vsCapCell = vsCap(row);
  const target = formatPercentCell(vsTargetCell);
  const cap = formatPercentCell(vsCapCell);

  function onRowClick(event: MouseEvent<HTMLTableRowElement>) {
    if ((event.target as HTMLElement).closest("a,button,input,select,textarea")) return;
    onToggle();
  }

  return (
    <>
      <tr
        className="cursor-pointer border-t border-border hover:bg-muted/30"
        onClick={onRowClick}
      >
        <td className="px-2 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onToggle}
              className="shrink-0 text-muted-foreground"
              aria-expanded={expanded}
              aria-label={expanded ? "Hide detail" : "Show detail"}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
            <Link
              href={`/campaign/${row.id}`}
              className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium hover:underline ${VIZ_TYPE.body}`}
            >
              {row.name}
            </Link>
          </div>
        </td>
        <td className="whitespace-nowrap px-2 py-2">{armLabel(row.arm)}</td>
        <td className="px-2 py-2">
          <span className="inline-flex min-w-0 items-center gap-1">
            {row.eventLabel ? (
              row.eventId ? (
                <Link
                  href={`/events/${row.eventId}`}
                  className="overflow-hidden text-ellipsis whitespace-nowrap hover:underline"
                >
                  {row.eventLabel}
                </Link>
              ) : (
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  {row.eventLabel}
                </span>
              )
            ) : (
              <span className="text-muted-foreground" title="no event">
                —
              </span>
            )}
            {row.eventWarning ? (
              <span title={row.eventWarning} className="inline-flex">
                <AlertTriangle
                  className="h-3 w-3 shrink-0 text-amber-600"
                  aria-label={row.eventWarning}
                />
              </span>
            ) : null}
          </span>
        </td>
        <td className="whitespace-nowrap px-2 py-2" title={actingCell.title}>
          <span className={actingCell.text === "—" ? "text-muted-foreground" : undefined}>
            {actingCell.text}
          </span>
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
          <AbsentOrValue text={daily.text} title={daily.title} />
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
          <AbsentOrValue text={net.text} title={net.title} />
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
          <AbsentOrValue text={metric.text} title={metric.title}>
            <ImpactSparkline values={row.impact.metricSeries} />
          </AbsentOrValue>
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
          <AbsentOrValue text={target.text} title={target.title} />
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
          <AbsentOrValue text={cap.text} title={cap.title} />
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
          <AbsentOrValue text={results.text} title={results.title}>
            <ImpactSparkline
              values={row.impact.resultSeries.filter((value): value is number => value != null)}
            />
          </AbsentOrValue>
        </td>
        <td className="px-2 py-2">
          <div className="flex flex-col items-end gap-2">
            <AutomationArmControl
              variant="row"
              draftId={row.id}
              currency={row.controls.currency}
              baseCampaignBudget={row.controls.baseCampaignBudget}
              hardBudgetCeiling={row.controls.hardBudgetCeiling}
              readOnly={!row.canWrite}
              ownerLabel={row.canWrite ? undefined : row.ownerLabel}
              initialArm={row.arm}
              onArmChange={(arm: AutomationArm) => onRowChange({ ...row, arm })}
            />
            {row.arm !== "off" && row.canWrite ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setOpenControls((open) => !open)}
              >
                {openControls ? "Hide target & cap" : "Adjust target & cap"}
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={11} className="px-3 py-3">
            <div className="min-w-0">
              <Datum className="text-muted-foreground">{acting}</Datum>
              {row.lastDecision?.reasonText ? (
                <Datum className="mt-0.5 line-clamp-2 min-w-0 text-muted-foreground">
                  {row.lastDecision.reasonText}
                </Datum>
              ) : null}
              <ImpactLines row={row} />
              {vsTargetCell.kind === "present" ? (
                <Datum className="mt-0.5 text-muted-foreground">{vsTargetCell.detail}</Datum>
              ) : null}
              {vsCapCell.kind === "present" ? (
                <Datum className="mt-0.5 text-muted-foreground">{vsCapCell.detail}</Datum>
              ) : null}
              {row.eventLabel ? (
                <Datum className="mt-0.5 text-muted-foreground">
                  Wired to{" "}
                  {row.eventId ? (
                    <Link href={`/events/${row.eventId}`} className="hover:underline">
                      {row.eventLabel}
                    </Link>
                  ) : (
                    row.eventLabel
                  )}
                </Datum>
              ) : null}
              {row.eventWarning ? (
                <div className="mt-1 space-y-1">
                  <Datum className="text-amber-800 dark:text-amber-200">
                    {row.eventWarning}
                  </Datum>
                  <WiringButton row={row} onApplied={onWiringApplied} />
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
      {openControls && row.arm !== "off" && row.canWrite ? (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={11} className="px-3 py-3">
            <PostLaunchControls
              row={row}
              onSaved={(partial) => onRowChange({ ...row, ...partial })}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ArmedCampaignTable({
  rows,
  sort,
  expanded,
  onSort,
  onToggle,
  onRowChange,
  onWiringApplied,
}: {
  rows: ArmedRow[];
  sort: ArmedSortState;
  expanded: Set<string>;
  onSort: (key: ArmedSortKey) => void;
  onToggle: (id: string) => void;
  onRowChange: (next: ArmedRow) => void;
  onWiringApplied: () => void;
}) {
  const sorted = sortArmedRows(rows, sort);

  if (sorted.length === 0) {
    return <Datum className="text-muted-foreground">No campaigns in this list.</Datum>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className={`w-full min-w-[1280px] border-collapse ${VIZ_TYPE.body}`}>
        <thead>
          <tr className={`bg-muted/50 text-left text-muted-foreground ${VIZ_TYPE.micro}`}>
            <SortableTh label="Campaign" k="campaign" sort={sort} onSort={onSort} />
            <SortableTh label="Arm" k="arm" sort={sort} onSort={onSort} />
            <SortableTh label="Event" k="event" sort={sort} onSort={onSort} />
            <SortableTh label="Acting" k="acting" sort={sort} onSort={onSort} />
            <SortableTh label="Daily budget" k="dailyBudget" sort={sort} onSort={onSort} align="right" />
            <SortableTh label="Net change" k="netChange" sort={sort} onSort={onSort} align="right" />
            <SortableTh label="Metric" k="metric" sort={sort} onSort={onSort} align="right" />
            <SortableTh label="vs target" k="vsTarget" sort={sort} onSort={onSort} align="right" />
            <SortableTh label="vs cap" k="vsCap" sort={sort} onSort={onSort} align="right" />
            <SortableTh label="Results" k="results" sort={sort} onSort={onSort} align="right" />
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => (
            <ArmedTableRow
              key={item.id}
              row={item}
              expanded={expanded.has(item.id)}
              onToggle={() => onToggle(item.id)}
              onRowChange={onRowChange}
              onWiringApplied={onWiringApplied}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ArmedCampaignList({
  eventId,
  onCount,
}: {
  eventId?: string;
  onCount?: (count: number) => void;
}) {
  const [rows, setRows] = useState<ArmedRow[] | null>(null);
  const [describeCells, setDescribeCells] = useState<DescribeCell[]>([]);
  const [describeUnreadable, setDescribeUnreadable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [subTab, setSubTab] = useState<"active" | "ended">("active");
  const [sort, setSort] = useState<ArmedSortState>(DEFAULT_ARMED_SORT);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;
  const reload = () => setReloadToken((n) => n + 1);

  useEffect(() => {
    setSort(readArmedTableSort());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const qs = eventId ? `?eventId=${encodeURIComponent(eventId)}` : "";
    setLoading(true);
    fetch(`/api/optimisation/campaigns${qs}`)
      .then(async (res) => {
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          campaigns?: ArmedRow[];
          describeCells?: DescribeCell[];
          describeUnreadable?: boolean;
        };
        if (cancelled) return;
        if (!res.ok || json.ok === false) {
          setError(json.error ?? "Could not load campaigns");
          setRows([]);
          onCountRef.current?.(0);
        } else {
          setError(null);
          const next = json.campaigns ?? [];
          setRows(next);
          setDescribeCells(json.describeCells ?? []);
          setDescribeUnreadable(json.describeUnreadable === true);
          onCountRef.current?.(next.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load campaigns");
          setRows([]);
          onCountRef.current?.(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, reloadToken]);

  function onSort(key: ArmedSortKey) {
    setSort((current) => {
      const next = nextArmedSort(current, key);
      writeArmedTableSort(next);
      return next;
    });
  }

  function onToggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onRowChange(next: ArmedRow) {
    setRows((current) =>
      (current ?? []).map((item) => (item.id === next.id ? next : item)),
    );
  }

  if (loading) {
    return <Datum className="text-muted-foreground">Loading campaigns…</Datum>;
  }
  if (error) {
    return <Datum className="text-destructive">{error}</Datum>;
  }
  if (!rows?.length) {
    return (
      <div className="space-y-2">
        {eventId ? (
          <DescribeCellsTable cells={describeCells} unreadable={describeUnreadable} />
        ) : null}
        <Datum className="text-muted-foreground">
          {eventId ? "No campaigns wired to this event." : "No Shadow or Live campaigns."}
        </Datum>
      </div>
    );
  }

  const { active, ended } = partitionArmedRows(rows);
  const visible = subTab === "ended" ? ended : active;

  return (
    <div className="space-y-2">
      <RewireAllBar rows={rows} onApplied={reload} />
      {eventId ? (
        <DescribeCellsTable cells={describeCells} unreadable={describeUnreadable} />
      ) : null}
      <Tabs
        tabs={[
          { id: "active", label: "Active", count: active.length },
          { id: "ended", label: "Ended", count: ended.length },
        ]}
        activeTab={subTab}
        onTabChange={(id) => setSubTab(id === "ended" ? "ended" : "active")}
      />
      <ArmedCampaignTable
        rows={visible}
        sort={sort}
        expanded={expanded}
        onSort={onSort}
        onToggle={onToggle}
        onRowChange={onRowChange}
        onWiringApplied={reload}
      />
    </div>
  );
}
