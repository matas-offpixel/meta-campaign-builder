import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  LEG_FAILURE_SAMPLE,
  addLegResult,
  emptyLegTallies,
  emptyLegTally,
  legOutcome,
  legRunRecord,
  type LegEventResult,
  type RollupLeg,
} from "../rollup-sync-leg-tally.ts";

function many(n: number, make: (i: number) => LegEventResult): LegEventResult[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

/** The 12 Nov 2026 19:00 UTC run as the TikTok leg saw it: 40 events, no TikTok error. */
const TIKTOK_RUN_12_NOV: LegEventResult[] = [
  ...many(9, (i) => ({ eventCode: `TT-OK-${i}`, ok: true, rows: i === 0 ? 3 : 0 })),
  ...many(22, (i) => ({ eventCode: `NX26-${i}`, ok: false, reason: "no_rows", error: "No TikTok campaigns matched this event_code in the sync window." })),
  ...many(8, (i) => ({ eventCode: `DHB26-${i}`, ok: false, reason: "no_tiktok_account" })),
  { eventCode: null, ok: false, reason: "no_event_code", error: "Event has no event_code — set one to track TikTok spend." },
];

describe("legOutcome", () => {
  it("ok is ok, a leg-specific nothing-to-do reason is skipped, anything else is failed", () => {
    assert.equal(legOutcome("tiktok", { ok: true }), "ok");
    assert.equal(legOutcome("tiktok", { ok: false, reason: "no_tiktok_account" }), "skipped");
    assert.equal(legOutcome("tiktok", { ok: false, reason: "no_rows" }), "skipped");
    assert.equal(legOutcome("tiktok", { ok: false, reason: "no_event_code" }), "skipped");
    assert.equal(legOutcome("tiktok", { ok: false, reason: "tiktok_failed" }), "failed");
    assert.equal(legOutcome("tiktok", { ok: false, reason: "no_credentials" }), "failed");
    assert.equal(legOutcome("tiktok", { ok: false, reason: "no_advertiser_id" }), "failed");
    assert.equal(legOutcome("tickets", { ok: false, reason: "not_linked" }), "skipped");
    assert.equal(legOutcome("google", { ok: false, reason: "no_google_ads_account" }), "skipped");
    assert.equal(legOutcome("google", { ok: false, reason: "no_customer_id" }), "failed");
    assert.equal(legOutcome("google", { ok: false, reason: "google_ads_failed" }), "failed");
    assert.equal(legOutcome("meta", { ok: false, reason: "no_ad_account" }), "skipped");
    assert.equal(legOutcome("meta", { ok: false, reason: "meta_api_error" }), "failed");
  });

  it("a skip reason belongs to its own leg only", () => {
    assert.equal(legOutcome("meta", { ok: false, reason: "no_tiktok_account" }), "failed");
    assert.equal(legOutcome("tiktok", { ok: false, reason: "not_linked" }), "failed");
  });

  it("an event whose whole sync threw has no reason and is a failure on every leg", () => {
    for (const leg of ["meta", "tickets", "tiktok", "google"] as RollupLeg[]) {
      assert.equal(legOutcome(leg, { ok: false }), "failed");
      assert.equal(legOutcome(leg, { ok: false, reason: null }), "failed");
      assert.equal(legOutcome(leg, { ok: false, reason: "  " }), "failed");
    }
  });
});

describe("rollup-sync leg tallies", () => {
  it("the 12 Nov TikTok run is an ok leg with 31 skips, not 31 failures", () => {
    const tally = emptyLegTally();
    for (const result of TIKTOK_RUN_12_NOV) addLegResult(tally, "tiktok", result);
    assert.equal(tally.considered, 40);
    assert.equal(tally.ok, 9);
    assert.equal(tally.applicable, 9);
    assert.equal(tally.failed, 0);
    assert.equal(tally.rows, 3);
    assert.deepEqual(tally.skipped, { no_rows: 22, no_tiktok_account: 8, no_event_code: 1 });
    assert.deepEqual(tally.failures, []);

    const record = legRunRecord(tally);
    assert.equal(record.ok, true);
    assert.equal(record.error, null);
    assert.equal(record.rowsWritten, 3);
    assert.equal(record.rowsConsidered, 40);
    assert.equal(record.detail.failedEvents, 0);
    assert.equal(record.detail.okEvents, 9);
    assert.equal(record.detail.applicableEvents, 9);
    assert.deepEqual(record.detail.skipped, { no_rows: 22, no_tiktok_account: 8, no_event_code: 1 });
  });

  it("a real TikTok error is a failure with the event, the reason and the message on the run", () => {
    const tally = emptyLegTally();
    for (const result of TIKTOK_RUN_12_NOV) addLegResult(tally, "tiktok", result);
    addLegResult(tally, "tiktok", { eventCode: "P26-BDAY", ok: false, reason: "tiktok_failed", error: "TikTok API 40105: access token expired" });
    addLegResult(tally, "tiktok", { eventCode: "IRW0004", ok: false, reason: "no_credentials", error: "TikTok credentials are missing or could not be decrypted." });
    assert.equal(tally.failed, 2);
    assert.equal(tally.applicable, 11);
    const record = legRunRecord(tally);
    assert.equal(record.ok, false);
    assert.equal(record.error, "2 event(s) failed this leg");
    assert.deepEqual(record.detail.failures, [
      { eventCode: "P26-BDAY", reason: "tiktok_failed", error: "TikTok API 40105: access token expired" },
      { eventCode: "IRW0004", reason: "no_credentials", error: "TikTok credentials are missing or could not be decrypted." },
    ]);
  });

  it("every event unlinked is an ok tickets leg that wrote nothing", () => {
    const tally = emptyLegTally();
    for (let i = 0; i < 40; i += 1) {
      addLegResult(tally, "tickets", { eventCode: `E${i}`, ok: false, reason: "not_linked", error: "No ticketing link — pick the Eventbrite event in the panel above first." });
    }
    const record = legRunRecord(tally);
    assert.equal(record.ok, true);
    assert.equal(record.rowsWritten, 0);
    assert.equal(record.rowsConsidered, 40);
    assert.deepEqual(record.detail.skipped, { not_linked: 40 });
    assert.equal(record.detail.applicableEvents, 0);
  });

  it("a thrown event fails all four legs and keeps the message", () => {
    const tallies = emptyLegTallies();
    const message = "Failed to read TikTok account: connection reset";
    for (const leg of ["meta", "tickets", "tiktok", "google"] as RollupLeg[]) {
      addLegResult(tallies[leg], leg, { eventCode: "NX26-MF", ok: false, error: message });
      assert.equal(tallies[leg].failed, 1);
      assert.deepEqual(tallies[leg].failures, [{ eventCode: "NX26-MF", reason: null, error: message }]);
    }
  });

  it("extra detail is kept beside the tallies, and the failure sample is capped", () => {
    const tally = emptyLegTally();
    for (let i = 0; i < LEG_FAILURE_SAMPLE + 10; i += 1) {
      addLegResult(tally, "meta", { eventCode: `E${i}`, ok: false, reason: "meta_api_error", error: `rate limited ${i}` });
    }
    const evidence = [{ eventCode: "E0", claimedCampaignIds: 1, metaRows: 0 }];
    const record = legRunRecord(tally, { events: evidence });
    assert.equal(record.detail.failedEvents, LEG_FAILURE_SAMPLE + 10);
    assert.equal((record.detail.failures as unknown[]).length, LEG_FAILURE_SAMPLE);
    assert.deepEqual(record.detail.events, evidence);
    assert.equal(record.error, `${LEG_FAILURE_SAMPLE + 10} event(s) failed this leg`);
  });
});
