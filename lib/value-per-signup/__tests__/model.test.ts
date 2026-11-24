import assert from "node:assert/strict";
import { test } from "node:test";

import {
  averagePrice,
  BASE_ZERO,
  INCLUDES_GENERAL_SALE,
  pickSignups,
  presaleDayReading,
  readingGaps,
  rollupClient,
  signupCandidates,
  tierAveragePrice,
  valueOf,
  type ShowValue,
  type SignupInputs,
  type Snap,
} from "../model.ts";

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
  assert.ok(r.includesGeneralSale);
  assert.ok(r.flags.includes(INCLUDES_GENERAL_SALE));
  const p = averagePrice(null, [], r)!;
  assert.equal(p.source, "presale-day revenue");
  assert.equal(Math.round(p.value * 100) / 100, 20.06);
});

test("a P count with no sales (taken before the open) falls to P+1", () => {
  const r = presaleDayReading([snap("2026-11-03", 0, 0), snap("2026-11-04", 450, 842500)], "2026-11-03", "2026-11-04")!;
  assert.equal(r.tickets, 450);
  assert.equal(r.endRead, "next_day");
  assert.equal(r.base, null);
  assert.ok(r.includesGeneralSale, "the P+1 count covers the GS day");
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

// ── Ruling 1: the whole presale day, flagged when general sale opens on a day the count covers ──

test("ruling 1: includes_general_sale only when GS opens on a day the end count covers", () => {
  const snaps = [snap("2026-10-07", 100), snap("2026-10-08", 140)];
  // GS on P: the P count holds both, kept whole.
  const same = presaleDayReading(snaps, "2026-10-07", "2026-10-07")!;
  assert.equal(same.tickets, 100);
  assert.ok(same.includesGeneralSale);
  // GS on P+1, but the P count is used: no general-sale tickets in it.
  const next = presaleDayReading(snaps, "2026-10-07", "2026-10-08")!;
  assert.equal(next.endRead, "on_day");
  assert.equal(next.includesGeneralSale, false);
  assert.ok(!next.flags.includes(INCLUDES_GENERAL_SALE));
  // GS weeks later: never flagged.
  assert.equal(presaleDayReading(snaps, "2026-10-07", "2026-10-21")!.includesGeneralSale, false);
  // No GS date: never flagged.
  assert.equal(presaleDayReading(snaps, "2026-10-07", null)!.includesGeneralSale, false);
});

// ── Ruling 2: signups up to the presale open ──

const inputs = (over: Partial<SignupInputs>): SignupInputs => ({
  cirqlinAtOpen: null,
  cirqlinThroughP1: null,
  landingPageAtOpen: null,
  mailchimpP1: null,
  mailchimpEarlier: null,
  metaRegistrations: null,
  ...over,
});

test("ruling 2: CIRQLIN is cut at the open, not P−1, when the open-time count is read", () => {
  const c = signupCandidates(inputs({ cirqlinAtOpen: 1094, cirqlinThroughP1: 1076 }));
  const s = pickSignups(c)!;
  assert.equal(s.source, "CIRQLIN");
  assert.equal(s.value, 1094);
  assert.equal(s.cut, "open");
  assert.match(s.note, /1076 to P−1 \+ 18 on P before it/);
});

test("ruling 2: without the open-time read, CIRQLIN falls to P−1 and says so", () => {
  const s = pickSignups(signupCandidates(inputs({ cirqlinThroughP1: 1076 })))!;
  assert.equal(s.value, 1076);
  assert.equal(s.cut, "P−1");
  assert.equal(s.estimated, false);
});

test("ruling 2: landing page is cut at the open; Mailchimp is daily, cut at P−1", () => {
  const c = signupCandidates(inputs({ landingPageAtOpen: 300, mailchimpP1: { value: 280, note: "tag on 6 Oct" } }));
  assert.equal(c.find((x) => x.source === "landing page")!.cut, "open");
  assert.equal(c.find((x) => x.source === "Mailchimp P−1")!.cut, "P−1");
  assert.equal(pickSignups(c)!.source, "landing page");
});

// ── Ruling 3: no count before P starts from 0, and the gap list says so ──

test("ruling 3: no earlier count → base 0, flagged, and a gap line", () => {
  const r = presaleDayReading([snap("2026-10-07", 277)], "2026-10-07", null)!;
  assert.equal(r.base, null);
  assert.equal(r.tickets, 277);
  assert.ok(r.flags.includes(BASE_ZERO));
  const gaps = readingGaps(r);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0]!, /no count before P, so the presale-day count starts from 0/);
  // With a base, no such line.
  assert.deepEqual(readingGaps(presaleDayReading([snap("2026-10-06", 10), snap("2026-10-07", 277)], "2026-10-07", null)), []);
  assert.deepEqual(readingGaps(null), []);
});

// ── Ruling 4: pooled per client, median beside, stand-ins listed but out ──

const show = (label: string, tickets: number, signups: number, price: number, opts: { includesGeneralSale?: boolean; standIn?: boolean; client?: string } = {}): ShowValue => {
  const sg = { source: opts.standIn ? ("Meta registrations" as const) : ("CIRQLIN" as const), value: signups, estimated: !!opts.standIn, note: "" };
  const p = { value: price, source: "tiers" as const, currency: "GBP" };
  return { eventId: label, client: opts.client ?? "C", label, presaleDay: "2026-01-01", tickets, signups: sg, price: p, includesGeneralSale: !!opts.includesGeneralSale, ...valueOf(tickets, sg, p) };
};

test("ruling 4: pooled value and median over counted signups; stand-ins listed, not pooled", () => {
  const a = show("A", 100, 1000, 20); // £2.00
  const b = show("B", 300, 1000, 20, { includesGeneralSale: true }); // £6.00
  const c = show("C", 400, 1000, 20); // £8.00
  const julian = show("JF", 340, 260, 18.73, { standIn: true }); // £24.49, 130.8%
  assert.equal(a.valuePerSignup, 2);
  const r = rollupClient("C", [a, b, c, julian]);
  assert.equal(r.withValue, 3);
  assert.equal(Math.round(r.pooled! * 100) / 100, 5.33); // (2000 + 6000 + 8000) / 3000
  assert.equal(r.median, 6);
  assert.equal(Math.round(r.pooledConversion! * 1000) / 1000, 0.267);
  assert.equal(r.includesGeneralSale, 1);
  assert.deepEqual(r.standIns.map((s) => s.label), ["JF"]);
  // The stand-in alone gives no value.
  const only = rollupClient("C", [julian]);
  assert.equal(only.pooled, null);
  assert.equal(only.standIns.length, 1);
});

test("ruling 4: never borrowed across clients", () => {
  assert.throws(() => rollupClient("C", [show("A", 100, 1000, 20), show("X", 100, 100, 20, { client: "Other" })]), /never borrowed across clients/);
  assert.equal(rollupClient("Empty", []).pooled, null);
});
