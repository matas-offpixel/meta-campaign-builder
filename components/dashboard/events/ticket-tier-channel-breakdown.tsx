"use client";

import { useMemo, useState } from "react";
import { Info, Loader2, Pencil, X } from "lucide-react";

import { autoComputeRevenue, formatCurrency } from "@/lib/dashboard/currency";
import type { TierChannelBreakdown } from "@/lib/db/tier-channels";
import type { EventTicketTierRow } from "@/lib/db/ticketing";

const NUM = new Intl.NumberFormat("en-GB");

interface Props {
  eventId?: string;
  tier: EventTicketTierRow;
  canEdit?: boolean;
  apiBase?: string;
  onAfterMutate?: () => void;
}

interface DraftRow {
  channelId: string;
  sold: string;
  revenueOverridden: boolean;
  revenue: string;
}

export function TicketTierChannelBreakdown({
  eventId,
  tier,
  canEdit = false,
  apiBase,
  onAfterMutate,
}: Props) {
  const breakdowns = useMemo(
    () => [...(tier.channel_breakdowns ?? [])].sort(compareBreakdowns),
    [tier.channel_breakdowns],
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Map<string, DraftRow>>(() =>
    buildDraftMap(breakdowns),
  );

  if (breakdowns.length === 0) {
    return (
      <>
        <td className="px-3 py-2 text-right text-muted-foreground">—</td>
        <td className="px-3 py-2 text-right text-muted-foreground">—</td>
        <td className="px-3 py-2 text-right text-muted-foreground">—</td>
      </>
    );
  }

  const save = async () => {
    if (!eventId || !apiBase || !canEdit) return;
    setBusy(true);
    setError(null);
    try {
      for (const row of breakdowns) {
        if (row.is_automatic) continue;
        const draft = drafts.get(row.channel_id);
        if (!draft) continue;
        const sold = Number(draft.sold || 0);
        if (!Number.isInteger(sold) || sold < 0) {
          throw new Error("Sold values must be non-negative whole numbers.");
        }
        const revenueAmount: number = draft.revenueOverridden
          ? Number(draft.revenue || 0)
          : (autoComputeRevenue(tier.price, sold) ?? 0);
        if (
          draft.revenueOverridden &&
          (!Number.isFinite(revenueAmount) || revenueAmount < 0)
        ) {
          throw new Error("Revenue must be a non-negative number.");
        }
        const res = await fetch(`${apiBase}/tier-channels/sale`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_id: eventId,
            tier_name: tier.tier_name,
            channel_id: row.channel_id,
            tickets_sold: sold,
            revenue_overridden: draft.revenueOverridden,
            revenue_amount: revenueAmount ?? 0,
          }),
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
        } | null;
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error ?? `HTTP ${res.status}`);
        }
      }
      setOpen(false);
      onAfterMutate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <td className="px-3 py-2 text-right align-top text-[11px] text-muted-foreground">
        <ChannelList
          breakdowns={breakdowns}
          mode="allocation"
        />
      </td>
      <td className="px-3 py-2 text-right align-top text-[11px] text-muted-foreground">
        <ChannelList
          breakdowns={breakdowns}
          mode="sold"
        />
      </td>
      <td className="relative px-3 py-2 text-right align-top">
        {canEdit && apiBase && eventId ? (
          <button
            type="button"
            onClick={() => {
              setDrafts(buildDraftMap(breakdowns));
              setOpen(true);
              setError(null);
            }}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {open ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/40 p-4">
            <div className="w-full max-w-[420px] rounded-md border border-border bg-card p-3 text-left text-xs shadow-lg">
            <div className="mb-2 flex items-start justify-between gap-3 border-b border-border pb-2">
              <div>
                <p className="font-medium text-foreground">{tier.tier_name}</p>
                <p className="text-[11px] text-muted-foreground">
                  Manual channels save as running-total snapshots.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close channel editor"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-2">
              {breakdowns.map((row) => {
                const draft = drafts.get(row.channel_id);
                const defaultRevenue = autoComputeRevenue(
                  tier.price,
                  Number(draft?.sold || 0),
                );
                return (
                  <div
                    key={row.channel_id}
                    className="grid grid-cols-[1fr_72px_92px] items-center gap-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {row.display_label}
                        {row.is_automatic ? (
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                            auto
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Allocation:{" "}
                        {row.allocation_count == null
                          ? "—"
                          : NUM.format(row.allocation_count)}
                      </p>
                    </div>
                    <input
                      value={draft?.sold ?? ""}
                      onChange={(e) => {
                        const next = new Map(drafts);
                        next.set(row.channel_id, {
                          ...(draft ?? {
                            channelId: row.channel_id,
                            revenueOverridden: false,
                            revenue: "",
                          }),
                          sold: e.target.value,
                        });
                        setDrafts(next);
                      }}
                      disabled={row.is_automatic || busy}
                      inputMode="numeric"
                      className="h-7 rounded border border-border bg-background px-2 text-right tabular-nums disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`${row.display_label} sold`}
                    />
                    <label className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={draft?.revenueOverridden ?? false}
                        onChange={(e) => {
                          const next = new Map(drafts);
                          next.set(row.channel_id, {
                            ...(draft ?? {
                              channelId: row.channel_id,
                              sold: String(row.tickets_sold),
                              revenue: String(row.revenue_amount),
                            }),
                            revenueOverridden: e.target.checked,
                          });
                          setDrafts(next);
                        }}
                        disabled={row.is_automatic || busy}
                      />
                      Override
                    </label>
                    {draft?.revenueOverridden ? (
                      <div className="col-start-2 col-end-4 flex items-center justify-end gap-1">
                        <span className="text-muted-foreground">£</span>
                        <input
                          value={draft.revenue}
                          onChange={(e) => {
                            const next = new Map(drafts);
                            next.set(row.channel_id, {
                              ...draft,
                              revenue: e.target.value,
                            });
                            setDrafts(next);
                          }}
                          disabled={row.is_automatic || busy}
                          inputMode="decimal"
                          className="h-7 w-24 rounded border border-border bg-background px-2 text-right tabular-nums"
                          aria-label={`${row.display_label} revenue`}
                        />
                        <span
                          title={`Default would be ${formatCurrency(defaultRevenue ?? 0)}`}
                          className="text-muted-foreground"
                        >
                          <Info className="h-3 w-3" />
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {error ? <p className="mt-2 text-[11px] text-destructive">{error}</p> : null}
            <div className="mt-3 flex justify-end gap-2 border-t border-border pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-border px-2 py-1 text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded bg-foreground px-2 py-1 font-medium text-background disabled:cursor-wait disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Save
              </button>
            </div>
            </div>
          </div>
        ) : null}
      </td>
    </>
  );
}

function ChannelList({
  breakdowns,
  mode,
}: {
  breakdowns: TierChannelBreakdown[];
  mode: "allocation" | "sold";
}) {
  return (
    <div className="space-y-0.5">
      {breakdowns.map((row) => {
        const value =
          mode === "allocation" ? row.allocation_count : row.tickets_sold;
        const suffix =
          mode === "sold" && row.revenue_amount > 0
            ? ` · ${formatCurrency(row.revenue_amount)}`
            : "";
        return (
          <p key={row.channel_id} className="whitespace-nowrap">
            {row.display_label}:{" "}
            <span className="tabular-nums text-foreground">
              {value == null ? "—" : NUM.format(value)}
            </span>
            {suffix}
            {mode === "sold" && row.revenue_overridden ? (
              <span
                className="ml-1 inline-flex text-muted-foreground"
                title="Revenue manually overridden."
              >
                <Info className="h-3 w-3" />
              </span>
            ) : null}
          </p>
        );
      })}
    </div>
  );
}

function buildDraftMap(
  breakdowns: TierChannelBreakdown[],
): Map<string, DraftRow> {
  return new Map(
    breakdowns.map((row) => [
      row.channel_id,
      {
        channelId: row.channel_id,
        sold: String(row.tickets_sold),
        revenueOverridden: row.revenue_overridden,
        revenue: String(row.revenue_amount),
      },
    ]),
  );
}

function compareBreakdowns(
  a: TierChannelBreakdown,
  b: TierChannelBreakdown,
): number {
  if (a.is_automatic !== b.is_automatic) return a.is_automatic ? -1 : 1;
  return a.display_label.localeCompare(b.display_label);
}
