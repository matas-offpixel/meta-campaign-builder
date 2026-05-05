export interface TicketTierCapacityInput {
  quantityAvailable: number | null;
}

export function ticketTierCapacity(
  tiers: ReadonlyArray<TicketTierCapacityInput>,
): number {
  return tiers.reduce((sum, tier) => {
    const quantity = tier.quantityAvailable;
    return quantity != null && Number.isFinite(quantity) && quantity > 0
      ? sum + quantity
      : sum;
  }, 0);
}
