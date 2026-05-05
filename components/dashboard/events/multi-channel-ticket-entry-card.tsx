"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info, Loader2, RefreshCw } from "lucide-react";

import {
  autoComputeRevenue,
  formatCurrency,
} from "@/lib/dashboard/currency";

const NUMERIC_INPUT_CLASS =
  "h-7 w-20 rounded-md border border-border bg-background px-2 text-right text-xs text-foreground tabular-nums focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
import type {
  TierChannelAllocationRow,
  TierChannelRow,
  TierChannelSaleRow,
} from "@/lib/db/tier-channels";

/**
 * components/dashboard/events/multi-channel-ticket-entry-card.tsx
 *
 * Single client component that powers the multi-channel ticket entry
 * surface on both the internal event/venue dashboard AND the public
 * venue share report. The endpoint base + token are passed by the
 * parent so the same render path serves both surfaces:
 *
 *   • dashboard mode → `/api/events/{eventId}/tier-channels/{allocation,sale}`
 *   • share mode     → `/api/share/venue/{token}/tier-channels/{allocation,sale}`
 *
 * Save semantics: every save is an UPSERT keyed on
 * (event_id, tier_name, channel_id). The "running total" model
 * matches the Additional Ticket Entries card (PR #281) — operators
 * paste the running total, not a delta.
 *
 * Revenue auto-compute: by default, revenue = price × tickets_sold
 * computed live. Toggle "Override revenue" on a row to enter a
 * manual figure; the override flag persists with the row so future
 * reads display the (i) icon explaining the deviation from default.
 */

type Mode = "dashboard" | "share";

export interface MultiChannelEventOption {
  id: string;
  name: string;
  /** Tiers attached to the event. `price` lets the card auto-compute revenue. */
  tiers: Array<{
    tier_name: string;
    price: number | null;
  }>;
}

interface Props {
  mode: Mode;
  /** Where to read + write tier-channel rows. */
  apiBase: string;
  /**
   * Specific event id used to fetch the per-event lookup. The route
   * returns the union of allocations + sales for every event in the
   * venue group, so passing any event in the group is fine.
   */
  fetchEventId: string;
  events: MultiChannelEventOption[];
  readOnly: boolean;
  className?: string;
  onAfterMutate?: () => void;
}

interface ApiPayload {
  ok: true;
  channels: TierChannelRow[];
  allocations: TierChannelAllocationRow[];
  sales: TierChannelSaleRow[];
  can_edit: boolean;
}

const CHANNEL_TINT: Record<string, string> = {
  "4TF": "bg-emerald-50",
  Eventbrite: "bg-emerald-50",
  Venue: "bg-blue-50",
  SeeTickets: "bg-amber-50",
  CP: "bg-purple-50",
  DS: "bg-purple-50",
  Other: "bg-slate-50",
};

