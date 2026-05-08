/**
 * lib/ticketing/__tests__/fourthefans-multi-link-tier-sync.test.ts
 *
 * Regression guards for the two tier-sync bugs fixed in
 * fix/fourthefans-multi-link-tier-sync:
 *
 *   Bug 1 — New events with zero pre-existing tier rows returned ok:true but
 *   wrote no tier rows because the parser returned [] for tier array keys
 *   outside its original set (ticket_tiers / ticketTiers / tiers /
 *   ticket_types).  Fix: try `tickets`, `booking_tickets`, `event_tickets`
 *   keys, plus fall back to the outer envelope when the inner `event` object
 *   has no tiers.
 *
 *   Bug 2 — Multi-link events (main listing + pre-reg sibling) only persisted
 *   the first link's tiers. The rollup-sync-runner already iterates all links,
 *   but the parser never emitted tiers for the sibling listing, so
 *   fourthefansTierBatches only ever received one entry.
 *
 * These tests are pure-function / merge-logic tests and run without Next.js or
 * Supabase.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  readFourthefansEventSales,
} from "../fourthefans/parse.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Simulate what rollup-sync-runner.ts does when it collects tier batches from
 * multiple links and merges them.  The runner does:
 *
 *   const fourthefansTierBatches: TicketTierBreakdown[][] = [];
 *   ...
 *   if (contrib.ticketTiers?.length) {
 *     fourthefansTierBatches.push(contrib.ticketTiers);
 *   }
 *   ...
 *   const mergedTiers = fourthefansTierBatches.flat();
 *   replaceEventTicketTiers(supabase, { eventId, tiers: mergedTiers });
 *
 * replaceEventTicketTiers then merges by tier name (summing quantity_sold for
 * collisions).  We replicate that merge here so we can assert on it without
 * a live DB.
 */
function simulateTierMerge(
  batches: ReturnType<typeof readFourthefansEventSales>["ticketTiers"][],
) {
  const flat = batches.flat();
  // Mirror the rowsByName logic in replaceEventTicketTiers
  const byName = new Map<
    string,
    { quantitySold: number; quantityAvailable: number | null }
  >();
  for (const tier of flat) {
    const name = tier.tierName.trim();
    if (!name) continue;
    const sold = Math.max(0, Math.trunc(tier.quantitySold));
    // Convert remaining → total capacity (same as replaceEventTicketTiers)
    const cap =
      tier.quantityAvailable == null
        ? null
        : Math.max(0, Math.trunc(tier.quantitySold + tier.quantityAvailable));
    const existing = byName.get(name);
    if (existing) {
      existing.quantitySold += sold;
      existing.quantityAvailable =
        existing.quantityAvailable == null || cap == null
          ? null
          : existing.quantityAvailable + cap;
    } else {
      byName.set(name, { quantitySold: sold, quantityAvailable: cap });
    }
  }
  return [...byName.entries()].map(([name, v]) => ({
    tierName: name,
    quantitySold: v.quantitySold,
    quantityAvailable: v.quantityAvailable,
  }));
}

// ─── Bug 1: Parser handles undocumented tier-array keys ───────────────────────

