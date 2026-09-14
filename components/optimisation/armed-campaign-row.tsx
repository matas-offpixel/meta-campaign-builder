"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AutomationArmControl } from "@/components/optimisation/automation-arm-control";
import { PostLaunchControls } from "@/components/optimisation/post-launch-controls";
import { Datum } from "@/components/steps/step-surface";
import { Button } from "@/components/ui/button";
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
        <div className="flex min-w-0 items-center gap-2">
          <Datum className="min-w-0 text-muted-foreground">{metric}</Datum>
          <ImpactSparkline values={row.impact.metricSeries} />
        </div>
      ) : null}
      {results ? (
        <div className="flex min-w-0 items-center gap-2">
          <Datum className="min-w-0 text-muted-foreground">{results}</Datum>
          <ImpactSparkline
            values={row.impact.resultSeries.filter((value): value is number => value != null)}
          />
        </div>
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

function namedLiveRows(rows: ArmedRow[]): ArmedRow[] {
  return rows.filter((row) => {
    if (row.arm !== "live") return false;
    const code = row.wiring && "code" in row.wiring ? row.wiring.code : "";
    return code === "NX26-AZYR" || code === "NX26-SCHAK";
  });
}

function RewireAllBar({
  rows,
  eventId,
  onApplied,
}: {
  rows: ArmedRow[];
  eventId?: string;
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writable = (row: ArmedRow) =>
    (row.wiring?.kind === "rewire" && row.canWrite) ||
    (row.wiring?.kind === "stamp_event" && row.canWrite && row.canStampEvent);
  const matched = rows.filter(writable);
  const skipped = rows.filter(
    (row) => row.wiring != null && !writable(row),
  );
  if (matched.length === 0 && skipped.length === 0) return null;
  const live = namedLiveRows(matched);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/optimisation/campaigns/wiring-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventId ? { eventId } : {}),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Could not apply");
        return;
      }
      setOpen(false);
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

export function ArmedCampaignRow({
  row,
  onRowChange,
  onWiringApplied,
}: {
  row: ArmedRow;
  onRowChange: (next: ArmedRow) => void;
  onWiringApplied: () => void;
}) {
  const [openControls, setOpenControls] = useState(false);
  const acting = formatActingLine(row.arm, row.lastDecision, row.lastWrite);

  return (
    <div className="rounded-md border border-border bg-card px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/campaign/${row.id}`}
            className={`truncate font-medium hover:underline ${VIZ_TYPE.body}`}
          >
            {row.name}
          </Link>
          <Datum className="mt-1 text-muted-foreground">{acting}</Datum>
          {row.lastDecision?.reasonText ? (
            <Datum className="mt-0.5 line-clamp-2 min-w-0 text-muted-foreground">
              {row.lastDecision.reasonText}
            </Datum>
          ) : null}
          <ImpactLines row={row} />
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
        <div className="flex shrink-0 flex-col items-end gap-2">
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
      </div>
      {openControls && row.arm !== "off" && row.canWrite ? (
        <PostLaunchControls
          row={row}
          onSaved={(partial) => onRowChange({ ...row, ...partial })}
        />
      ) : null}
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
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;
  const reload = () => setReloadToken((n) => n + 1);

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
  return (
    <div className="space-y-2">
      <RewireAllBar rows={rows} eventId={eventId} onApplied={reload} />
      {eventId ? (
        <DescribeCellsTable cells={describeCells} unreadable={describeUnreadable} />
      ) : null}
      {rows.map((row) => (
        <ArmedCampaignRow
          key={row.id}
          row={row}
          onWiringApplied={reload}
          onRowChange={(next) =>
            setRows((current) =>
              (current ?? []).map((item) => (item.id === next.id ? next : item)),
            )
          }
        />
      ))}
    </div>
  );
}