export function MultiChannelTicketEntryCard({
  mode,
  apiBase,
  fetchEventId,
  events,
  readOnly,
  className = "",
  onAfterMutate,
}: Props) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; payload: ApiPayload }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [reloadNonce, setReloadNonce] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        mode === "dashboard"
          ? `${apiBase}/tier-channels`
          : `${apiBase}/tier-channels`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as ApiPayload | { ok: false; error?: string };
      if (!res.ok || !("ok" in json) || !json.ok) {
        throw new Error(
          ("error" in json && json.error) || `HTTP ${res.status}`,
        );
      }
      setState({ kind: "ready", payload: json });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load",
      });
    }
  }, [apiBase, mode]);

  useEffect(() => {
    void load();
  }, [load, reloadNonce, fetchEventId]);

  return (
    <section
      className={`space-y-3 rounded-md border border-border bg-card p-4 ${className}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm tracking-wide text-foreground">
            Multi-channel ticket entries
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Allocation + sales per channel per tier. Automatic channels
            (4TF, Eventbrite) are populated by the API sync. Manual
            channels accept running-total snapshots — the latest entry
            replaces the previous total.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloadNonce((n) => n + 1)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          aria-label="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </header>

      {state.kind === "loading" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading channels…
        </p>
      ) : state.kind === "error" ? (
        <p className="text-xs text-destructive">{state.message}</p>
      ) : state.payload.channels.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          No channels configured for this client. Run the MASTER
          Allocations import to seed the channel set.
        </p>
      ) : (
        <ChannelComparisonSummary
          payload={state.payload}
          eventIds={events.map((event) => event.id)}
        />
      )}

      {state.kind === "ready" && state.payload.channels.length > 0 ? (
        <div className="space-y-4">
          {events.map((event) => (
            <EventChannelTable
              key={event.id}
              event={event}
              payload={state.payload}
              apiBase={apiBase}
              readOnly={readOnly || !state.payload.can_edit}
              onAfterMutate={() => {
                setReloadNonce((n) => n + 1);
                onAfterMutate?.();
              }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ChannelComparisonSummary({
  payload,
  eventIds,
}: {
  payload: ApiPayload;
  eventIds: string[];
}) {
  const eventIdSet = new Set(eventIds);
  const totals = new Map<
    string,
    {
      label: string;
      isAutomatic: boolean;
      allocation: number;
      sold: number;
      revenue: number;
    }
  >();
  for (const channel of payload.channels) {
    totals.set(channel.id, {
      label: channel.display_label,
      isAutomatic: channel.is_automatic,
      allocation: 0,
      sold: 0,
      revenue: 0,
    });
  }
  for (const allocation of payload.allocations) {
    if (!eventIdSet.has(allocation.event_id)) continue;
    const row = totals.get(allocation.channel_id);
    if (row) row.allocation += allocation.allocation_count;
  }
  for (const sale of payload.sales) {
    if (!eventIdSet.has(sale.event_id)) continue;
    const row = totals.get(sale.channel_id);
    if (row) {
      row.sold += sale.tickets_sold;
      row.revenue += Number(sale.revenue_amount ?? 0);
    }
  }
  const ordered = Array.from(totals.values())
    .filter((row) => row.allocation > 0 || row.sold > 0)
    .sort((a, b) => {
      if (a.isAutomatic !== b.isAutomatic) return a.isAutomatic ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  if (ordered.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        No channel rows yet. Add allocations or run the import to populate.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {ordered.map((row) => {
        const remaining = Math.max(0, row.allocation - row.sold);
        const pct =
          row.allocation > 0 ? Math.round((row.sold / row.allocation) * 100) : null;
        const tint =
          CHANNEL_TINT[row.label] ?? "bg-muted/40";
        return (
          <div
            key={row.label}
            className={`rounded-md border border-border p-3 ${tint}`}
          >
            <p className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>{row.label}</span>
              {row.isAutomatic ? (
                <span title="Populated by API sync">Auto</span>
              ) : null}
            </p>
            <p className="mt-1 font-heading text-lg tabular-nums text-foreground">
              {row.sold.toLocaleString("en-GB")} <span className="text-xs font-normal text-muted-foreground">sold</span>
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">
              of {row.allocation.toLocaleString("en-GB")} allocation
              {pct != null ? ` (${pct}%)` : ""}
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {remaining.toLocaleString("en-GB")} remaining ·{" "}
              {formatCurrency(row.revenue)} revenue
            </p>
          </div>
        );
      })}
    </div>
  );
}

function EventChannelTable({
  event,
  payload,
  apiBase,
  readOnly,
  onAfterMutate,
}: {
  event: MultiChannelEventOption;
  payload: ApiPayload;
  apiBase: string;
  readOnly: boolean;
  onAfterMutate: () => void;
}) {
  const channelsById = useMemo(
    () => new Map(payload.channels.map((row) => [row.id, row])),
    [payload.channels],
  );
  const channelOrder = useMemo(
    () =>
      [...payload.channels].sort((a, b) => {
        if (a.is_automatic !== b.is_automatic) return a.is_automatic ? -1 : 1;
        return a.display_label.localeCompare(b.display_label);
      }),
    [payload.channels],
  );
  const allocationsByKey = useMemo(() => {
    const out = new Map<string, TierChannelAllocationRow>();
    for (const allocation of payload.allocations) {
      if (allocation.event_id !== event.id) continue;
      out.set(`${allocation.tier_name}::${allocation.channel_id}`, allocation);
    }
    return out;
  }, [event.id, payload.allocations]);
  const salesByKey = useMemo(() => {
    const out = new Map<string, TierChannelSaleRow>();
    for (const sale of payload.sales) {
      if (sale.event_id !== event.id) continue;
      out.set(`${sale.tier_name}::${sale.channel_id}`, sale);
    }
    return out;
  }, [event.id, payload.sales]);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-foreground">
        {event.name}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-xs">
          <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Tier</th>
              <th className="px-3 py-2 text-left">Channel</th>
              <th className="px-3 py-2 text-right">Allocation</th>
              <th className="px-3 py-2 text-right">Sold</th>
              <th className="px-3 py-2 text-right">Revenue</th>
              <th className="px-3 py-2 text-right">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {event.tiers.length === 0 ? (
              <tr className="border-t border-border">
                <td colSpan={6} className="px-3 py-3 text-muted-foreground">
                  No tiers synced yet for this event.
                </td>
              </tr>
            ) : (
              event.tiers.map((tier) => (
                <TierBlock
                  key={tier.tier_name}
                  event={event}
                  tier={tier}
                  channels={channelOrder}
                  channelsById={channelsById}
                  allocationsByKey={allocationsByKey}
                  salesByKey={salesByKey}
                  apiBase={apiBase}
                  readOnly={readOnly}
                  onAfterMutate={onAfterMutate}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TierBlock({
  event,
  tier,
  channels,
  channelsById,
  allocationsByKey,
  salesByKey,
  apiBase,
  readOnly,
  onAfterMutate,
}: {
  event: MultiChannelEventOption;
  tier: { tier_name: string; price: number | null };
  channels: TierChannelRow[];
  channelsById: Map<string, TierChannelRow>;
  allocationsByKey: Map<string, TierChannelAllocationRow>;
  salesByKey: Map<string, TierChannelSaleRow>;
  apiBase: string;
  readOnly: boolean;
  onAfterMutate: () => void;
}) {
  void channelsById;
  let totalAllocation = 0;
  let totalSold = 0;
  let totalRevenue = 0;
  let anyAllocation = false;
  let anySold = false;
  const rows: React.ReactNode[] = [];
  channels.forEach((channel, idx) => {
    const allocation = allocationsByKey.get(`${tier.tier_name}::${channel.id}`);
    const sale = salesByKey.get(`${tier.tier_name}::${channel.id}`);
    const allocationCount = allocation?.allocation_count ?? null;
    const sold = sale?.tickets_sold ?? 0;
    const revenue = Number(sale?.revenue_amount ?? 0);
    if (allocationCount != null) {
      totalAllocation += allocationCount;
      anyAllocation = true;
    }
    if (sale != null) {
      totalSold += sold;
      totalRevenue += revenue;
      anySold = true;
    }
    if (allocation == null && sale == null) {
      // Don't render channel rows that have no data unless the channel is
      // editable AND we're not read-only — the operator may want to add a
      // new channel for the first time. To keep the grid compact we still
      // emit the row when the channel is manual, so they can type into it.
      if (channel.is_automatic) return;
      if (readOnly) return;
    }
    rows.push(
      <TierChannelRowEditor
        key={`${tier.tier_name}::${channel.id}`}
        showTierName={idx === 0}
        event={event}
        tier={tier}
        channel={channel}
        allocation={allocation}
        sale={sale}
        apiBase={apiBase}
        readOnly={readOnly}
        onAfterMutate={onAfterMutate}
      />,
    );
  });
  const remaining = Math.max(0, totalAllocation - totalSold);
  const isSoldOut = anyAllocation && totalSold >= totalAllocation && totalAllocation > 0;
  return (
    <>
      {rows}
      <tr className="border-t border-border bg-muted/30 text-foreground">
        <td className="px-3 py-2"></td>
        <td className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {tier.tier_name} TOTAL
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {anyAllocation ? totalAllocation.toLocaleString("en-GB") : "—"}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {anySold ? totalSold.toLocaleString("en-GB") : "—"}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {anySold ? formatCurrency(totalRevenue) : "—"}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {isSoldOut ? (
            <span className="font-semibold uppercase text-destructive">
              SOLD OUT
            </span>
          ) : anyAllocation ? (
            remaining.toLocaleString("en-GB")
          ) : (
            "—"
          )}
        </td>
      </tr>
    </>
  );
}

function TierChannelRowEditor({
  showTierName,
  event,
  tier,
  channel,
  allocation,
  sale,
  apiBase,
  readOnly,
  onAfterMutate,
}: {
  showTierName: boolean;
  event: MultiChannelEventOption;
  tier: { tier_name: string; price: number | null };
  channel: TierChannelRow;
  allocation: TierChannelAllocationRow | undefined;
  sale: TierChannelSaleRow | undefined;
  apiBase: string;
  readOnly: boolean;
  onAfterMutate: () => void;
}) {
  const [allocationInput, setAllocationInput] = useState(
    allocation ? String(allocation.allocation_count) : "",
  );
  const [soldInput, setSoldInput] = useState(
    sale ? String(sale.tickets_sold) : "",
  );
  const [overridden, setOverridden] = useState(sale?.revenue_overridden ?? false);
  const [revenueInput, setRevenueInput] = useState(
    sale ? String(Number(sale.revenue_amount ?? 0)) : "",
  );
  const [busy, setBusy] = useState<"allocation" | "sale" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allocationDirtyRef = useRef(false);
  const saleDirtyRef = useRef(false);

  // Re-sync when the underlying row changes (e.g. parent reload after a save).
  useEffect(() => {
    if (allocationDirtyRef.current) return;
    setAllocationInput(allocation ? String(allocation.allocation_count) : "");
  }, [allocation]);
  useEffect(() => {
    if (saleDirtyRef.current) return;
    setSoldInput(sale ? String(sale.tickets_sold) : "");
    setOverridden(sale?.revenue_overridden ?? false);
    setRevenueInput(sale ? String(Number(sale.revenue_amount ?? 0)) : "");
  }, [sale]);

  const computedRevenue =
    autoComputeRevenue(tier.price ?? null, Number(soldInput) || 0) ?? 0;
  const remaining =
    allocation && sale
      ? Math.max(0, allocation.allocation_count - sale.tickets_sold)
      : null;
  const tierRowSoldOut =
    allocation != null &&
    sale != null &&
    allocation.allocation_count > 0 &&
    sale.tickets_sold >= allocation.allocation_count;

  const isAutomatic = channel.is_automatic;
  const allocationDisabled = readOnly;
  const saleDisabled = readOnly || isAutomatic;

  async function saveAllocation() {
    if (allocationDisabled) return;
    if (!allocationDirtyRef.current) return;
    const trimmed = allocationInput.trim();
    if (trimmed === "") {
      // Empty input → delete the allocation row so it doesn't keep
      // displaying as 0/1 with stale state.
      if (!allocation) {
        allocationDirtyRef.current = false;
        return;
      }
      setBusy("allocation");
      setError(null);
      try {
        const res = await fetch(`${apiBase}/tier-channels/allocation`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_id: event.id,
            tier_name: tier.tier_name,
            channel_id: channel.id,
          }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(json?.error ?? `HTTP ${res.status}`);
        }
        allocationDirtyRef.current = false;
        onAfterMutate();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      } finally {
        setBusy(null);
      }
      return;
    }
    const value = Math.trunc(Number(trimmed));
    if (!Number.isFinite(value) || value < 0) {
      setError("Allocation must be a non-negative integer");
      return;
    }
    setBusy("allocation");
    setError(null);
    try {
      const res = await fetch(`${apiBase}/tier-channels/allocation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          tier_name: tier.tier_name,
          channel_id: channel.id,
          allocation_count: value,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      allocationDirtyRef.current = false;
      onAfterMutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveSale() {
    if (saleDisabled) return;
    if (!saleDirtyRef.current) return;
    const trimmed = soldInput.trim();
    if (trimmed === "") {
      if (!sale) {
        saleDirtyRef.current = false;
        return;
      }
      setBusy("sale");
      setError(null);
      try {
        const res = await fetch(`${apiBase}/tier-channels/sale`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_id: event.id,
            tier_name: tier.tier_name,
            channel_id: channel.id,
          }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(json?.error ?? `HTTP ${res.status}`);
        }
        saleDirtyRef.current = false;
        onAfterMutate();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      } finally {
        setBusy(null);
      }
      return;
    }
    const value = Math.trunc(Number(trimmed));
    if (!Number.isFinite(value) || value < 0) {
      setError("Sold must be a non-negative integer");
      return;
    }
    let revenueAmount: number | null = null;
    if (overridden) {
      const rev = Number(revenueInput);
      if (!Number.isFinite(rev) || rev < 0) {
        setError("Revenue must be a non-negative number when overridden");
        return;
      }
      revenueAmount = rev;
    }
    setBusy("sale");
    setError(null);
    try {
      const res = await fetch(`${apiBase}/tier-channels/sale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          tier_name: tier.tier_name,
          channel_id: channel.id,
          tickets_sold: value,
          revenue_overridden: overridden,
          revenue_amount: revenueAmount,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      saleDirtyRef.current = false;
      onAfterMutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  const tint = CHANNEL_TINT[channel.display_label] ?? "";
  const overrideTooltip =
    sale?.revenue_overridden
      ? `Revenue manually overridden. Default would be ${formatCurrency(
          autoComputeRevenue(tier.price ?? null, sale.tickets_sold) ?? 0,
        )}.`
      : null;

  return (
    <>
      <tr className={`border-t border-border ${tint}`}>
        <td className="px-3 py-2 align-top">
          {showTierName ? (
            <div>
              <div className="font-medium text-foreground">{tier.tier_name}</div>
              <div className="text-[10px] text-muted-foreground">
                Price: {formatCurrency(tier.price, { dp: 2 })}
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground">↳</span>
          )}
        </td>
        <td className="px-3 py-2 align-top text-foreground">
          <div className="flex items-center gap-1">
            <span>{channel.display_label}</span>
            {isAutomatic ? (
              <span
                className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
                title="Populated by API sync"
              >
                auto
              </span>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2 text-right align-top tabular-nums">
          <input
            value={allocationInput}
            onChange={(event) => {
              allocationDirtyRef.current = true;
              setAllocationInput(event.target.value);
            }}
            onBlur={() => void saveAllocation()}
            inputMode="numeric"
            disabled={allocationDisabled || busy === "allocation"}
            className={NUMERIC_INPUT_CLASS}
          />
        </td>
        <td className="px-3 py-2 text-right align-top tabular-nums">
          <input
            value={soldInput}
            onChange={(event) => {
              saleDirtyRef.current = true;
              setSoldInput(event.target.value);
            }}
            onBlur={() => void saveSale()}
            inputMode="numeric"
            disabled={saleDisabled || busy === "sale"}
            className={NUMERIC_INPUT_CLASS}
          />
          {tierRowSoldOut ? (
            <span className="ml-1 text-[10px] font-semibold uppercase text-destructive">
              sold out
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2 text-right align-top tabular-nums">
          {!isAutomatic ? (
            <div className="flex items-center justify-end gap-1.5">
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={overridden}
                  onChange={(event) => {
                    saleDirtyRef.current = true;
                    setOverridden(event.target.checked);
                    if (!event.target.checked) {
                      setRevenueInput(String(computedRevenue));
                    }
                  }}
                  disabled={saleDisabled || busy === "sale"}
                />
                <span>Override</span>
              </label>
              {overridden ? (
                <input
                  value={revenueInput}
                  onChange={(event) => {
                    saleDirtyRef.current = true;
                    setRevenueInput(event.target.value);
                  }}
                  onBlur={() => void saveSale()}
                  inputMode="decimal"
                  disabled={saleDisabled || busy === "sale"}
                  className={`${NUMERIC_INPUT_CLASS} w-24`}
                />
              ) : (
                <span className="text-foreground">
                  {formatCurrency(computedRevenue)}
                </span>
              )}
              {overrideTooltip ? (
                <span title={overrideTooltip} aria-label={overrideTooltip}>
                  <Info className="h-3 w-3 text-muted-foreground" />
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-muted-foreground">
              {formatCurrency(autoComputeRevenue(tier.price ?? null, sale?.tickets_sold ?? 0) ?? 0)}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right align-top tabular-nums">
          {remaining != null ? remaining.toLocaleString("en-GB") : "—"}
        </td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={6} className="px-3 pb-2 text-[10px] text-destructive">
            {error}
          </td>
        </tr>
      ) : null}
    </>
  );
}