describe("readFourthefansEventSales — parser tier key discovery", () => {
  it("parses tiers from the documented `ticket_tiers` key (regression guard)", () => {
    const sales = readFourthefansEventSales({
      data: {
        id: "evt_1",
        tickets_sold: 10,
        capacity: 100,
        ticket_tiers: [
          { name: "GA", quantity_sold: 10, quantity_available: 90 },
        ],
      },
    });
    assert.equal(sales.ticketTiers.length, 1);
    assert.equal(sales.ticketTiers[0]!.tierName, "GA");
    assert.equal(sales.ticketTiers[0]!.quantitySold, 10);
  });

  it("parses tiers from the `tickets` key — common on book.tickets WooCommerce endpoints", () => {
    const sales = readFourthefansEventSales({
      id: "21641",
      title: "Lock Warehouse",
      tickets_sold: 306,
      capacity: 739,
      tickets: [
        { name: "Early Bird", quantity_sold: 100, quantity_available: 0 },
        { name: "GA", quantity_sold: 206, quantity_available: 333 },
      ],
    });
    assert.equal(sales.ticketTiers.length, 2, "should parse 2 tiers from `tickets` key");
    assert.equal(sales.ticketTiers[0]!.tierName, "Early Bird");
    assert.equal(sales.ticketTiers[0]!.quantitySold, 100);
    assert.equal(sales.ticketTiers[1]!.tierName, "GA");
    assert.equal(sales.ticketTiers[1]!.quantitySold, 206);
  });

  it("parses tiers from the `booking_tickets` key", () => {
    const sales = readFourthefansEventSales({
      id: "evt_2",
      tickets_sold: 50,
      capacity: 200,
      booking_tickets: [
        { name: "Standard", quantity_sold: 50, quantity_available: 150 },
      ],
    });
    assert.equal(sales.ticketTiers.length, 1);
    assert.equal(sales.ticketTiers[0]!.tierName, "Standard");
  });

  it("falls back to outer-envelope tiers when the inner `event` object has none", () => {
    // API shape: event metadata in `event` key, tiers at the outer level
    const sales = readFourthefansEventSales({
      event: {
        id: "evt_3",
        tickets_sold: 80,
        capacity: 500,
        // No tier key here — tiers are at the outer envelope
      },
      ticket_tiers: [
        { name: "VIP", quantity_sold: 30, quantity_available: 20 },
        { name: "GA", quantity_sold: 50, quantity_available: 400 },
      ],
    });
    assert.equal(
      sales.ticketTiers.length,
      2,
      "should fall back to outer-envelope `ticket_tiers` when inner `event` has none",
    );
    assert.equal(sales.ticketTiers[0]!.tierName, "VIP");
    assert.equal(sales.ticketTiers[1]!.tierName, "GA");
  });

  it("falls back to outer-envelope `tickets` key when inner `data` object has none", () => {
    const sales = readFourthefansEventSales({
      data: {
        id: "evt_4",
        tickets_sold: 120,
        capacity: 300,
        // No tier array inside `data`
      },
      tickets: [
        { name: "Standard", quantity_sold: 120, quantity_available: 180 },
      ],
    });
    assert.equal(
      sales.ticketTiers.length,
      1,
      "should fall back to outer-envelope `tickets` when `data` has none",
    );
    assert.equal(sales.ticketTiers[0]!.tierName, "Standard");
  });
});

// ─── Bug 2: Multi-link merge collects tiers from ALL links ────────────────────

describe("multi-link tier merge — 2-link event", () => {
  it("merges 5 tiers from each of 2 links: non-colliding names → 10 distinct rows", () => {
    // Simulate link 1 (main listing, e.g. Outernet 18147)
    const link1Sales = readFourthefansEventSales({
      id: "18147",
      tickets_sold: 901,
      capacity: 901,
      tickets: [
        { name: "GA Phase 1", quantity_sold: 200, quantity_available: 0 },
        { name: "GA Phase 2", quantity_sold: 201, quantity_available: 0 },
        { name: "GA Phase 3", quantity_sold: 200, quantity_available: 0 },
        { name: "VIP", quantity_sold: 150, quantity_available: 0 },
        { name: "Super VIP", quantity_sold: 150, quantity_available: 0 },
      ],
    });

    // Simulate link 2 (pre-reg listing, e.g. Outernet 18155)
    const link2Sales = readFourthefansEventSales({
      id: "18155",
      tickets_sold: 456,
      capacity: 456,
      tickets: [
        { name: "Pre-Reg A", quantity_sold: 100, quantity_available: 0 },
        { name: "Pre-Reg B", quantity_sold: 100, quantity_available: 0 },
        { name: "Pre-Reg C", quantity_sold: 100, quantity_available: 0 },
        { name: "Pre-Reg D", quantity_sold: 100, quantity_available: 0 },
        { name: "Pre-Reg E", quantity_sold: 56, quantity_available: 0 },
      ],
    });

    assert.equal(link1Sales.ticketTiers.length, 5, "link 1 should parse 5 tiers");
    assert.equal(link2Sales.ticketTiers.length, 5, "link 2 should parse 5 tiers");

    const merged = simulateTierMerge([link1Sales.ticketTiers, link2Sales.ticketTiers]);
    assert.equal(merged.length, 10, "10 distinct tier names → 10 merged rows");

    const totalSold = merged.reduce((s, t) => s + t.quantitySold, 0);
    assert.equal(totalSold, 1357, "total sold should be 901 + 456 = 1357");
  });

  it("sums quantity_sold for colliding tier names across links", () => {
    // Aston Villa: main 18177 (99 sold / 4235 cap) + pre-reg 18208 (217 sold / 725 cap)
    // Both listings share a "GA" tier name — quantities should be summed.
    // Main listing has a single GA tier (99 sold, 4136 remaining = 4235 cap).
    const link1Sales = readFourthefansEventSales({
      id: "18177",
      tickets_sold: 99,
      capacity: 4235,
      tickets: [
        { name: "GA", quantity_sold: 99, quantity_available: 4136 },
      ],
    });

    // Pre-reg listing: GA (142 sold, 483 remaining = 625 cap) + Pre-Reg GA (75 sold, 25 remaining = 100 cap)
    // Total pre-reg cap = 625 + 100 = 725
    const link2Sales = readFourthefansEventSales({
      id: "18208",
      tickets_sold: 217,
      capacity: 725,
      tickets: [
        { name: "GA", quantity_sold: 142, quantity_available: 483 },
        { name: "Pre-Reg GA", quantity_sold: 75, quantity_available: 25 },
      ],
    });

    assert.equal(link1Sales.ticketTiers.length, 1);
    assert.equal(link2Sales.ticketTiers.length, 2);

    const merged = simulateTierMerge([link1Sales.ticketTiers, link2Sales.ticketTiers]);
    // GA appears in both → 1 merged row; Pre-Reg GA is unique → 2 total rows
    assert.equal(merged.length, 2, "GA collision merges into 1; Pre-Reg GA is distinct → 2 rows");

    const gaRow = merged.find((t) => t.tierName === "GA");
    assert.ok(gaRow, "GA tier should exist in merged result");
    assert.equal(gaRow.quantitySold, 99 + 142, "GA sold should be summed: 99 + 142 = 241");

    const totalCapacity = merged.reduce((s, t) => s + (t.quantityAvailable ?? 0), 0);
    // GA: (99+4136) + (142+483) = 4235 + 625 = 4860; Pre-Reg GA: (75+25) = 100
    // Total capacity = 4860 + 100 = 4960 = 4235 (main) + 725 (pre-reg)
    assert.equal(totalCapacity, 4960, "combined capacity Aston Villa = 4960");
  });
});

