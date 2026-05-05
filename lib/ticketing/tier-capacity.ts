export interface TicketTierCapacityInput {
  quantitySold: number;
  quantityAvailable: number | null;
}

export function ticketTierCapacity(
  tiers: ReadonlyArray<TicketTierCapacityInput>,
): number {
  return tiers.reduce((sum, tier) => {
    const quantity = tier.quantityAvailable;
    const available =
      quantity != null && Number.isFinite(quantity) && quantity > 0
        ? quantity
        : 0;
    const sold =
      Number.isFinite(tier.quantitySold) && tier.quantitySold > 0
        ? tier.quantitySold
        : 0;
    return sum + sold + available;
  }, 0);
}
