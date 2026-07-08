import assert from "node:assert/strict";
import { test } from "node:test";

import { initialBackfillState, readBackfillState } from "../backfill.ts";

test("initialBackfillState seeds a pending job", () => {
  const s = initialBackfillState("mailchimp", "2026-07-08T09:00:00Z");
  assert.equal(s.status, "pending");
  assert.equal(s.provider, "mailchimp");
  assert.equal(s.cursor, 0);
  assert.equal(s.processed, 0);
  assert.equal(s.total, null);
  assert.equal(s.started_at, "2026-07-08T09:00:00Z");
});

test("readBackfillState round-trips a persisted state", () => {
  const state = { status: "running", provider: "bird", cursor: 50, processed: 50, total: 200, fired: 40, skipped: 10, started_at: "a", updated_at: "b" };
  const read = readBackfillState({ autoresp_backfill: state });
  assert.deepEqual(read, { ...state, error: undefined });
});

test("readBackfillState returns null for missing / bad status", () => {
  assert.equal(readBackfillState(null), null);
  assert.equal(readBackfillState({}), null);
  assert.equal(readBackfillState({ autoresp_backfill: { status: "weird" } }), null);
});
