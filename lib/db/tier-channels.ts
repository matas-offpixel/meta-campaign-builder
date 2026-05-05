import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { autoComputeRevenue } from "@/lib/dashboard/currency";

/**
 * lib/db/tier-channels.ts
 *
 * Server-only CRUD for the multi-channel ticketing tables introduced in
 * migrations 076–077:
 *   - tier_channels
 *   - tier_channel_allocations
 *   - tier_channel_sales
 *
 * UPSERT semantics: every write keys on the natural triple (event_id,
 * tier_name, channel_id). The latest write replaces the prior row —
 * each entry is a *snapshot* of running totals, not a delta to add.
 *
 * Revenue auto-compute: when revenue_overridden=false, the helper
 * recomputes revenue from price × tickets_sold on every save. The
 * import route + manual entry surfaces both flow through
 * `upsertTierChannelSale` so the auto-compute behaviour stays
 * consistent.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any, any, any>;

function asAny(supabase: AnySupabase): AnySupabase {
  return supabase;
}

export interface TierChannelRow {
  id: string;
  client_id: string;
  channel_name: string;
  display_label: string;
  is_automatic: boolean;
  provider_link: string | null;
  created_at: string;
}

export interface TierChannelAllocationRow {
  id: string;
  event_id: string;
  tier_name: string;
  channel_id: string;
  allocation_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TierChannelSaleRow {
  id: string;
  event_id: string;
  tier_name: string;
  channel_id: string;
  tickets_sold: number;
  revenue_amount: number;
  revenue_overridden: boolean;
  notes: string | null;
  snapshot_at: string;
  created_at: string;
  updated_at: string;
}

// ─── tier_channels ───────────────────────────────────────────────────

export async function listChannelsForClient(
  supabase: AnySupabase,
  clientId: string,
): Promise<TierChannelRow[]> {
  const { data, error } = await asAny(supabase)
    .from("tier_channels")
    .select("*")
    .eq("client_id", clientId)
    .order("is_automatic", { ascending: false })
    .order("channel_name", { ascending: true });
  if (error) {
    console.warn("[tier-channels list]", error.message);
    return [];
  }
  return (data ?? []) as TierChannelRow[];
}

/**
 * Idempotent: upsert a channel row by (client_id, channel_name).
 * Returns the resolved row (existing or newly created).
 */
export async function ensureChannel(
  supabase: AnySupabase,
  args: {
    clientId: string;
    channelName: string;
    displayLabel?: string;
    isAutomatic?: boolean;
  },
): Promise<TierChannelRow | null> {
  const channelName = args.channelName.trim();
  if (!channelName) return null;
  const displayLabel = (args.displayLabel ?? channelName).trim();
  const isAutomatic = args.isAutomatic ?? false;

  const { data: existing, error: readErr } = await asAny(supabase)
    .from("tier_channels")
    .select("*")
    .eq("client_id", args.clientId)
    .eq("channel_name", channelName)
    .maybeSingle();
  if (readErr) {
    console.warn("[tier-channels ensure read]", readErr.message);
  }
  if (existing) return existing as TierChannelRow;

  const { data, error } = await asAny(supabase)
    .from("tier_channels")
    .insert({
      client_id: args.clientId,
      channel_name: channelName,
      display_label: displayLabel,
      is_automatic: isAutomatic,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[tier-channels ensure insert]", error.message);
    return null;
  }
  return (data as TierChannelRow) ?? null;
}

// ─── tier_channel_allocations ────────────────────────────────────────

export async function listAllocationsForEvents(
  supabase: AnySupabase,
  eventIds: string[],
): Promise<TierChannelAllocationRow[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await asAny(supabase)
    .from("tier_channel_allocations")
    .select("*")
    .in("event_id", eventIds);
  if (error) {
    console.warn("[tier-channel-allocations list]", error.message);
    return [];
  }
  return (data ?? []) as TierChannelAllocationRow[];
}

export async function upsertTierChannelAllocation(
  supabase: AnySupabase,
  args: {
    eventId: string;
    tierName: string;
    channelId: string;
    allocationCount: number;
    notes?: string | null;
  },
): Promise<TierChannelAllocationRow | null> {
  const tierName = args.tierName.trim();
  if (!tierName) {
    throw new Error("tier_name is required");
  }
  const allocationCount = Math.max(0, Math.trunc(Number(args.allocationCount)));
  if (!Number.isFinite(allocationCount)) {
    throw new Error("allocation_count must be a non-negative integer");
  }
  const { data, error } = await asAny(supabase)
    .from("tier_channel_allocations")
    .upsert(
      {
        event_id: args.eventId,
        tier_name: tierName,
        channel_id: args.channelId,
        allocation_count: allocationCount,
        notes: args.notes ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "event_id,tier_name,channel_id" },
    )
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[tier-channel-allocations upsert]", error.message);
    throw new Error(error.message);
  }
  return (data as TierChannelAllocationRow) ?? null;
}

