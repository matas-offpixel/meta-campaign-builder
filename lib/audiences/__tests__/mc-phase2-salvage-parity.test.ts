import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * lib/audiences/__tests__/mc-phase2-salvage-parity.test.ts
 *
 * task #125 — regression guard for wiring `lib/audiences/adset-create-with-salvage.ts`
 * into ALL FOUR ad-set-create call sites in `app/api/meta/launch-campaign/route.ts`:
 * standard Phase 2, standard Phase 2b (lookalikes), MC[ci] Phase 2, and MC[ci]
 * Phase 2b — the multi-campaign bulk-attach path that "Confirm & Launch" from
 * the Asset Queue actually runs.
 *
 * Same grep-style pattern PR #758 used for
 * `launch-campaign-recovery-wiring.test.ts`'s `createEngagementAudienceWithRecovery`
 * call-site guard: the route handler itself can't be imported here
 * (`next/server`/`next/headers` don't resolve under the strip-types test
 * runner), so this asserts against the route's SOURCE TEXT that the shared
 * salvage ladder — not a re-implemented copy — is what every call site runs.
 * This is exactly the drift task #125 exists to close: MC Phase 2/2b
 * previously had zero, or only a subset, of the salvage tiers standard
 * Phase 2 had already accumulated across PRs #750/#756/#757/#758.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ROUTE = code("app/api/meta/launch-campaign/route.ts");

describe("launch-campaign route: task #125 MC Phase 2/2b salvage parity", () => {
  it("imports the shared salvage helpers from lib/audiences/adset-create-with-salvage", () => {
    assert.match(ROUTE, /import\s*\{\s*\n\s*prepareAdSetPayloadForCreate,\s*\n\s*createAdSetWithSalvage,/);
    assert.match(ROUTE, /from\s*"@\/lib\/audiences\/adset-create-with-salvage"/);
  });

  it("calls prepareAdSetPayloadForCreate at exactly 4 call sites (standard Phase 2, standard Phase 2b, MC Phase 2, MC Phase 2b)", () => {
    const calls = ROUTE.match(/await prepareAdSetPayloadForCreate\(/g);
    assert.equal(
      calls?.length,
      4,
      "expected standard Phase 2, standard Phase 2b, MC[ci] Phase 2, and MC[ci] Phase 2b to all call " +
        "the shared pre-create step (readiness-wait + preflight availability check + hard budget guard) " +
        "— a missing call site means that path can still hard-fail on a Similar Pages / Wide / Blank ad set",
    );
  });

  it("calls createAdSetWithSalvage at exactly 4 call sites (standard Phase 2, standard Phase 2b, MC Phase 2, MC Phase 2b)", () => {
    const calls = ROUTE.match(/await createAdSetWithSalvage\(/g);
    assert.equal(
      calls?.length,
      4,
      "expected standard Phase 2, standard Phase 2b, MC[ci] Phase 2, and MC[ci] Phase 2b to all call " +
        "the shared salvage ladder (1359207 loop + 'meta lies' recreate fallback, 1870196, 1870227, " +
        "fallthrough diagnostic) — a missing call site means that path re-implements (and will drift " +
        "from) the standard Phase 2 logic, which is exactly what caused task #125",
    );
  });

  it("the MC[ci] loop's log prefixes are distinct from standard Phase 2's, per ad-set-create call site", () => {
    assert.match(ROUTE, /logPrefix:\s*"Phase 2"/);
    assert.match(ROUTE, /logPrefix:\s*"Phase 2b"/);
    assert.match(ROUTE, /logPrefix:\s*`MC\[\$\{ci\}\] Phase 2`/);
    assert.match(ROUTE, /logPrefix:\s*`MC\[\$\{ci\}\] Phase 2b`/);
  });

  it("MC[ci]'s freshlyCreatedEngagementAudienceIds is a per-campaign clone, not the shared base set", () => {
    assert.match(ROUTE, /const ciFreshlyCreatedEngagementAudienceIds = new Set\(freshlyCreatedEngagementAudienceIds\)/);
    // Both MC call sites pass the per-campaign clone into prepareAdSetPayloadForCreate,
    // not the outer freshlyCreatedEngagementAudienceIds directly — recreated audiences
    // from campaign ci must not be treated as "fresh" by campaign ci+1's ad sets.
    const mcLoopStart = ROUTE.indexOf("for (let ci = 1; ci < verifiedCampaigns.length; ci++)");
    assert.ok(mcLoopStart > -1, "expected to find the MC[ci] loop");
    const mcLoop = ROUTE.slice(mcLoopStart);
    const cloneUsages = mcLoop.match(/freshlyCreatedEngagementAudienceIds:\s*ciFreshlyCreatedEngagementAudienceIds/g);
    assert.equal(
      cloneUsages?.length,
      2,
      "expected both MC[ci] Phase 2 and MC[ci] Phase 2b to pass the per-campaign clone",
    );
  });

  it("no ad-set-create call site re-implements a raw isDeletedCustomAudienceError/isInvalidTargetingAutomationError check outside the shared module", () => {
    // These classifiers now live ONLY inside adset-create-with-salvage.ts —
    // route.ts must not import or call them directly, or a future edit could
    // silently reintroduce a parallel (and drifting) copy of the ladder.
    assert.doesNotMatch(ROUTE, /isDeletedCustomAudienceError/);
    assert.doesNotMatch(ROUTE, /isInvalidTargetingAutomationError/);
    assert.doesNotMatch(ROUTE, /isMissingAdvantageAudienceFlagError/);
    assert.doesNotMatch(ROUTE, /recoverFromDeletedCa/);
  });

  it("the shared salvageDeps object is built once and reused by every call site", () => {
    assert.match(ROUTE, /const salvageDeps: CreateAdSetWithSalvageDeps = \{/);
    const salvageDepsUsages = ROUTE.match(/,\s*\n?\s*salvageDeps,?\s*\n?\s*\)/g) ?? [];
    assert.ok(
      salvageDepsUsages.length >= 4,
      "expected salvageDeps to be passed as the deps argument at every createAdSetWithSalvage/" +
        "prepareAdSetPayloadForCreate call site",
    );
  });
});
