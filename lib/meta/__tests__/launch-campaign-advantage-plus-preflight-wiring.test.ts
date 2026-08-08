import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * lib/meta/__tests__/launch-campaign-advantage-plus-preflight-wiring.test.ts
 *
 * task #126 — regression guard for the Advantage+/objective preflight check
 * wired into ALL FOUR ad-set-create call sites in
 * `app/api/meta/launch-campaign/route.ts` (standard Phase 2, standard
 * Phase 2b lookalikes, MC[ci] Phase 2, MC[ci] Phase 2b — the same four sites
 * `mc-phase2-salvage-parity.test.ts` guards for the salvage ladder).
 *
 * Without this check, an ad set with `advantagePlus: true` on an
 * objective/goal Meta doesn't support (e.g. Registration → OUTCOME_LEADS)
 * would still get created via the salvage ladder's 1870196 handler
 * (`lib/audiences/adset-create-with-salvage.ts`) stripping the flag and
 * retrying — succeeding silently with no warning that the ad set no longer
 * matches what the operator configured. This preflight fails fast instead,
 * before any Meta call, with a clear message.
 *
 * Same reasoning as `mc-phase2-salvage-parity.test.ts`: the route handler
 * can't be imported directly under the strip-types test runner (`next/server`
 * doesn't resolve), so this asserts against the route's SOURCE TEXT.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ROUTE = code("app/api/meta/launch-campaign/route.ts");

describe("launch-campaign route: task #126 Advantage+/objective preflight wiring", () => {
  it("imports the compat helpers from lib/meta/advantage-plus-compat", () => {
    assert.match(ROUTE, /isAdvantageAudienceSupportedForObjective/);
    assert.match(ROUTE, /advantageAudienceObjectiveMismatchMessage/);
    assert.match(ROUTE, /from\s*"@\/lib\/meta\/advantage-plus-compat"/);
  });

  it("checks isAdvantageAudienceSupportedForObjective at exactly 4 call sites (standard Phase 2, standard Phase 2b, MC Phase 2, MC Phase 2b)", () => {
    const calls = ROUTE.match(/adSet\.advantagePlus\s*&&\s*!isAdvantageAudienceSupportedForObjective\(/g);
    assert.equal(
      calls?.length,
      4,
      "expected standard Phase 2, standard Phase 2b, MC[ci] Phase 2, and MC[ci] Phase 2b to all preflight-check " +
        "Advantage+/objective compatibility — a missing call site means that path can still silently launch a " +
        "degraded ad set via the salvage ladder's 1870196 handler instead of failing fast with a clear error",
    );
  });

  it("every preflight check happens before the corresponding createMetaAdSet/buildAdSetPayload call, not after", () => {
    const checkIndices = [...ROUTE.matchAll(/adSet\.advantagePlus\s*&&\s*!isAdvantageAudienceSupportedForObjective\(/g)]
      .map((m) => m.index ?? -1);
    assert.equal(checkIndices.length, 4);
    for (const idx of checkIndices) {
      // The next buildAdSetPayload( call after this preflight check should be
      // within a small window — i.e. the check runs immediately, before the
      // payload is even built, not deep inside an unrelated later block.
      const after = ROUTE.slice(idx, idx + 900);
      assert.match(after, /buildAdSetPayload\(/, `expected a buildAdSetPayload( call shortly after preflight check at index ${idx}`);
    }
  });

  it("standard Phase 2 and MC Phase 2 (map+throw sites) throw the { adSet, err } shape other failures use", () => {
    const standardMatch = ROUTE.match(
      /adSet\.advantagePlus && !isAdvantageAudienceSupportedForObjective\(phase2Objective, draft\.settings\.optimisationGoal\)\) \{\s*\n\s*throw \{ adSet, err: new Error\(advantageAudienceObjectiveMismatchMessage\(adSet\.name, phase2Objective\)\) \};/,
    );
    assert.ok(standardMatch, "expected standard Phase 2's preflight to throw { adSet, err } with phase2Objective");

    const mcMatch = ROUTE.match(
      /adSet\.advantagePlus && !isAdvantageAudienceSupportedForObjective\(ciObjective, draft\.settings\.optimisationGoal\)\) \{\s*\n\s*throw \{ adSet, err: new Error\(advantageAudienceObjectiveMismatchMessage\(adSet\.name, ciObjective\)\) \};/,
    );
    assert.ok(mcMatch, "expected MC[ci] Phase 2's preflight to throw { adSet, err } with ciObjective");
  });

  it("the two for-loop sites (Phase 2b, MC Phase 2b) record failure + continue instead of throwing into the salvage catch", () => {
    // These two sites sit in a for-loop whose salvage call lives inside a
    // `catch (err)` a few lines below the initial attempt — throwing here
    // instead of `continue`-ing would route the preflight error INTO
    // createAdSetWithSalvage as `initialError`, wasting the whole ladder on
    // an error none of its classifiers match instead of failing fast.
    const continueSites = ROUTE.match(
      /!isAdvantageAudienceSupportedForObjective\([^)]*\)\)\s*\{[\s\S]{0,200}?advantageAudienceObjectiveMismatchMessage[\s\S]{0,500}?continue;/g,
    );
    assert.equal(continueSites?.length, 2, "expected exactly 2 continue-style preflight sites (Phase 2b + MC Phase 2b)");
  });
});