export async function deleteTierChannelAllocation(
  supabase: AnySupabase,
  args: { eventId: string; tierName: string; channelId: string },
): Promise<boolean> {
  const { error } = await asAny(supabase)
    .from("tier_channel_allocations")
    .delete()
    .eq("event_id", args.eventId)
    .eq("tier_name", args.tierName)
    .eq("channel_id", args.channelId);
  if (error) {
    console.warn("[tier-channel-allocations delete]", error.message);
    throw new Error(error.message);
  }
  return true;
}

// ─── tier_channel_sales ──────────────────────────────────────────────

export async function listSalesForEvents(
  supabase: AnySupabase,
  eventIds: string[],
): Promise<TierChannelSaleRow[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await asAny(supabase)
    .from("tier_channel_sales")
    .select("*")
    .in("event_id", eventIds);
  if (error) {
    console.warn("[tier-channel-sales list]", error.message);
    return [];
  }
  return (data ?? []) as TierChannelSaleRow[];
}

/**
 * UPSERT a sales snapshot. Revenue resolution:
 *   - revenue_overridden=true ⇒ store args.revenueAmount verbatim.
 *   - revenue_overridden=false ⇒ recompute price × ticketsSold on
 *     write. `tierPrice` must be supplied for the auto path; if it's
 *     null we store revenue=0 (the read layer will surface the
 *     missing-price as a small dash on display).
 */
export async function upsertTierChannelSale(
  supabase: AnySupabase,
  args: {
    eventId: string;
    tierName: string;
    channelId: string;
    ticketsSold: number;
    revenueOverridden: boolean;
    revenueAmount?: number | null;
    tierPrice?: number | null;
    notes?: string | null;
  },
): Promise<TierChannelSaleRow | null> {
  const tierName = args.tierName.trim();
  if (!tierName) {
    throw new Error("tier_name is required");
  }
  const ticketsSold = Math.max(0, Math.trunc(Number(args.ticketsSold)));
  if (!Number.isFinite(ticketsSold)) {
    throw new Error("tickets_sold must be a non-negative integer");
  }

  let revenue = 0;
  if (args.revenueOverridden) {
    const candidate = Number(args.revenueAmount ?? 0);
    revenue = Number.isFinite(candidate) && candidate >= 0 ? candidate : 0;
  } else {
    revenue = autoComputeRevenue(args.tierPrice ?? null, ticketsSold) ?? 0;
  }

  const now = new Date().toISOString();
  const { data, error } = await asAny(supabase)
    .from("tier_channel_sales")
    .upsert(
      {
        event_id: args.eventId,
        tier_name: tierName,
        channel_id: args.channelId,
        tickets_sold: ticketsSold,
        revenue_amount: revenue,
        revenue_overridden: args.revenueOverridden,
        notes: args.notes ?? null,
        snapshot_at: now,
        updated_at: now,
      },
      { onConflict: "event_id,tier_name,channel_id" },
    )
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[tier-channel-sales upsert]", error.message);
    throw new Error(error.message);
  }
  return (data as TierChannelSaleRow) ?? null;
}

export async function deleteTierChannelSale(
  supabase: AnySupabase,
  args: { eventId: string; tierName: string; channelId: string },
): Promise<boolean> {
  const { error } = await asAny(supabase)
    .from("tier_channel_sales")
    .delete()
    .eq("event_id", args.eventId)
    .eq("tier_name", args.tierName)
    .eq("channel_id", args.channelId);
  if (error) {
    console.warn("[tier-channel-sales delete]", error.message);
    throw new Error(error.message);
  }
  return true;
}

// ─── Aggregation helpers ─────────────────────────────────────────────

/**
 * Per-tier breakdown row used by the venue/event report rendering.
 * Aggregator pivots `(event_id, tier_name)` and emits one entry per
 * channel that has either an allocation OR a sales row for that tier.
 */
