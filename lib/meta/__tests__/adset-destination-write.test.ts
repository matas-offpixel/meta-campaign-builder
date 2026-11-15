/**
 * Live ad-set destination backfill.
 *
 * The write itself was verified against real Meta before this module existed
 * (2026-09-30, Graph v21.0). `POST /{adset_id}` with
 * `{ destination_type: "WEBSITE" }` returned `{"success": true}` on a paused ad
 * set going UNDEFINED → WEBSITE, on a running ad set written with its existing
 * value, and on a running ACTIVE ad set going UNDEFINED → WEBSITE
 * (120249993287300453, GBP 0.23 / 40 impressions) — the last of which left
 * `learning_stage_info.last_sig_edit_ts` unchanged. These tests cover the
 * refusals and the ledger, not Meta's acceptance.
 *
 * Run: node --test lib/meta/__tests__/adset-destination-write.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ADSET_DESTINATION_WRITES_DISABLED_MESSAGE } from "../adset-destination-copy.ts";
import {
  AD_SET_WEBSITE_DESTINATION,
  adsetDestinationLedgerTriple,
  adsetDestinationWritesEnabled,
  alreadyWebsiteDestination,
  applyAdSetDestinationChanges,
  formatAdSetDestinationDiff,
  planAdSetDestinationChanges,
  type AdSetDestinationGraph,
  type AdSetDestinationSnapshot,
} from "../adset-destination-write.ts";
import { memoryLedger } from "./helpers/memory-ledger.ts";

const CAMPAIGN_ID = "120249993287240453";

function snapshot(
  adSetId: string,
  destinationType: string,
  overrides: Partial<AdSetDestinationSnapshot> = {},
): AdSetDestinationSnapshot {
  return {
    id: adSetId,
    name: "DHB",
    effectiveStatus: "ACTIVE",
    campaignId: CAMPAIGN_ID,
    destinationType,
    ...overrides,
  };
}

interface GraphStub extends AdSetDestinationGraph {
  writes: Array<{ adSetId: string; destinationType: string }>;
}

function graphOf(
  reads: Record<string, AdSetDestinationSnapshot | null | Error>,
): GraphStub {
  const writes: Array<{ adSetId: string; destinationType: string }> = [];
  return {
    writes,
    read: async (adSetId) => {
      const value = reads[adSetId];
      if (value instanceof Error) throw value;
      return value ?? null;
    },
    write: async (adSetId, destinationType) => {
      writes.push({ adSetId, destinationType });
    },
  };
}

describe("the gate is the same switch as the targeting push", () => {
  it("requires the exact string true", () => {
    assert.equal(
      adsetDestinationWritesEnabled({
        ...process.env,
        OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED: "true",
      }),
      true,
    );
    for (const value of ["1", "TRUE", "yes", "", undefined]) {
      assert.equal(
        adsetDestinationWritesEnabled({
          ...process.env,
          OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED: value,
        }),
        false,
        `"${value}" must not open the gate`,
      );
    }
  });

  it("a disabled gate refuses every ad set and never reads or writes", async () => {
    const graph = graphOf({ "100100": snapshot("100100", "UNDEFINED") });
    const results = await applyAdSetDestinationChanges({
      adSetIds: ["100100", "100200"],
      campaignId: CAMPAIGN_ID,
      graph,
      writesEnabled: false,
      ledger: memoryLedger().context,
    });
    assert.equal(results.length, 2);
    assert.equal(
      results.every((row) => row.outcome === "refused"),
      true,
    );
    assert.equal(results[0].reason, ADSET_DESTINATION_WRITES_DISABLED_MESSAGE);
    assert.deepEqual(graph.writes, []);
  });
});

describe("helpers", () => {
  it("only ever names WEBSITE", () => {
    assert.equal(AD_SET_WEBSITE_DESTINATION, "WEBSITE");
    assert.deepEqual(adsetDestinationLedgerTriple("100100"), {
      adset_id: "100100",
      destination_type: "WEBSITE",
    });
  });

  it("recognises an ad set that already carries the destination", () => {
    for (const value of ["WEBSITE", "website", " WEBSITE "]) {
      assert.equal(alreadyWebsiteDestination(value), true, value);
    }
    for (const value of ["UNDEFINED", "ON_POST", "FACEBOOK_EVENT", ""]) {
      assert.equal(alreadyWebsiteDestination(value), false, value);
    }
  });

  it("writes an operator-readable before and after", () => {
    assert.equal(
      formatAdSetDestinationDiff({ adSetName: "DHB Adv+", before: "UNDEFINED" }),
      "DHB Adv+: UNDEFINED → WEBSITE",
    );
  });
});

describe("plan — dry run", () => {
  it("reports what would change on an UNDEFINED ad set", async () => {
    const results = await planAdSetDestinationChanges({
      adSetIds: ["120249993287300453"],
      campaignId: CAMPAIGN_ID,
      graph: graphOf({
        "120249993287300453": snapshot("120249993287300453", "UNDEFINED"),
      }),
    });
    assert.deepEqual(results, [
      {
        adSetId: "120249993287300453",
        adSetName: "DHB",
        outcome: "ready",
        reason: null,
        diff: "DHB: UNDEFINED → WEBSITE",
        before: "UNDEFINED",
        after: "WEBSITE",
      },
    ]);
  });

  it("treats an absent destination as UNDEFINED", async () => {
    const [row] = await planAdSetDestinationChanges({
      adSetIds: ["100100"],
      campaignId: CAMPAIGN_ID,
      graph: graphOf({ "100100": snapshot("100100", "") }),
    });
    assert.equal(row.before, "UNDEFINED");
    assert.equal(row.outcome, "ready");
  });

  it("an ad set already on WEBSITE is a noop, not a write", async () => {
    const [row] = await planAdSetDestinationChanges({
      adSetIds: ["100100"],
      campaignId: CAMPAIGN_ID,
      graph: graphOf({ "100100": snapshot("100100", "WEBSITE") }),
    });
    assert.equal(row.outcome, "noop");
    assert.equal(row.reason, "Already set to Website");
    assert.equal(row.diff, null);
  });

  it("a dry run performs no write", async () => {
    const graph = graphOf({ "100100": snapshot("100100", "UNDEFINED") });
    await planAdSetDestinationChanges({
      adSetIds: ["100100"],
      campaignId: CAMPAIGN_ID,
      graph,
    });
    assert.deepEqual(graph.writes, []);
  });
});

describe("refusals", () => {
  async function refusalFor(
    adSetId: string,
    reads: Record<string, AdSetDestinationSnapshot | null | Error>,
  ) {
    const graph = graphOf(reads);
    const [row] = await applyAdSetDestinationChanges({
      adSetIds: [adSetId],
      campaignId: CAMPAIGN_ID,
      graph,
      writesEnabled: true,
      ledger: memoryLedger().context,
    });
    return { row, graph };
  }

  it("refuses an id that is not a Meta id", async () => {
    const { row, graph } = await refusalFor("not-an-id", {});
    assert.equal(row.outcome, "refused");
    assert.equal(row.reason, "Ad set id is not a Meta id");
    assert.deepEqual(graph.writes, []);
  });

  it("refuses an archived ad set", async () => {
    const { row, graph } = await refusalFor("100100", {
      "100100": snapshot("100100", "UNDEFINED", { effectiveStatus: "ARCHIVED" }),
    });
    assert.equal(row.outcome, "refused");
    assert.equal(row.reason, "Ad set is ARCHIVED");
    assert.deepEqual(graph.writes, []);
  });

  it("refuses a deleted ad set", async () => {
    const { row } = await refusalFor("100100", {
      "100100": snapshot("100100", "UNDEFINED", { effectiveStatus: "DELETED" }),
    });
    assert.equal(row.outcome, "refused");
    assert.equal(row.reason, "Ad set is DELETED");
  });

  it("refuses a read that failed", async () => {
    const { row, graph } = await refusalFor("100100", {
      "100100": new Error("Graph 500"),
    });
    assert.equal(row.outcome, "refused");
    assert.match(row.reason ?? "", /Could not read this ad set \(Graph 500\)/);
    assert.deepEqual(graph.writes, []);
  });

  it("refuses a read that returned nothing", async () => {
    const { row } = await refusalFor("100100", { "100100": null });
    assert.equal(row.outcome, "refused");
    assert.equal(row.reason, "Could not read this ad set");
  });

  it("refuses a read missing status or campaign", async () => {
    const { row } = await refusalFor("100100", {
      "100100": snapshot("100100", "UNDEFINED", { effectiveStatus: "" }),
    });
    assert.equal(row.outcome, "refused");
    assert.match(row.reason ?? "", /did not include status and campaign/);
  });

  it("refuses an ad set on a different campaign", async () => {
    const { row, graph } = await refusalFor("100100", {
      "100100": snapshot("100100", "UNDEFINED", { campaignId: "999999999999999" }),
    });
    assert.equal(row.outcome, "refused");
    assert.equal(row.reason, "This ad set is not on the published campaign");
    assert.deepEqual(graph.writes, []);
  });

  it("one refusal does not stop the rest", async () => {
    const graph = graphOf({
      "100100": snapshot("100100", "UNDEFINED", { effectiveStatus: "ARCHIVED" }),
      "100200": snapshot("100200", "UNDEFINED", { name: "DHB Adv+" }),
    });
    const results = await applyAdSetDestinationChanges({
      adSetIds: ["100100", "100200"],
      campaignId: CAMPAIGN_ID,
      graph,
      writesEnabled: true,
      ledger: memoryLedger().context,
    });
    assert.equal(results[0].outcome, "refused");
    assert.equal(results[1].outcome, "written");
    assert.deepEqual(graph.writes, [
      { adSetId: "100200", destinationType: "WEBSITE" },
    ]);
  });
});

describe("apply — the write and the ledger", () => {
  it("writes WEBSITE and nothing else", async () => {
    const graph = graphOf({ "100100": snapshot("100100", "UNDEFINED") });
    const [row] = await applyAdSetDestinationChanges({
      adSetIds: ["100100"],
      campaignId: CAMPAIGN_ID,
      graph,
      writesEnabled: true,
      ledger: memoryLedger().context,
    });
    assert.equal(row.outcome, "written");
    assert.equal(row.before, "UNDEFINED");
    assert.equal(row.after, "WEBSITE");
    assert.deepEqual(graph.writes, [
      { adSetId: "100100", destinationType: "WEBSITE" },
    ]);
  });

  it("an ad set already on WEBSITE is never written", async () => {
    const graph = graphOf({ "100100": snapshot("100100", "WEBSITE") });
    const [row] = await applyAdSetDestinationChanges({
      adSetIds: ["100100"],
      campaignId: CAMPAIGN_ID,
      graph,
      writesEnabled: true,
      ledger: memoryLedger().context,
    });
    assert.equal(row.outcome, "noop");
    assert.deepEqual(graph.writes, []);
  });

  it("a second apply is recorded on the ledger and does not re-POST", async () => {
    const db = memoryLedger();
    const graph = graphOf({ "100100": snapshot("100100", "UNDEFINED") });
    const first = await applyAdSetDestinationChanges({
      adSetIds: ["100100"],
      campaignId: CAMPAIGN_ID,
      graph,
      writesEnabled: true,
      ledger: db.context,
    });
    assert.equal(first[0].outcome, "written");
    const second = await applyAdSetDestinationChanges({
      adSetIds: ["100100"],
      campaignId: CAMPAIGN_ID,
      graph,
      writesEnabled: true,
      ledger: db.context,
    });
    assert.equal(second[0].outcome, "noop");
    assert.equal(second[0].reason, "Already recorded on the write ledger");
    assert.equal(graph.writes.length, 1, "Meta must be POSTed exactly once");
  });

  it("refuses rather than POSTing when the ledger cannot record the op", async () => {
    // The migration adding the adset_destination_update op_kind is unapplied
    // until Matas runs it. Until then the insert fails the CHECK and this
    // action must not reach Meta.
    const db = memoryLedger();
    db.lookupError = { code: "42P01", message: 'relation "meta_write_idempotency" does not exist' };
    const graph = graphOf({ "100100": snapshot("100100", "UNDEFINED") });
    const [row] = await applyAdSetDestinationChanges({
      adSetIds: ["100100"],
      campaignId: CAMPAIGN_ID,
      graph,
      writesEnabled: true,
      ledger: db.context,
    });
    assert.equal(row.outcome, "failed");
    assert.match(row.reason ?? "", /ledger/i);
    assert.deepEqual(graph.writes, [], "no Meta POST without a ledger row");
  });
});

describe("the route sends only destination_type", () => {
  const ROUTE = readFileSync("app/api/meta/adset-destination/route.ts", "utf8");

  it("reads exactly the fields the brief names", () => {
    assert.match(ROUTE, /fields:\s*"name,destination_type,effective_status,campaign_id"/);
  });

  it("POSTs destination_type and no other field", () => {
    assert.match(ROUTE, /graphPostWithToken\(`\/\$\{adSetId\}`,\s*\{ destination_type: destinationType \}/);
    assert.doesNotMatch(ROUTE, /targeting:/, "a destination write must not touch targeting");
  });

  it("checks the gate before committing and requires a published draft", () => {
    assert.match(ROUTE, /adsetDestinationWritesEnabled\(\)/);
    assert.match(ROUTE, /status !== "published"/);
    assert.match(ROUTE, /\.eq\("user_id", user\.id\)/);
  });
});
