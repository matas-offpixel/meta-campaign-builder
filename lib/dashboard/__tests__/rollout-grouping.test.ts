import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildRolloutGroups,
  parseExpandedHash,
  serializeExpandedHash,
  type GroupableRow,
} from "../rollout-grouping.ts";

function row(overrides: Partial<GroupableRow> & { eventId: string }): GroupableRow {
  return {
    eventCode: null,
    eventDate: null,
    venueName: null,
    capacity: null,
    ticketingMode: "none",
    status: "ready",
    missing: [],
    warnings: [],
    hasShare: false,
    ...overrides,
  };
}

describe("buildRolloutGroups", () => {
  it("returns singletons when no two rows share a grouping key", () => {
    const nodes = buildRolloutGroups([
      row({ eventId: "a", eventCode: "A26", eventDate: "2026-01-01" }),
      row({ eventId: "b", eventCode: "B26", eventDate: "2026-01-01" }),
      row({ eventId: "c", eventCode: null }),
    ]);
    assert.equal(nodes.length, 3);
    assert.ok(nodes.every((n) => n.kind === "single"));
  });

  it("groups ≥2 rows with same event_code into series (different dates)", () => {
    const nodes = buildRolloutGroups([
      row({
        eventId: "a",
        eventCode: "CODE",
        eventDate: "2026-01-01",
        venueName: "Depot",
      }),
      row({
        eventId: "b",
        eventCode: "CODE",
        eventDate: "2026-02-02",
        venueName: "Depot",
      }),
    ]);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "group");
    if (nodes[0].kind !== "group") throw new Error();
    assert.equal(nodes[0].group.children.length, 2);
    assert.equal(nodes[0].group.eventDate, null);
  });

  it("groups same event_code with different venues into one series", () => {
    const nodes = buildRolloutGroups([
      row({
        eventId: "a",
        eventCode: "4TF26-ARSENAL-CL-FL",
        eventDate: "2026-06-27",
        venueName: "Outernet",
      }),
      row({
        eventId: "b",
        eventCode: "4TF26-ARSENAL-CL-FL",
        eventDate: "2026-06-27",
        venueName: "Village Underground",
      }),
    ]);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "group");
    if (nodes[0].kind !== "group") throw new Error();
    assert.equal(nodes[0].group.children.length, 2);
    assert.equal(nodes[0].group.key, "series:4TF26-ARSENAL-CL-FL");
  });

  it("does not merge rows that only share dates — different event_codes stay separate", () => {
    const nodes = buildRolloutGroups([
      row({
        eventId: "dublin",
        eventCode: "4TF26-ARSENAL-CL-DUBLIN",
        eventDate: "2026-07-01",
        venueName: "Button Factory",
      }),
      row({
        eventId: "london-a",
        eventCode: "4TF26-ARSENAL-CL-FL",
        eventDate: "2026-07-01",
        venueName: "Outernet",
      }),
      row({
        eventId: "london-b",
        eventCode: "4TF26-ARSENAL-CL-FL",
        eventDate: "2026-07-01",
        venueName: "Village Underground",
      }),
    ]);
    assert.equal(nodes.length, 2);
    const groupNode = nodes.find((n) => n.kind === "group");
    const soloNode = nodes.find((n) => n.kind === "single");
    assert.ok(groupNode?.kind === "group");
    assert.ok(soloNode?.kind === "single");
    if (groupNode?.kind !== "group" || soloNode?.kind !== "single") {
      throw new Error("expected one group and one single");
    }
    assert.equal(groupNode.group.children.length, 2);
    assert.equal(soloNode.row.eventId, "dublin");
    assert.equal(groupNode.group.eventCode, "4TF26-ARSENAL-CL-FL");
  });

  it("groups 2+ rows that share event_code AND event_date", () => {
    const nodes = buildRolloutGroups([
      row({
        eventId: "m1",
        eventCode: "WC26-LON-TOT",
        eventDate: "2026-06-27",
        venueName: "Tottenham",
        capacity: 1176,
        ticketingMode: "eventbrite",
        status: "ready",
        hasShare: true,
      }),
      row({
        eventId: "m2",
        eventCode: "WC26-LON-TOT",
        eventDate: "2026-06-27",
        venueName: "Tottenham",
        capacity: 1176,
        ticketingMode: "eventbrite",
        status: "blocked",
        missing: ["event_code missing"],
        hasShare: false,
      }),
      row({
        eventId: "m3",
        eventCode: "WC26-LON-TOT",
        eventDate: "2026-06-27",
        venueName: "Tottenham",
        capacity: 1176,
        ticketingMode: "eventbrite",
        status: "partial",
        warnings: ["general_sale_at missing"],
        hasShare: true,
      }),
      row({
        eventId: "m4",
        eventCode: "WC26-LON-TOT",
        eventDate: "2026-06-27",
        venueName: "Tottenham",
        capacity: 1176,
        ticketingMode: "eventbrite",
        status: "ready",
        hasShare: true,
      }),
    ]);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "group");
    if (nodes[0].kind !== "group") throw new Error("expected group");
    const g = nodes[0].group;
    assert.equal(g.eventCode, "WC26-LON-TOT");
    assert.equal(g.eventDate, "2026-06-27");
    assert.equal(g.venueName, "Tottenham");
    assert.equal(g.children.length, 4);
    assert.equal(g.capacity, 4704);
    assert.equal(g.capacityAllNull, false);
    assert.equal(g.ticketingLabel, "Eventbrite (4)");
    assert.equal(g.status, "blocked");
    assert.equal(g.shareCount, 3);
    assert.deepEqual(g.childIds, ["m1", "m2", "m3", "m4"]);
    assert.deepEqual(g.aggregateMissing, ["event_code missing"]);
    assert.deepEqual(g.aggregateWarnings, ["general_sale_at missing"]);
  });

  it("reports 'Mixed (N)' when children span multiple ticketing modes", () => {
    const nodes = buildRolloutGroups([
      row({
        eventId: "a",
        eventCode: "CODE",
        eventDate: "2026-01-01",
        ticketingMode: "eventbrite",
      }),
      row({
        eventId: "b",
        eventCode: "CODE",
        eventDate: "2026-01-01",
        ticketingMode: "manual",
      }),
    ]);
    assert.equal(nodes[0].kind, "group");
    if (nodes[0].kind !== "group") throw new Error();
    assert.equal(nodes[0].group.ticketingLabel, "Mixed (2)");
  });

  it("treats capacity=null as absent and flags capacityAllNull when every child is null", () => {
    const nodes = buildRolloutGroups([
      row({ eventId: "a", eventCode: "X", eventDate: "2026-01-01" }),
      row({ eventId: "b", eventCode: "X", eventDate: "2026-01-01" }),
    ]);
    assert.equal(nodes[0].kind, "group");
    if (nodes[0].kind !== "group") throw new Error();
    assert.equal(nodes[0].group.capacity, 0);
    assert.equal(nodes[0].group.capacityAllNull, true);
  });

  it("preserves input order across singles and groups", () => {
    const nodes = buildRolloutGroups([
      row({ eventId: "solo1", eventCode: "S1", eventDate: "2026-01-10" }),
      row({ eventId: "g1", eventCode: "G", eventDate: "2026-01-05" }),
      row({ eventId: "solo2", eventCode: "S2", eventDate: "2026-01-06" }),
      row({ eventId: "g2", eventCode: "G", eventDate: "2026-01-05" }),
    ]);
    assert.equal(nodes.length, 3);
    assert.equal(nodes[0].kind, "single");
    assert.equal(nodes[1].kind, "group");
    assert.equal(nodes[2].kind, "single");
  });

  it("is case-sensitive on event_code (ACME ≠ Acme)", () => {
    const nodes = buildRolloutGroups([
      row({ eventId: "a", eventCode: "ACME", eventDate: "2026-01-01" }),
      row({ eventId: "b", eventCode: "Acme", eventDate: "2026-01-01" }),
    ]);
    assert.equal(nodes.length, 2);
    assert.ok(nodes.every((n) => n.kind === "single"));
  });

  it("groups KOC fixture codes by 3-part venue prefix (Brixton ×5 → 1 group)", () => {
    const brixtonCodes = [
      "WC26-KOC-BRIXTON-ENG-CRO",
      "WC26-KOC-BRIXTON-AUS-USA",
      "WC26-KOC-BRIXTON-ENG-GHA",
      "WC26-KOC-BRIXTON-SCO-BRA",
      "WC26-KOC-BRIXTON-ENG-PAN",
    ];
    const nodes = buildRolloutGroups(
      brixtonCodes.map((code, i) =>
        row({ eventId: `b${i}`, eventCode: code, eventDate: `2026-06-${17 + i}` }),
      ),
    );
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "group");
    if (nodes[0].kind !== "group") throw new Error();
    assert.equal(nodes[0].group.key, "series:WC26-KOC-BRIXTON");
    assert.equal(nodes[0].group.eventCode, "WC26-KOC-BRIXTON");
    assert.equal(nodes[0].group.children.length, 5);
  });

  it("keeps KOC venues in separate groups (Brixton and Hackney do not merge)", () => {
    const nodes = buildRolloutGroups([
      row({ eventId: "b1", eventCode: "WC26-KOC-BRIXTON-ENG-CRO", eventDate: "2026-06-17" }),
      row({ eventId: "b2", eventCode: "WC26-KOC-BRIXTON-AUS-USA", eventDate: "2026-06-19" }),
      row({ eventId: "h1", eventCode: "WC26-KOC-HACKNEY-ENG-CRO", eventDate: "2026-06-17" }),
      row({ eventId: "h2", eventCode: "WC26-KOC-HACKNEY-AUS-USA", eventDate: "2026-06-19" }),
    ]);
    assert.equal(nodes.length, 2);
    assert.ok(nodes.every((n) => n.kind === "group"));
    const keys = nodes
      .filter((n) => n.kind === "group")
      .map((n) => n.kind === "group" ? n.group.key : "");
    assert.ok(keys.includes("series:WC26-KOC-BRIXTON"));
    assert.ok(keys.includes("series:WC26-KOC-HACKNEY"));
  });

  it("does not affect 4theFans WC26 venue codes (no regression)", () => {
    const nodes = buildRolloutGroups([
      row({ eventId: "a", eventCode: "WC26-BRIGHTON", eventDate: "2026-06-17" }),
      row({ eventId: "b", eventCode: "WC26-BRIGHTON", eventDate: "2026-06-21" }),
      row({ eventId: "c", eventCode: "WC26-BRIGHTON", eventDate: "2026-06-24" }),
      row({ eventId: "d", eventCode: "WC26-BRIGHTON", eventDate: "2026-06-27" }),
    ]);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "group");
    if (nodes[0].kind !== "group") throw new Error();
    assert.equal(nodes[0].group.key, "series:WC26-BRIGHTON");
    assert.equal(nodes[0].group.eventCode, "WC26-BRIGHTON");
    assert.equal(nodes[0].group.children.length, 4);
  });
});

describe("expanded hash helpers", () => {
  it("parses empty hash to empty set", () => {
    assert.equal(parseExpandedHash("").size, 0);
    assert.equal(parseExpandedHash("#").size, 0);
    assert.equal(parseExpandedHash("#foo=bar").size, 0);
  });

  it("parses expanded=CODE1,CODE2", () => {
    const s = parseExpandedHash("#expanded=WC26-LON,WC26-BRIS");
    assert.equal(s.size, 2);
    assert.ok(s.has("WC26-LON"));
    assert.ok(s.has("WC26-BRIS"));
  });

  it("serializes a Set back into `expanded=…`", () => {
    assert.equal(serializeExpandedHash(new Set()), "");
    assert.equal(
      serializeExpandedHash(new Set(["WC26-LON", "WC26-BRIS"])),
      "expanded=WC26-LON%2CWC26-BRIS",
    );
  });

  it("round-trips codes containing reserved characters", () => {
    const original = new Set(["FOO,BAR", "BAZ/QUX"]);
    const serialized = serializeExpandedHash(original);
    const roundTripped = parseExpandedHash(`#${serialized}`);
    assert.deepEqual(
      Array.from(roundTripped).sort(),
      Array.from(original).sort(),
    );
  });
});