export interface TierChannelBreakdown {
  channel_id: string;
  channel_name: string;
  display_label: string;
  is_automatic: boolean;
  allocation_count: number | null;
  tickets_sold: number;
  revenue_amount: number;
  revenue_overridden: boolean;
}

export interface TierChannelBundle {
  channels: TierChannelRow[];
  allocations: TierChannelAllocationRow[];
  sales: TierChannelSaleRow[];
}

/**
 * Build a map keyed by `${event_id}::${tier_name}` → channel breakdowns.
 * The 4TF channel sales fall back to event_ticket_tiers.quantity_sold
 * (which is wired to the existing 4thefans rollup-sync) when no
 * tier_channel_sales row exists for that tier+channel — that's the
 * "automatic" path.
 */
export function buildTierChannelBreakdownMap(
  bundle: TierChannelBundle,
  fourTfFallback: Map<string, { quantity_sold: number; price: number | null }>,
): Map<string, TierChannelBreakdown[]> {
  const channelsById = new Map(bundle.channels.map((row) => [row.id, row]));
  const automaticChannels = bundle.channels.filter((row) => row.is_automatic);
  const fourTfChannel = bundle.channels.find(
    (row) => row.channel_name === "4TF",
  );

  const out = new Map<string, TierChannelBreakdown[]>();

  const ensureRow = (
    eventId: string,
    tierName: string,
    channelId: string,
  ): TierChannelBreakdown => {
    const key = `${eventId}::${tierName}`;
    const channel = channelsById.get(channelId);
    if (!channel) {
      throw new Error(`unknown channel id ${channelId}`);
    }
    const list = out.get(key) ?? [];
    out.set(key, list);
    let row = list.find((entry) => entry.channel_id === channelId);
    if (!row) {
      row = {
        channel_id: channel.id,
        channel_name: channel.channel_name,
        display_label: channel.display_label,
        is_automatic: channel.is_automatic,
        allocation_count: null,
        tickets_sold: 0,
        revenue_amount: 0,
        revenue_overridden: false,
      };
      list.push(row);
    }
    return row;
  };

  for (const allocation of bundle.allocations) {
    const row = ensureRow(allocation.event_id, allocation.tier_name, allocation.channel_id);
    row.allocation_count =
      (row.allocation_count ?? 0) + allocation.allocation_count;
  }

  for (const sale of bundle.sales) {
    const row = ensureRow(sale.event_id, sale.tier_name, sale.channel_id);
    row.tickets_sold += sale.tickets_sold;
    row.revenue_amount += Number(sale.revenue_amount ?? 0);
    row.revenue_overridden = row.revenue_overridden || sale.revenue_overridden;
  }

  // 4TF fallback: if a tier has a 4TF allocation row but no 4TF sales
  // row, surface event_ticket_tiers.quantity_sold for that tier as the
  // 4TF sold figure. Lets the existing rollup-sync continue to power
  // the auto channel without writing to tier_channel_sales.
  if (fourTfChannel) {
    for (const [key, breakdowns] of out.entries()) {
      const fourTfRow = breakdowns.find(
        (entry) => entry.channel_id === fourTfChannel.id,
      );
      if (!fourTfRow) continue;
      const hasExplicitSale = bundle.sales.some(
        (sale) =>
          sale.channel_id === fourTfChannel.id &&
          `${sale.event_id}::${sale.tier_name}` === key,
      );
      if (hasExplicitSale) continue;
      const fallback = fourTfFallback.get(key);
      if (!fallback) continue;
      fourTfRow.tickets_sold = fallback.quantity_sold;
      fourTfRow.revenue_amount =
        autoComputeRevenue(fallback.price, fallback.quantity_sold) ?? 0;
    }
  }

  // Eventbrite + any other automatic channel: same fallback shape —
  // when a tier has rows from event_ticket_tiers and the channel
  // resolved by tier_name fuzzy match is automatic, surface the
  // quantity_sold against that channel. We don't have per-channel
  // labels in event_ticket_tiers so we keep this conservative and
  // *only* fall back to 4TF for now. Eventbrite events live on
  // separate event rows from 4TF events in 4thefans' dataset, so a
  // single tier never resolves to both.
  // (Other automatic channels stay null until a future sync writes
  // them explicitly.)
  void automaticChannels;

  return out;
}
