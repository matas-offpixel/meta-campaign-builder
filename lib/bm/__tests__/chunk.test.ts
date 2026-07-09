/**
 * lib/bm/__tests__/chunk.test.ts
 *
 * Coverage for the 2026-07-09 scan-timeout fix's chunking helper
 * (`lib/bm/chunk.ts`), used by `scanBusinessManager` (`lib/bm/sync.ts`) to
 * batch `bm_page_access_events` inserts and checkpoint
 * `client_business_managers.last_scanned_at` at a fixed boundary instead of
 * awaiting one insert per detected page — on Columbo Group's ~1060-page BM
 * (527693220707294), 700+ sequential single-row inserts was the actual
 * cause of the 120s timeout the "Sync now" route hit.
 *
 * Note on scope: this tests the PURE chunking logic directly.
 * `scanBusinessManager` itself imports `@/lib/meta/client` (`MetaApiError`'s
 * TypeScript-parameter-property constructor — unsupported by Node's
 * `--experimental-strip-types` test runner) and the `server-only` package,
 * so a full integration test of the checkpointing behavior isn't feasible
 * under this repo's existing test harness — same rationale documented in
 * `business-manager-grant-request.ts` / `business-scoped-user-id.ts`. What
 * IS covered here is the exact invariant that matters for the "partial
 * progress on early exit" guarantee: chunking never drops, duplicates, or
 * reorders items, and every chunk (including a mid-run one, if a timeout
 * hit right after it) is a complete, correctly-sized checkpoint boundary.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chunk } from "../chunk.ts";

describe("chunk", () => {
  it("returns [] for an empty array", () => {
    assert.deepEqual(chunk([], 100), []);
  });

  it("groups into chunks of the requested size, last chunk may be smaller", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `page_${i}`);
    const chunks = chunk(ids, 100);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, 100);
    assert.equal(chunks[1].length, 100);
    assert.equal(chunks[2].length, 50);
  });

  it("preserves order and every item exactly once — no drops, no duplicates (Columbo Group scale: ~1060 pages)", () => {
    const ids = Array.from({ length: 1060 }, (_, i) => `page_${i}`);
    const chunks = chunk(ids, 100);
    const flattened = chunks.flat();
    assert.deepEqual(flattened, ids, "chunking must reconstruct the exact original order");
    assert.equal(new Set(flattened).size, ids.length, "no item may be duplicated across chunks");
  });

  it("returns exactly one chunk when input is smaller than the boundary", () => {
    assert.deepEqual(chunk(["a", "b", "c"], 100), [["a", "b", "c"]]);
  });

  it("returns exactly one full chunk when input length equals the boundary", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `page_${i}`);
    const chunks = chunk(ids, 100);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].length, 100);
  });

  it("throws on a non-positive size instead of looping forever", () => {
    assert.throws(() => chunk([1, 2, 3], 0), RangeError);
    assert.throws(() => chunk([1, 2, 3], -1), RangeError);
  });
});
