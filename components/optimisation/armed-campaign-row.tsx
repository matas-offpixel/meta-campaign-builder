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
    </div>
  );
}

export function ArmedCampaignRow({
  row,
  onRowChange,
}: {
  row: ArmedRow;
  onRowChange: (next: ArmedRow) => void;
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
            <Datum className="mt-1 text-amber-800 dark:text-amber-200">
              {row.eventWarning}
            </Datum>
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;

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
  }, [eventId]);

  if (loading) {
    return <Datum className="text-muted-foreground">Loading campaigns…</Datum>;
  }
  if (error) {
    return <Datum className="text-destructive">{error}</Datum>;
  }
  if (!rows?.length) {
    return (
      <Datum className="text-muted-foreground">
        {eventId ? "No campaigns wired to this event." : "No Shadow or Live campaigns."}
      </Datum>
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <ArmedCampaignRow
          key={row.id}
          row={row}
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
