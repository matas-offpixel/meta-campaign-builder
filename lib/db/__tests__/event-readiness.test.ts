import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeEventReadiness,
  normalizeEventCode,
  STALE_EVENT_DAYS,
  type ReadinessInput,
} from "../event-readiness.ts";

const TODAY_MS = Date.parse("2026-04-27T12:00:00Z");
const EVENT_DATE = "2026-04-30";

function baseInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    event: {
      id: "evt_1",
      name: "Arsenal CL SF",
      event_code: "4TF26-ARSENAL-CL",
      capacity: 1800,
      event_date: EVENT_DATE,
      general_sale_at: "2026-03-01T09:00:00Z",
    },
    client: { meta_ad_account_id: "act_123" },
    ticketingLinks: [
      { connection_id: "conn_eb", external_event_id: "ext_abc" },
    ],
    ticketingConnections: [
      { id: "conn_eb", provider: "eventbrite", status: "active" },
    ],
    share: {
      token: "tok_abc",
      can_edit: true,
      enabled: true,
      scope: "event",
      event_id: "evt_1",
    },
    nowMs: TODAY_MS,
    ...overrides,
  };
}

describe("normalizeEventCode", () => {
  it("accepts bracket-friendly uppercase codes", () => {
    assert.equal(normalizeEventCode("LEEDS26-FACUP"), "LEEDS26-FACUP");
    assert.equal(normalizeEventCode("4TF26-ARSENAL-CL"), "4TF26-ARSENAL-CL");
    assert.equal(normalizeEventCode("TOTTENHAM_V2"), "TOTTENHAM_V2");
  });

  it("rejects empty / whitespace / null", () => {
    assert.equal(normalizeEventCode(null), null);
    assert.equal(normalizeEventCode(""), null);
    assert.equal(normalizeEventCode("  "), null);
  });

  it("rejects lowercase / spaces / unsafe chars", () => {
    assert.equal(normalizeEventCode("leeds26"), null);
    assert.equal(normalizeEventCode("LEEDS 26"), null);
    assert.equal(normalizeEventCode("LEEDS@26"), null);
  });
});

describe("computeEventReadiness — happy path", () => {
  it("returns ready when every requirement is satisfied", () => {
    const res = computeEventReadiness(baseInput());
    assert.equal(res.status, "ready");
    assert.deepEqual(res.missing, []);
    assert.deepEqual(res.warnings, []);
    assert.equal(res.ticketingMode, "eventbrite");
    assert.equal(res.hasShare, true);
    assert.equal(res.shareIsEditable, true);
    assert.equal(res.normalizedEventCode, "4TF26-ARSENAL-CL");
  });
});

describe("computeEventReadiness — blockers", () => {
  it("blocks on empty event_code", () => {
    const res = computeEventReadiness(
      baseInput({
        event: {
          id: "evt_1",
          event_code: null,
          capacity: 1800,
          event_date: EVENT_DATE,
          general_sale_at: "2026-03-01T09:00:00Z",
        },
      }),
    );
    assert.equal(res.status, "blocked");
    assert.ok(res.missing.some((m) => m.includes("event_code is empty")));
  });

  it("blocks on lowercase / space-containing event_code", () => {
    const res = computeEventReadiness(
      baseInput({
        event: {
          id: "evt_1",
          event_code: "leeds fa",
          capacity: 1800,
          event_date: EVENT_DATE,
          general_sale_at: "2026-03-01T09:00:00Z",
        },
      }),
    );
    assert.equal(res.status, "blocked");
    assert.ok(
      res.missing.some((m) => m.includes("not bracket-friendly")),
      res.missing.join(","),
    );
  });

  it("blocks on missing / zero capacity", () => {
    const res = computeEventReadiness(
      baseInput({
        event: {
          id: "evt_1",
          event_code: "LEEDS26",
          capacity: null,
          event_date: EVENT_DATE,
          general_sale_at: "2026-03-01T09:00:00Z",
        },
      }),
    );
    assert.equal(res.status, "blocked");
    assert.ok(res.missing.some((m) => m.includes("capacity")));
  });

  it("blocks on event_date older than STALE_EVENT_DAYS", () => {
    const stale = new Date(TODAY_MS - (STALE_EVENT_DAYS + 1) * 86_400_000);
    const staleIso = stale.toISOString().slice(0, 10);
    const res = computeEventReadiness(
      baseInput({
        event: {
          id: "evt_1",
          event_code: "OLDEVENT",
          capacity: 1000,
          event_date: staleIso,
          general_sale_at: null,
        },
      }),
    );
    assert.equal(res.status, "blocked");
    assert.ok(res.missing.some((m) => m.includes("in the past")));
  });

  it("blocks on no ticketing connections", () => {
    const res = computeEventReadiness(
      baseInput({ ticketingConnections: [], ticketingLinks: [] }),
    );
    assert.equal(res.status, "blocked");
    assert.ok(
      res.missing.some((m) => m.includes("no ticketing connection")),
    );
  });

  it("blocks when Eventbrite connection exists but no link row", () => {
    const res = computeEventReadiness(
      baseInput({
        ticketingLinks: [],
        ticketingConnections: [
          { id: "conn_eb", provider: "eventbrite", status: "active" },
        ],
      }),
    );
    assert.equal(res.status, "blocked");
    assert.equal(res.ticketingMode, "none");
  });
});

describe("computeEventReadiness — warnings (partial state)", () => {
  it("warns when share row missing but otherwise ready", () => {
    const res = computeEventReadiness(baseInput({ share: null }));
    assert.equal(res.status, "partial");
    assert.ok(res.warnings.some((w) => w.includes("no report_shares row")));
    assert.equal(res.hasShare, false);
  });

  it("warns when share disabled", () => {
    const res = computeEventReadiness(
      baseInput({
        share: {
          token: "tok_x",
          can_edit: true,
          enabled: false,
          scope: "event",
          event_id: "evt_1",
        },
      }),
    );
    assert.equal(res.status, "partial");
    assert.ok(res.warnings.some((w) => w.includes("enabled = false")));
    assert.equal(res.shareIsEditable, false);
  });

  it("warns when client meta_ad_account_id is missing", () => {
    const res = computeEventReadiness(
      baseInput({ client: { meta_ad_account_id: null } }),
    );
    assert.equal(res.status, "partial");
    assert.ok(
      res.warnings.some((w) => w.includes("meta_ad_account_id")),
    );
  });

  it("warns when 4thefans ticketing is selected (API not live yet)", () => {
    const res = computeEventReadiness(
      baseInput({
        ticketingConnections: [
          { id: "conn_4tf", provider: "fourthefans", status: "active" },
        ],
        ticketingLinks: [],
      }),
    );
    assert.equal(res.status, "partial");
    assert.equal(res.ticketingMode, "fourthefans");
    assert.ok(res.warnings.some((w) => w.includes("4thefans")));
  });
});
