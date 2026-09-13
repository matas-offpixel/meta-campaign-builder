"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AutomationArmControl } from "@/components/optimisation/automation-arm-control";
import { PostLaunchControls } from "@/components/optimisation/post-launch-controls";
import { Datum } from "@/components/steps/step-surface";
import { Button } from "@/components/ui/button";
import { VIZ_TYPE } from "@/lib/viz/tokens";
import {
  formatActingLine,
  type ArmedCampaignRow as ArmedRow,
} from "@/lib/optimisation/armed-read-model";
import type { AutomationArm } from "@/lib/optimisation/automation-ui";

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
          {row.eventLabel ? (
            <Datum className="mt-0.5 text-muted-foreground">
              Wired to {row.eventLabel}
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
