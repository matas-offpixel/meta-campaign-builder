import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  DELETED_CUSTOM_AUDIENCE_SUBCODE,
  isDeletedCustomAudienceError,
  parseOffendingCustomAudienceIds,
  recoverFromDeletedCa,
  preflightDropUnavailableAudiences,
  shouldRunPreflightAvailabilityCheck,
  REUSED_CA_PREFLIGHT_THRESHOLD,
} from "../ca-availability-recovery.ts";

/**
 * Anchored to the operator-reported East End Dubs Newcastle failure (task
 * #115) — see fixtures/ca_deleted_1359207.json for provenance and caveats
 * (unlike the 1713140 fixture, this is not a byte-for-byte live capture).
 */
const REFUSAL = JSON.parse(
  readFileSync(new URL("./fixtures/ca_deleted_1359207.json", import.meta.url), "utf8"),
) as { error: { message: string; code: number; error_subcode: number } };

const thrownLikeMetaApiError = {
  message: REFUSAL.error.message,
  code: REFUSAL.error.code,
  subcode: REFUSAL.error.error_subcode,
};

describe("fixture provenance", () => {
  it("the reported refusal really is code 100 / subcode 1359207", () => {
    assert.equal(REFUSAL.error.code, 100);
    assert.equal(REFUSAL.error.error_subcode, DELETED_CUSTOM_AUDIENCE_SUBCODE);
  });
});

describe("isDeletedCustomAudienceError", () => {
  it("matches on subcode from a thrown MetaApiError", () => {
    assert.equal(isDeletedCustomAudienceError(thrownLikeMetaApiError), true);
  });

  it("matches on error_subcode from a raw Graph body", () => {
    assert.equal(isDeletedCustomAudienceError(REFUSAL.error), true);
  });

  it("matches on Meta's wording when the transport lost the subcode", () => {
    assert.equal(isDeletedCustomAudienceError(new Error(REFUSAL.error.message)), true);
  });

  it("does not fire on unrelated failures", () => {
    assert.equal(
      isDeletedCustomAudienceError(new Error("(#100) Invalid parameter — interests are deprecated")),
      false,
    );
    assert.equal(
      isDeletedCustomAudienceError({ message: "rate limited", code: 4, subcode: 80004 }),
      false,
    );
    assert.equal(isDeletedCustomAudienceError(null), false);
    assert.equal(isDeletedCustomAudienceError(undefined), false);
  });
});

describe("parseOffendingCustomAudienceIds", () => {
  it("returns nothing for the reported refusal — Meta named no id in this wording", () => {
    assert.deepEqual(parseOffendingCustomAudienceIds(REFUSAL.error), []);
  });

  it("parses an id when a future wording variant does name one", () => {
    assert.deepEqual(
      parseOffendingCustomAudienceIds({
        message: "This ad set is using unavailable custom audiences (ID: 6041400000001).",
      }),
      ["6041400000001"],
    );
  });

  it("parses a multi-id list", () => {
    assert.deepEqual(
      parseOffendingCustomAudienceIds({ message: "unavailable audiences (IDs: 111, 222 333)" }),
      ["111", "222", "333"],
    );
  });
});

