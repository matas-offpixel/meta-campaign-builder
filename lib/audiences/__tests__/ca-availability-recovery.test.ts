import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  DELETED_CUSTOM_AUDIENCE_SUBCODE,
  isDeletedCustomAudienceError,
  parseOffendingCustomAudienceIds,
  recoverFromDeletedCa,
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

  it("de-duplicates named ids and preserves requested order", () => {
    const out = recoverFromDeletedCa({
      requestedIds: [A, BAD, C],
      error: { code: 100, subcode: DELETED_CUSTOM_AUDIENCE_SUBCODE, message: `(ID: ${BAD}) and (ID: ${BAD})` },
    });
    assert.deepEqual(out.dropIds, [BAD]);
    assert.deepEqual(out.keepIds, [A, C]);
  });
});
