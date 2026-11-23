import assert from "node:assert/strict";
import { test } from "node:test";

import { averagePrice, pickSignups, presaleDayReading, rollupClient, tierAveragePrice, valueOf, type ShowValue, type Snap } from "../model.ts";

const snap = (day: string, tickets: number, revenueMinor: number | null = null, source = "internal_counts"): Snap => ({
  snapshotAt: `${day}T12:00:00Z`,
  day,
  tickets,
  revenueMinor,
  currency: "GBP",
  source,
});

test("on-day count less the last count before P", () => {
  const r = presaleDayReading([snap("2026-09-30", 0, 0), snap("2026-10-01", 277, 555550), snap("2026-10-05", 438)], "2026-10-01", "2026-10-01")!;
  assert.equal(r.tickets, 277);
  assert.equal(r.endRead, "on_day");
  assert.ok(r.flags.includes("GS same day"));
  const p = averagePrice(null, [], r)!;
  assert.equal(p.source, "presale-day revenue");
  assert.equal(Math.round(p.value * 100) / 100, 20.06);
});

test("a P count with no sales (taken before the open) falls to P+1", () => {
  const r = presaleDayReading([snap("2026-11-03", 0, 0), snap("2026-11-04", 450, 842500)], "2026-11-03", "2026-11-04")!;
  assert.equal(r.tickets, 450);
  assert.equal(r.endRead, "next_day");
  assert.equal(r.base, null);
  assert.ok(r.flags.includes("P+1 count includes GS day"));
});

test("no count on P or P+1 → no reading", () => {
  assert.equal(presaleDayReading([snap("2026-09-11", 498)], "2026-08-05", null), null);
});

test("one source per show, the highest priority with a P or P+1 count", () => {
  const r = presaleDayReading(
    [snap("2026-10-01", 100, null, "eventbrite"), snap("2026-09-30", 10, null, "eventbrite"), snap("2026-10-02", 300, null, "internal_counts")],
    "2026-10-01",
    null,
  )!;
  assert.equal(r.source, "internal_counts");
  assert.equal(r.tickets, 300);
});

test("tier price is sold-weighted over each tier's latest row", () => {
  const t = (tier_name: string, price: number, quantity_sold: number, snapshot_at: string) => ({ tier_name, price, quantity_sold, snapshot_at, updated_at: null });
  assert.equal(tierAveragePrice([t("A", 10, 1, "2026-01-01"), t("A", 10, 10, "2026-01-02"), t("B", 20, 10, "2026-01-02")]), 15);
  assert.equal(tierAveragePrice([t("A", 10, 0, "2026-01-01")]), null);
});

test("signups: CIRQLIN first, Meta registrations last", () => {
  const c = (source: Parameters<typeof pickSignups>[0][number]["source"], value: number) => ({ source, value, estimated: false, note: "" });
  assert.equal(pickSignups([c("Meta registrations", 50), c("Mailchimp P−1", 900), c("CIRQLIN", 1000)])!.source, "CIRQLIN");
  assert.equal(pickSignups([c("Meta registrations", 50), c("CIRQLIN", 0)])!.source, "Meta registrations");
  assert.equal(pickSignups([]), null);
});

test("value and client pooling", () => {
  const s = (tickets: number, signups: number, price: number, sharedDay: boolean): ShowValue => {
    const sg = { source: "CIRQLIN" as const, value: signups, estimated: false, note: "" };
    const p = { value: price, source: "tiers" as const, currency: "GBP" };
    return { eventId: "x", client: "C", label: "x", presaleDay: "2026-01-01", tickets, signups: sg, price: p, sharedDay, ...valueOf(tickets, sg, p) };
  };
  const a = s(100, 1000, 20, false); // £2.00
  const b = s(300, 1000, 20, true); // £6.00
  assert.equal(a.valuePerSignup, 2);
  const r = rollupClient("C", [a, b]);
  assert.equal(r.pooled, 4);
  assert.equal(r.pooledExShared, 2);
  assert.equal(r.median, 4);
  assert.equal(r.pooledConversion, 0.2);
});