describe("recoverFromDeletedCa", () => {
  const A = "6041400000001";
  const BAD = "6041400000002";
  const C = "6041400000003";

  it("passes unrelated errors through as not-recognised", () => {
    const out = recoverFromDeletedCa({
      requestedIds: [A, BAD, C],
      error: new Error("(#4) Application request limit reached"),
    });
    assert.equal(out.recognised, false);
    assert.deepEqual(out.keepIds, [A, BAD, C]);
    assert.deepEqual(out.dropIds, []);
    assert.equal(out.unrecoverable, undefined);
  });

  it("drops the id Meta named verbatim, keeps the rest", () => {
    const out = recoverFromDeletedCa({
      requestedIds: [A, BAD, C],
      error: { code: 100, subcode: DELETED_CUSTOM_AUDIENCE_SUBCODE, message: `unavailable audiences (ID: ${BAD})` },
      names: { [BAD]: "Similar Pages — engagement 40" },
    });
    assert.equal(out.recognised, true);
    assert.deepEqual(out.keepIds, [A, C]);
    assert.deepEqual(out.dropIds, [BAD]);
    assert.match(out.note ?? "", new RegExp(`Similar Pages — engagement 40 \\(${BAD}\\)`));
    assert.equal(out.unrecoverable, undefined);
  });

  it("falls back to the injected availability check when Meta names nothing (East End Dubs shape)", () => {
    const out = recoverFromDeletedCa({
      requestedIds: [A, BAD, C],
      error: thrownLikeMetaApiError,
      availabilityStatuses: [
        { id: A, available: true },
        { id: BAD, available: false },
        { id: C, available: true },
      ],
    });
    assert.equal(out.recognised, true);
    assert.deepEqual(out.keepIds, [A, C]);
    assert.deepEqual(out.dropIds, [BAD]);
    assert.match(out.note ?? "", new RegExp(BAD));
  });

  it("is unrecoverable when Meta names nothing and no availability check was run", () => {
    const out = recoverFromDeletedCa({
      requestedIds: [A, BAD, C],
      error: thrownLikeMetaApiError,
    });
    assert.equal(out.recognised, true);
    assert.deepEqual(out.keepIds, [A, BAD, C]);
    assert.deepEqual(out.dropIds, []);
    assert.match(out.unrecoverable ?? "", /did not name which one/);
  });

  it("is unrecoverable when the availability check finds nothing stale either", () => {
    const out = recoverFromDeletedCa({
      requestedIds: [A, C],
      error: thrownLikeMetaApiError,
      availabilityStatuses: [
        { id: A, available: true },
        { id: C, available: true },
      ],
    });
    assert.equal(out.recognised, true);
    assert.deepEqual(out.dropIds, []);
    assert.match(out.unrecoverable ?? "", /did not name which one/);
  });

  it("is unrecoverable when every requested audience turns out unavailable", () => {
    const out = recoverFromDeletedCa({
      requestedIds: [BAD],
      error: thrownLikeMetaApiError,
      availabilityStatuses: [{ id: BAD, available: false }],
      names: { [BAD]: "Similar Pages — engagement 40" },
    });
    assert.equal(out.recognised, true);
    assert.deepEqual(out.keepIds, []);
    assert.deepEqual(out.dropIds, [BAD]);
    assert.match(out.unrecoverable ?? "", /nothing left to target/);
    assert.match(out.unrecoverable ?? "", /Similar Pages — engagement 40/);
  });

  /**
   * task #122 (FIX 1) — the launch route now overlays a pre-create
   * readiness-wait outcome (`waitForAudienceReady` in `lib/meta/client.ts`)
   * onto `availabilityStatuses` for custom audiences created earlier in the
   * SAME launch run. A fresh audience still `operation_status.code=441`
   * ("populating") after the 30s wait is marked `available: false` there —
   * this pins that `recoverFromDeletedCa` drops it exactly like a genuinely
   * deleted (411/412) audience, and that the caller-supplied name (carrying
   * the "still populating after 30s" context) surfaces in the note. Before
   * this fix, `fetchCustomAudienceAvailability` alone never flagged 441 as
   * unavailable, so this exact shape returned `dropIds=[]` (unrecoverable) —
   * the IPC Newcastle signup v2 reproducer.
   */
  it("drops a still-populating (op=441) fresh audience marked unavailable by the readiness wait", () => {
    const out = recoverFromDeletedCa({
      requestedIds: [A, BAD, C],
      error: thrownLikeMetaApiError,
      availabilityStatuses: [
        { id: A, available: true },
        // Not deleted (no 411/412) — still populating after the bounded wait
        // timed out. The route marks this available:false itself; this
        // module doesn't need to know WHY, only that it's false.
        { id: BAD, available: false },
        { id: C, available: true },
      ],
      names: { [BAD]: "Similar Pages — engagement 40 — dropped: still populating after 30s" },
    });
    assert.equal(out.recognised, true);
    assert.deepEqual(out.keepIds, [A, C]);
    assert.deepEqual(out.dropIds, [BAD]);
    assert.equal(out.unrecoverable, undefined);
    assert.match(out.note ?? "", /still populating after 30s/);
  });

  it("de-duplicates named ids and preserves requested order", () => {
    const out = recoverFromDeletedCa({
      requestedIds: [A, BAD, C],
      error: { code: 100, subcode: DELETED_CUSTOM_AUDIENCE_SUBCODE, message: `(ID: ${BAD}) and (ID: ${BAD})` },
    });
    assert.deepEqual(out.dropIds, [BAD]);
    assert.deepEqual(out.keepIds, [A, C]);
  });
});

