export type MarketingAction =
  | {
      kind: "promote_next_tier";
      current_tier: string;
      next_tier: string;
      reason: string;
    }
  | {
      kind: "release_next_tier";
      current_tier: string;
      suggested_next: string;
      reason: string;
    }
  | {
      kind: "premium_underperforming";
      tier: string;
      pct: number;
      reason: string;
    }
  | { kind: "scale_spend"; reason: string }
  | { kind: "reduce_spend"; reason: string }
  | { kind: "sold_out_celebrate"; reason: string }
  | { kind: "pre_sale_hold"; reason: string }
  | { kind: "hold"; reason: string };

export interface MarketingActionEvent {
  tickets_sold: number;
  capacity: number;
  days_until_event: number;
  pct_sold: number;
  tiers: Array<{
    tier_name: string;
    quantity_sold: number;
    quantity_available: number;
    price: number;
  }>;
}

export function recommendMarketingAction(event: MarketingActionEvent): MarketingAction {
  const { tickets_sold, capacity, days_until_event, pct_sold, tiers } = event;

  if (capacity > 0 && tickets_sold >= capacity) {
    return {
      kind: "sold_out_celebrate",
      reason: "Event is sold out — share the milestone in marketing comms",
    };
  }

  if (!tiers || tiers.length === 0) {
    if (pct_sold >= 75 && days_until_event > 0) {
      return {
        kind: "scale_spend",
        reason: "Strong selling pace — lean in to capture remaining momentum",
      };
    }
    if (pct_sold < 30 && days_until_event < 30) {
      return {
        kind: "reduce_spend",
        reason: "Low sell-through with event approaching — review creative or reduce spend",
      };
    }
    return {
      kind: "hold",
      reason: "No tier data available — waiting on link to ticketing provider",
    };
  }

  const onSaleTiers = tiers.filter(
    (tier) => tier.quantity_available > 0 || tier.quantity_sold > 0,
  );
  if (onSaleTiers.length === 0) {
    return {
      kind: "pre_sale_hold",
      reason: "Pre-sale phase — wait for first tier release",
    };
  }

  const sortedByPrice = [...tiers].sort((a, b) => a.price - b.price);
  const soldOutLowest = sortedByPrice.find(
    (tier) =>
      tier.quantity_available > 0 &&
      tier.quantity_sold > 0 &&
      tier.quantity_sold >= tier.quantity_available,
  );
  const nextAvailable = sortedByPrice.find(
    (tier) => tier.quantity_available > 0 && tier.quantity_sold < tier.quantity_available,
  );
  if (soldOutLowest && nextAvailable && nextAvailable.tier_name !== soldOutLowest.tier_name) {
    return {
      kind: "promote_next_tier",
      current_tier: soldOutLowest.tier_name,
      next_tier: nextAvailable.tier_name,
      reason: `${soldOutLowest.tier_name} sold out. Push ${nextAvailable.tier_name} (£${nextAvailable.price.toFixed(2)}) in next ad creative.`,
    };
  }

  const highSellingTier = onSaleTiers.find(
    (tier) =>
      tier.quantity_available > 0 && tier.quantity_sold / tier.quantity_available > 0.85,
  );
  const unreleasedTier = sortedByPrice.find((tier) => {
    const name = tier.tier_name.toLowerCase();
    return (
      (name.includes("final") || name.includes("extra") || name.includes("resell")) &&
      tier.quantity_sold === 0 &&
      tier.quantity_available === 0
    );
  });
  if (highSellingTier && unreleasedTier) {
    return {
      kind: "release_next_tier",
      current_tier: highSellingTier.tier_name,
      suggested_next: unreleasedTier.tier_name,
      reason: `${highSellingTier.tier_name} at ${Math.round((highSellingTier.quantity_sold / highSellingTier.quantity_available) * 100)}% sold. Consider releasing ${unreleasedTier.tier_name} to maintain momentum.`,
    };
  }

  const premiumTier = onSaleTiers.find((tier) => {
    const name = tier.tier_name.toLowerCase();
    return (name.includes("premium") || name.includes("vip")) && tier.quantity_available > 0;
  });
  const gaTier = onSaleTiers.find((tier) => {
    const name = tier.tier_name.toLowerCase();
    return (
      (name.includes("general admission") || /\bga\b/.test(name)) &&
      !name.includes("premium") &&
      tier.quantity_available > 0
    );
  });
  if (premiumTier && gaTier) {
    const premiumPct = premiumTier.quantity_sold / premiumTier.quantity_available;
    const gaPct = gaTier.quantity_sold / gaTier.quantity_available;
    if (gaPct >= 0.4 && premiumPct < gaPct * 0.5) {
      return {
        kind: "premium_underperforming",
        tier: premiumTier.tier_name,
        pct: premiumPct,
        reason: `${premiumTier.tier_name} at ${Math.round(premiumPct * 100)}% vs ${gaTier.tier_name} at ${Math.round(gaPct * 100)}%. Run targeted creative for premium audience.`,
      };
    }
  }

  if (pct_sold >= 75 && days_until_event > 7) {
    return {
      kind: "scale_spend",
      reason: `${Math.round(pct_sold)}% sold with ${days_until_event} days remaining. Scale spend to capture momentum.`,
    };
  }

  if (pct_sold < 30 && days_until_event < 30) {
    return {
      kind: "reduce_spend",
      reason: `Only ${Math.round(pct_sold)}% sold with ${days_until_event} days to go. Review creative effectiveness or pull spend.`,
    };
  }

  return { kind: "hold", reason: "On track — maintain current strategy" };
}
