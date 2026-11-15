import { test } from "node:test";
import assert from "node:assert/strict";

import { clientOpenRatio, resolveOpens } from "../opens.ts";
import { batchesByColumns, writableRow } from "../store.ts";
import { summariseD2CStats, type StoredStatsRow } from "../summary.ts";
import { normaliseStatsRow } from "../read.ts";
import type { D2CStatsRow } from "../types.ts";

function stored(over: Partial<StoredStatsRow>): StoredStatsRow {
  return {
    id: "id",
    provider: "bird",
    account_id: "acct",
    external_id: "x",
    channel: "whatsapp",
    client_id: "client-harbour",
    event_id: null,
    attribution: "client",
    audience_kind: "marketing",
    name: null,
    sent_at: "2026-11-01T00:00:00Z",
    sent: null,
    delivered: null,
    read: null,
    clicked: null,
    opens_unique_raw: null,
    opens_unique_filtered: null,
    open_rate_filtered: null,
    fetched_at: null,
    ...over,
  };
}

test("bot-filtered opens are used as given", () => {
  const r = resolveOpens({ delivered: 500, opens_unique_raw: 150, opens_unique_filtered: 15, open_rate_filtered: 0.03 }, 0.5);
  assert.deepEqual(r, { opens: 15, rate: 0.03, estimated: false });
});

test("without filtered opens, the client's own ratio estimates them and marks est.", () => {
  const ratio = clientOpenRatio([
    { delivered: 100, opens_unique_raw: 40, opens_unique_filtered: 4, open_rate_filtered: 0.04 },
    { delivered: 100, opens_unique_raw: 60, opens_unique_filtered: 6, open_rate_filtered: 0.06 },
    { delivered: 100, opens_unique_raw: 50, opens_unique_filtered: null, open_rate_filtered: null },
  ]);
  assert.equal(ratio, 0.1);
  assert.deepEqual(resolveOpens({ delivered: 200, opens_unique_raw: 50, opens_unique_filtered: null, open_rate_filtered: null }, ratio), {
    opens: 5,
    rate: 0.025,
    estimated: true,
  });
});

test("with no ratio, a raw open count is never returned as opens", () => {
  assert.deepEqual(resolveOpens({ delivered: 200, opens_unique_raw: 90, opens_unique_filtered: null, open_rate_filtered: null }, null), {
    opens: null,
    rate: null,
    estimated: false,
  });
});

test("WhatsApp cost = delivered × rate; no rate, no cost", () => {
  const rows = [
    stored({ id: "a", delivered: 500, clicked: 50, read: 250 }),
    stored({ id: "b", delivered: 300, clicked: 10, read: 120 }),
  ];
  const priced = summariseD2CStats(rows, { rate: 0.05, currency: "GBP" });
  const wa = priced.channels.find((c) => c.group === "whatsapp")!;
  assert.equal(wa.delivered, 800);
  assert.equal(wa.cost, 40);
  assert.equal(wa.costPerClick, 40 / 60);
  assert.equal(wa.clickRate, 60 / 800);
  assert.equal(wa.readRate, 370 / 800);
  assert.equal(priced.broadcasts.find((b) => b.id === "a")!.cost, 25);

  const unpriced = summariseD2CStats(rows, { rate: null, currency: "GBP" });
  const wa2 = unpriced.channels.find((c) => c.group === "whatsapp")!;
  assert.equal(wa2.cost, null);
  assert.equal(wa2.costPerClick, null);
});

test("email splits marketing and ticket-holder sends, and carries est.", () => {
  const rows = [
    stored({ id: "m1", provider: "mailchimp", channel: "email", delivered: 1000, clicked: 30, opens_unique_raw: 300, opens_unique_filtered: 30, open_rate_filtered: 0.03 }),
    stored({ id: "m2", provider: "mailchimp", channel: "email", delivered: 1000, clicked: 20, opens_unique_raw: 200, opens_unique_filtered: null }),
    stored({ id: "t1", provider: "mailchimp", channel: "email", audience_kind: "ticket_holder", delivered: 100, clicked: 12, opens_unique_raw: 50, opens_unique_filtered: 9, open_rate_filtered: 0.09 }),
  ];
  const s = summariseD2CStats(rows, { rate: 0.05, currency: "GBP" });
  const mkt = s.channels.find((c) => c.group === "email_marketing")!;
  const th = s.channels.find((c) => c.group === "email_ticket_holder")!;
  assert.equal(mkt.broadcasts, 2);
  assert.equal(mkt.opensEstimated, true);
  assert.equal(mkt.cost, null);
  assert.equal(th.broadcasts, 1);
  assert.equal(th.opensEstimated, false);
  assert.equal(th.clickRate, 0.12);
  assert.equal(s.broadcasts.find((b) => b.id === "m1")!.read, null);
});

test("a show view uses the whole client's open ratio", () => {
  const client = [
    stored({ id: "m1", channel: "email", opens_unique_raw: 100, opens_unique_filtered: 20, delivered: 500 }),
    stored({ id: "m2", channel: "email", opens_unique_raw: 100, opens_unique_filtered: null, delivered: 500, event_id: "ev" }),
  ];
  const show = client.filter((r) => r.event_id === "ev");
  const s = summariseD2CStats(show, { rate: null, currency: "GBP" }, client);
  assert.equal(s.openRatio, 0.2);
  assert.deepEqual(s.broadcasts[0]!.opens, { opens: 20, rate: 0.04, estimated: true });
});

test("numeric strings from PostgREST normalise to numbers", () => {
  const r = normaliseStatsRow({ id: "a", delivered: "12", open_rate_filtered: "0.031000", clicked: null });
  assert.equal(r.delivered, 12);
  assert.equal(r.open_rate_filtered, 0.031);
  assert.equal(r.clicked, null);
});

function row(over: Partial<D2CStatsRow>): D2CStatsRow {
  return {
    provider: "bird",
    account_id: "ws",
    external_id: "c1",
    channel: "whatsapp",
    client_id: "client-harbour",
    event_id: null,
    attribution: "client",
    audience_kind: "marketing",
    name: "x",
    sent_at: null,
    list_id: null,
    channel_ids: null,
    audience: null,
    sent: 1,
    delivered: 1,
    read: null,
    clicked: 1,
    opens_unique_raw: null,
    opens_unique_filtered: null,
    open_rate_filtered: null,
    bounces: null,
    unsubscribes: null,
    raw: null,
    fetched_at: "now",
    ...over,
  };
}

test("a null count is left out of the write; attribution is always written", () => {
  const w = writableRow(row({ read: null, event_id: null }));
  assert.equal("read" in w, false);
  assert.equal("sent_at" in w, false);
  assert.equal("event_id" in w, true);
  assert.equal(w.event_id, null);
  assert.equal("attribution" in w, true);
});

test("rows are batched by their column set so no batch writes a missing column as NULL", () => {
  const batches = batchesByColumns([row({ external_id: "a" }), row({ external_id: "b", read: 5 }), row({ external_id: "c" })]);
  assert.equal(batches.length, 2);
  for (const b of batches) {
    const keys = new Set(b.map((r) => Object.keys(r).sort().join(",")));
    assert.equal(keys.size, 1);
  }
});