/**
 * task #123 — IPC Newcastle Signup v3 (2026-08-07 21:11 UTC, campaign
 * 120251198620030755, trace AV0qQKsugcBE0TibyVrynl2): the "Similar Pages"
 * ad set's first `createMetaAdSet` attempt was rejected with 1359207, the
 * launch route's availability check found 11 unavailable and dropped them,
 * the retry with the remaining 29 was ALSO rejected with 1359207 — a
 * SECOND, different batch of stale ids among the 29 survivors — and the
 * single-pass caller had no second recovery attempt, hard-failing instead
 * of looping.
 *
 * `recoverFromDeletedCa` itself is a stateless, one-shot decision function
 * — the actual loop lives in the CALLER (`launch-campaign/route.ts`'s
 * bounded `for` loop, up to 4 passes), which isn't independently
 * unit-testable under `node --test`'s strip-only mode (same constraint
 * noted for `lib/meta/client.ts` elsewhere in this repo). What IS testable,
 * and is the actual bug surface, is that calling `recoverFromDeletedCa`
 * again with the PREVIOUS pass's `keepIds` as the new `requestedIds`
 * composes correctly across passes — this is exactly what the route's loop
 * does each iteration.
 */
describe("recoverFromDeletedCa — multi-pass composition (task #123)", () => {
  it("composes correctly across sequential passes when Meta reveals stale audiences in batches", () => {
    // parseOffendingCustomAudienceIds only matches numeric "(IDs: ...)"
    // lists (Meta's real custom-audience ids are numeric) — use numeric
    // fixture ids so the "Meta names it directly" path is exercised, same
    // as the real IPC Newcastle Signup v3 error shape.
    const ids = Array.from({ length: 10 }, (_, i) => `604140000${1000 + i}`);

    // Pass 1 — first createMetaAdSet attempt rejected; Meta's refusal
    // resolves (via the route's availability-check overlay, or verbatim
    // naming — either shape recoverFromDeletedCa handles the same way) to
    // the first 5 ids as unavailable.
    const batch1 = ids.slice(0, 5);
    const pass1 = recoverFromDeletedCa({
      requestedIds: ids,
      error: {
        code: 100,
        subcode: DELETED_CUSTOM_AUDIENCE_SUBCODE,
        message: `unavailable audiences (IDs: ${batch1.join(", ")})`,
      },
    });
    assert.equal(pass1.recognised, true);
    assert.equal(pass1.unrecoverable, undefined);
    assert.deepEqual(pass1.dropIds, batch1);
    assert.deepEqual(pass1.keepIds, ids.slice(5));

    // Pass 2 — retried without batch 1's 5 ids, but Meta reveals a SECOND,
    // different batch of 3 stale ids among the 5 survivors.
    const batch2 = pass1.keepIds.slice(0, 3);
    const pass2 = recoverFromDeletedCa({
      requestedIds: pass1.keepIds,
      error: {
        code: 100,
        subcode: DELETED_CUSTOM_AUDIENCE_SUBCODE,
        message: `unavailable audiences (IDs: ${batch2.join(", ")})`,
      },
    });
    assert.equal(pass2.recognised, true);
    assert.equal(pass2.unrecoverable, undefined);
    assert.deepEqual(pass2.dropIds, batch2);
    assert.deepEqual(pass2.keepIds, pass1.keepIds.slice(3));

    // Pass 3 (the caller's third createMetaAdSet attempt, with pass2's
    // keepIds) succeeds — nothing left to salvage. Cumulative dropped set
    // across both passes is the full 8, in the order they were revealed.
    const allDropped = [...pass1.dropIds, ...pass2.dropIds];
    assert.deepEqual(allDropped, [...batch1, ...batch2]);
    assert.equal(allDropped.length, 8);
    assert.deepEqual(pass2.keepIds, ids.slice(8));
  });

  it("reports unrecoverable on a later pass when a batch empties the survivors entirely", () => {
    const [id1, id2] = ["6041400001001", "6041400001002"];
    const pass1 = recoverFromDeletedCa({
      requestedIds: [id1, id2],
      error: { code: 100, subcode: DELETED_CUSTOM_AUDIENCE_SUBCODE, message: `unavailable audiences (ID: ${id1})` },
    });
    assert.deepEqual(pass1.keepIds, [id2]);
    assert.equal(pass1.unrecoverable, undefined);

    const pass2 = recoverFromDeletedCa({
      requestedIds: pass1.keepIds,
      error: { code: 100, subcode: DELETED_CUSTOM_AUDIENCE_SUBCODE, message: `unavailable audiences (ID: ${id2})` },
    });
    assert.equal(pass2.recognised, true);
    assert.deepEqual(pass2.keepIds, []);
    assert.match(pass2.unrecoverable ?? "", /nothing left to target/);
  });
});

