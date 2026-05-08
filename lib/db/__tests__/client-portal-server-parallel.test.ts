import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import path from "node:path";

/**
 * PR perf/client-portal-loader-parallelise — guard the Promise.all
 * shape on the internal `loadPortalForClientId` loader.
 *
 * We can't unit-test the loader end-to-end without mocking
 * `createServiceRoleClient`, which `node:test` doesn't natively
 * support. The two assertions below are deliberately complementary:
 *
 *   1. Source-shape guard — reads the loader file and confirms a
 *      `Promise.all([...])` block exists with at least 10 entries
 *      (the original sequential code path was 10 awaits). If a
 *      future edit collapses the parallel fetch back into sequential
 *      awaits, the count drops below the threshold and this test
 *      fails loudly.
 *   2. Behavioural check — runs a synthetic Promise.all of 10
 *      delayed loaders and asserts the wall time is bounded by the
 *      slowest single delay rather than the sum (i.e. the same
 *      shape the loader relies on). This grounds the source check
 *      in actual concurrency semantics.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOADER_PATH = path.resolve(HERE, "../client-portal-server.ts");

describe("loadPortalForClientId — Promise.all source-shape guard", () => {
  it("uses a Promise.all over the per-event/per-client fetches", async () => {
    const src = await readFile(LOADER_PATH, "utf8");
    assert.match(
      src,
      /await Promise\.all\(\[/,
      "loader must call await Promise.all([...])",
    );

    // Count the entries in the first `await Promise.all([...])` block
    // by counting top-level `Promise.resolve(` usages plus the inline
    // admin/helper calls. Easier: count commas at depth 0 inside the
    // bracket pair following the first Promise.all.
    const idx = src.search(/await Promise\.all\(\[/);
    assert.notStrictEqual(idx, -1);
    let depthSquare = 0;
    let depthRound = 0;
    let started = false;
    let topLevelCommas = 0;
    for (let i = idx; i < src.length; i++) {
      const ch = src[i];
      if (!started) {
        if (ch === "[") {
          started = true;
          depthSquare = 1;
        }
        continue;
      }
      if (ch === "[") depthSquare += 1;
      else if (ch === "]") {
        depthSquare -= 1;
        if (depthSquare === 0) break;
      } else if (ch === "(") depthRound += 1;
      else if (ch === ")") depthRound -= 1;
      else if (ch === "," && depthSquare === 1 && depthRound === 0) {
        topLevelCommas += 1;
      }
    }
    // 10 entries → 9 separators, but a trailing comma is allowed →
    // accept ≥ 9. PR ships 11 entries (10 + additionalSpend).
    assert.ok(
      topLevelCommas >= 9,
      `expected ≥9 top-level entries inside Promise.all (got ${topLevelCommas + 1})`,
    );
  });
});

describe("Promise.all wall-time semantics (smoke)", () => {
  it("runs N delayed loaders concurrently — bounded by slowest, not sum", async () => {
    const DELAY_MS = 30;
    const N = 10;
    const loaders = Array.from({ length: N }, (_, i) => {
      return () =>
        new Promise<number>((resolve) =>
          setTimeout(() => resolve(i), DELAY_MS),
        );
    });

    const sequentialBudgetMs = N * DELAY_MS;

    const t0 = Date.now();
    const results = await Promise.all(loaders.map((load) => load()));
    const elapsed = Date.now() - t0;

    assert.equal(results.length, N);
    assert.ok(
      elapsed < sequentialBudgetMs / 2,
      `expected parallel wall time (${elapsed}ms) << sequential budget (${sequentialBudgetMs}ms)`,
    );
  });
});
