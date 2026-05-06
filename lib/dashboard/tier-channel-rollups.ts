import type { TierChannelBreakdown } from "@/lib/db/tier-channels";
import type { EventTicketTierRow } from "@/lib/db/ticketing";

export interface TierChannelDescriptor {
  channel_id: string;
  channel_name: string;
  display_label: string;
  is_automatic: boolean;
}

export interface TierChannelCellValue {
  sold: number;
  allocation: number | null;
  hasData: boolean;
}

export interface TierSalesRollup {
  sold: number;
  allocation: number | null;
  hasChannelAllocation: boolean;
  hasChannelData: boolean;
}

export function activeChannelsForTiers(
  tiers: EventTicketTierRow[],
): TierChannelDescriptor[] {
  const byId = new Map<string, TierChannelDescriptor>();
  for (const tier of tiers) {
    for (const row of tier.channel_breakdowns ?? []) {
      if (!isActiveChannelRow(row)) continue;
      byId.set(row.channel_id, {
        channel_id: row.channel_id,
        channel_name: row.channel_name,
        display_label: row.display_label,
        is_automatic: row.is_automatic,
      });
    }
  }
  return [...byId.values()].sort(compareChannels);
}

export function channelCellForTier(
  tier: EventTicketTierRow,
  channelId: string,
): TierChannelCellValue {
  const row = (tier.channel_breakdowns ?? []).find(
    (entry) => entry.channel_id === channelId,
  );
  if (!row || !isActiveChannelRow(row)) {
    return { sold: 0, allocation: null, hasData: false };
  }
  return {
    sold: row.tickets_sold,
    allocation: row.allocation_count,
    hasData: true,
  };
}

export function tierSalesRollup(tier: EventTicketTierRow): TierSalesRollup {
  const breakdowns = tier.channel_breakdowns ?? [];
  const activeBreakdowns = breakdowns.filter(isActiveChannelRow);
  const hasChannelAllocation = activeBreakdowns.some(
    (row) => row.allocation_count != null,
  );
  const manualSold = activeBreakdowns
    .filter((row) => row.channel_name !== "4TF")
    .reduce((sum, row) => sum + row.tickets_sold, 0);
  const channelAllocation = activeBreakdowns.reduce(
    (sum, row) => sum + (row.allocation_count ?? 0),
    0,
  );

  return {
    // api_quantity_sold preserves event_ticket_tiers.quantity_sold
    // before legacy additional_ticket_entries are layered onto the tier.
    // Manual channel sales are additive snapshots from tier_channel_sales.
    sold: (tier.api_quantity_sold ?? tier.quantity_sold) + manualSold,
    allocation: hasChannelAllocation ? channelAllocation : tier.quantity_available,
    hasChannelAllocation,
    hasChannelData: activeBreakdowns.length > 0,
  };
}

export function eventTierSalesRollup(tiers: EventTicketTierRow[]): TierSalesRollup {
  let sold = 0;
  let channelAllocation = 0;
  let fallbackAllocation = 0;
  let hasChannelAllocation = false;
  let hasFallbackAllocation = false;
  let hasChannelData = false;

  for (const tier of tiers) {
    const rollup = tierSalesRollup(tier);
    sold += rollup.sold;
    if (rollup.hasChannelAllocation) {
      hasChannelAllocation = true;
      channelAllocation += rollup.allocation ?? 0;
    } else if (rollup.allocation != null) {
      hasFallbackAllocation = true;
      fallbackAllocation += rollup.allocation;
    }
    hasChannelData = hasChannelData || rollup.hasChannelData;
  }

  return {
    sold,
    allocation: hasChannelAllocation
      ? channelAllocation
      : hasFallbackAllocation
        ? fallbackAllocation
        : null,
    hasChannelAllocation,
    hasChannelData,
  };
}

/** Sum explicit `tier_channel_sales.revenue_amount` pivoted into channel_breakdowns. */
export function sumTierChannelRevenueAmounts(tiers: EventTicketTierRow[]): number {
  let sum = 0;
  for (const tier of tiers) {
    for (const row of tier.channel_breakdowns ?? []) {
      sum += Number(row.revenue_amount ?? 0);
    }
  }
  return sum;
}

/** Legacy face-value estimate: Σ (tier sold × tier price). */
export function legacyFaceValueTierRevenue(tiers: EventTicketTierRow[]): number {
  let sum = 0;
  for (const tier of tiers) {
    const rollup = tierSalesRollup(tier);
    const price = tier.price != null ? Number(tier.price) : NaN;
    if (Number.isFinite(price)) sum += rollup.sold * price;
  }
  return sum;
}

/**
 * Ticket revenue for dashboards: prefer summed `tier_channel_sales.revenue_amount`
 * whenever multi-channel rows exist; then weekly snapshot revenue; then face-value.
 */
export function resolveDisplayTicketRevenue(input: {
  ticket_tiers: EventTicketTierRow[];
  latest_snapshot_revenue: number | null | undefined;
}): number | null {
  const { ticket_tiers, latest_snapshot_revenue } = input;
  const hasBreakdown = ticket_tiers.some(
    (t) => (t.channel_breakdowns?.length ?? 0) > 0,
  );
  if (hasBreakdown) {
    return sumTierChannelRevenueAmounts(ticket_tiers);
  }
  if (latest_snapshot_revenue != null && latest_snapshot_revenue > 0) {
    return latest_snapshot_revenue;
  }
  const face = legacyFaceValueTierRevenue(ticket_tiers);
  if (face > 0) return face;
  return latest_snapshot_revenue ?? null;
}

export function tierPctFromRollup(rollup: Pick<TierSalesRollup, "sold" | "allocation">): number | null {
  return rollup.allocation != null && rollup.allocation > 0
    ? (rollup.sold / rollup.allocation) * 100
    : null;
}

function isActiveChannelRow(row: TierChannelBreakdown): boolean {
  return (
    row.allocation_count != null ||
    row.tickets_sold > 0 ||
    (row.revenue_amount != null && Number(row.revenue_amount) !== 0)
  );
}

function compareChannels(
  a: TierChannelDescriptor,
  b: TierChannelDescriptor,
): number {
  if (a.is_automatic !== b.is_automatic) return a.is_automatic ? -1 : 1;
  return a.display_label.localeCompare(b.display_label);
}