describe("preflightDropUnavailableAudiences (task #123)", () => {
  const A = "6041400000001";
  const BAD = "6041400000002";
  const C = "6041400000003";

  it("keeps everything and returns a null note when nothing is flagged unavailable", () => {
    const out = preflightDropUnavailableAudiences({
      requestedIds: [A, BAD, C],
      availabilityStatuses: [
        { id: A, available: true },
        { id: BAD, available: true },
        { id: C, available: true },
      ],
    });
    assert.deepEqual(out.keepIds, [A, BAD, C]);
    assert.deepEqual(out.dropIds, []);
    assert.equal(out.note, null);
  });

  it("drops flagged ids, keeps the rest, preserves requested order", () => {
    const out = preflightDropUnavailableAudiences({
      requestedIds: [A, BAD, C],
      availabilityStatuses: [{ id: BAD, available: false }],
      names: { [BAD]: "Similar Pages — engagement 40" },
    });
    assert.deepEqual(out.keepIds, [A, C]);
    assert.deepEqual(out.dropIds, [BAD]);
    assert.match(out.note ?? "", /Similar Pages — engagement 40 \(/);
    assert.match(out.note ?? "", /before the first create attempt/);
  });

  it("treats an id absent from availabilityStatuses as available — never-checked is not unavailable", () => {
    const out = preflightDropUnavailableAudiences({
      requestedIds: [A, BAD, C],
      // Only BAD was checked (mirrors the route only checking REUSED ids —
      // freshly-created ids are never in this array at all).
      availabilityStatuses: [{ id: BAD, available: false }],
    });
    assert.deepEqual(out.keepIds, [A, C]);
    assert.deepEqual(out.dropIds, [BAD]);
  });

  it("drops every flagged id when more than one is unavailable", () => {
    const out = preflightDropUnavailableAudiences({
      requestedIds: [A, BAD, C],
      availabilityStatuses: [
        { id: A, available: false },
        { id: BAD, available: false },
        { id: C, available: true },
      ],
    });
    assert.deepEqual(out.keepIds, [C]);
    assert.deepEqual(out.dropIds, [A, BAD]);
  });
});

/**
 * task #123 — integration test for the ≥20 threshold: the route only pays
 * for a preflight `fetchCustomAudienceAvailability` GET above this size,
 * and — when it does — `preflightDropUnavailableAudiences` correctly
 * reduces the payload before the first `createMetaAdSet` call. Exercises
 * `shouldRunPreflightAvailabilityCheck` and `preflightDropUnavailableAudiences`
 * together, the same two calls the route makes back to back.
 */
describe("preflight threshold + drop — integration (task #123)", () => {
  it("does not recommend a preflight check just under the threshold", () => {
    const reused = Array.from({ length: REUSED_CA_PREFLIGHT_THRESHOLD - 1 }, (_, i) => `R${i + 1}`);
    assert.equal(shouldRunPreflightAvailabilityCheck(reused), false);
  });

  it("recommends a preflight check exactly at the threshold, and drops what it finds", () => {
    const reused = Array.from({ length: REUSED_CA_PREFLIGHT_THRESHOLD }, (_, i) => `R${i + 1}`);
    assert.equal(shouldRunPreflightAvailabilityCheck(reused), true);

    // Simulates the route: fetchCustomAudienceAvailability comes back
    // flagging 2 of the 20 as unavailable (411/412), the rest available.
    const availabilityStatuses = reused.map((id, i) => ({ id, available: i !== 3 && i !== 17 }));
    const result = preflightDropUnavailableAudiences({ requestedIds: reused, availabilityStatuses });
    assert.deepEqual(result.dropIds, [reused[3], reused[17]]);
    assert.equal(result.keepIds.length, REUSED_CA_PREFLIGHT_THRESHOLD - 2);
    assert.ok(!result.keepIds.includes(reused[3]));
    assert.ok(!result.keepIds.includes(reused[17]));
  });

  it("recommends a preflight check well above the threshold (the Similar Pages shape — 40 engagement audiences)", () => {
    const reused = Array.from({ length: 40 }, (_, i) => `R${i + 1}`);
    assert.equal(shouldRunPreflightAvailabilityCheck(reused), true);
  });
});