// ─── Bug 1: 1-link new-event: parser returns tiers → sync creates rows ────────

describe("1-link new-event: parser produces tiers from Lock Warehouse shape", () => {
  it("returns non-empty tier array for a new event with 10 tiers across `tickets` key", () => {
    // Lock Warehouse link 21641 — 306 sold across 10 tiers, capacity 739.
    // quantity_available here is the REMAINING (unsold) count per tier.
    // Total sold = 306; total remaining = 433; total capacity = 739.
    const sales = readFourthefansEventSales({
      id: "21641",
      title: "Lock Warehouse",
      tickets_sold: 306,
      capacity: 739,
      tickets: [
        { name: "Tier 1",  quantity_sold: 50, quantity_available: 20 },
        { name: "Tier 2",  quantity_sold: 40, quantity_available: 60 },
        { name: "Tier 3",  quantity_sold: 35, quantity_available: 41 },
        { name: "Tier 4",  quantity_sold: 30, quantity_available: 44 },
        { name: "Tier 5",  quantity_sold: 30, quantity_available: 50 },
        { name: "Tier 6",  quantity_sold: 30, quantity_available: 50 },
        { name: "Tier 7",  quantity_sold: 25, quantity_available: 50 },
        { name: "Tier 8",  quantity_sold: 25, quantity_available: 50 },
        { name: "Tier 9",  quantity_sold: 21, quantity_available: 38 },
        { name: "Tier 10", quantity_sold: 20, quantity_available: 30 },
      ],
    });

    assert.equal(
      sales.ticketTiers.length,
      10,
      "new event: parser must return 10 tiers — zero-length would cause fourthefansTierBatches.push to be skipped",
    );

    const totalSold = sales.ticketTiers.reduce((s, t) => s + t.quantitySold, 0);
    assert.equal(totalSold, 306);

    // Total capacity: each tier's (sold + remaining) summed
    const merged = simulateTierMerge([sales.ticketTiers]);
    const totalCap = merged.reduce((s, t) => s + (t.quantityAvailable ?? 0), 0);
    assert.equal(totalCap, 739, "Lock Warehouse capacity should equal 739");
  });

  it("parser result with non-empty ticketTiers passes the fourthefansTierBatches.push guard", () => {
    // The runner guards: `if (contrib.ticketTiers?.length) { fourthefansTierBatches.push(...) }`
    // A zero-length array fails this guard, silently writing no tier rows.
    const sales = readFourthefansEventSales({
      id: "21641",
      tickets_sold: 100,
      capacity: 200,
      tickets: [{ name: "GA", quantity_sold: 100, quantity_available: 100 }],
    });

    // Simulate the runner guard
    const batches: (typeof sales.ticketTiers)[] = [];
    if (sales.ticketTiers?.length) {
      batches.push(sales.ticketTiers);
    }
    assert.equal(
      batches.length,
      1,
      "non-empty ticketTiers must pass the runner's push guard",
    );
  });
});
