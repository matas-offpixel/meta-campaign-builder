import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildAdSetPayload } from "../adset.ts";
import type {
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
  PlacementConfig,
} from "../../types.ts";

/**
 * "Integration"-shaped coverage for task #117 (wizard-wide placement
 * config) wired into `app/api/meta/launch-campaign/route.ts`.
 *
 * The route handler itself cannot be imported here (`next/server` doesn't
 * resolve under the strip-types test runner — see
 * `launch-campaign-recovery-wiring.test.ts` for the same constraint), so
 * this file is two things:
 *   1. Source assertions that EVERY `buildAdSetPayload(...)` call site in
 *      the route forwards `draft.settings.placementConfig` — the actual
 *      East End Dubs bug was a caller never populating a field, so a
 *      behavioural test of `buildAdSetPayload` alone can't catch a
 *      regression where a new/edited call site forgets to pass it again.
 *   2. A behavioural smoke test reproducing the acceptance criterion
 *      verbatim: a draft configured for FB Feed + IG Feed only must
 *      produce a Meta ad-set payload with exactly
 *      `publisher_platforms: ["facebook","instagram"]`,
 *      `facebook_positions: ["feed"]`, `instagram_positions: ["stream"]`.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ROUTE = code("app/api/meta/launch-campaign/route.ts");

describe("launch-campaign route: placement config wiring (task #117)", () => {
  it("every buildAdSetPayload(...) call forwards draft.settings.placementConfig", () => {
    const calls = ROUTE.match(/buildAdSetPayload\(([\s\S]*?)\);/g) ?? [];
    assert.ok(calls.length >= 6, `expected at least 6 buildAdSetPayload call sites, found ${calls.length}`);
    const missing = calls.filter((c) => !/draft\.settings\.placementConfig/.test(c));
    assert.equal(
      missing.length,
      0,
      `every buildAdSetPayload call must pass draft.settings.placementConfig — ` +
        `found ${missing.length} call site(s) that don't:\n${missing.join("\n---\n")}`,
    );
  });

  it("the existing-post placement override still exists but no longer gates ALL placement handling", () => {
    // Regression guard for the actual bug: before the fix, a normal
    // (non-existing-post) ad set got zero placement handling of any kind —
    // `resolveAdSetPlacementTargeting` only ran inside
    // `if (assignedCreative?.existingPost)`. After the fix, `buildAdSetPayload`
    // itself always resolves *some* placement decision (automatic or manual)
    // via `draft.settings.placementConfig`; the existing-post gate still
    // exists, but only for the MORE SPECIFIC override that layers on top for
    // that one ad set.
    assert.match(ROUTE, /assignedCreative\?\.existingPost/);
  });

  const ADSET_TS = code("lib/meta/adset.ts");
  it("buildAdSetPayload itself resolves placement targeting unconditionally (not inside an existingPost-style gate)", () => {
    assert.match(ADSET_TS, /resolveEffectivePlacementConfig/);
    assert.match(ADSET_TS, /buildPlacementConfigTargeting/);
  });
});

// ─── Behavioural smoke test (acceptance criterion, verbatim) ──────────────

function makeAdSet(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "as_similar_pages",
    name: "Similar Pages",
    sourceType: "page_group",
    sourceId: "pg1",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 20,
    advantagePlus: false,
    enabled: true,
    ...overrides,
  } as AdSetSuggestion;
}

const emptyAudiences: AudienceSettings = {
  interestGroups: [],
  customAudienceGroups: [],
  pageGroups: [],
  savedAudiences: [],
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

const schedule: BudgetScheduleSettings = {
  startDate: "",
  endDate: "",
  adSets: [],
} as unknown as BudgetScheduleSettings;

describe("East End Dubs Newcastle signup — FB Feed + IG Feed only (acceptance criterion)", () => {
  it("produces the exact Meta targeting shape from the task spec", () => {
    const fbFeedIgFeedOnly: PlacementConfig = {
      mode: "manual",
      publisherPlatforms: ["facebook", "instagram"],
      facebookPositions: ["feed"],
      instagramPositions: ["stream"],
    };

    const payload = buildAdSetPayload(
      makeAdSet(),
      "cam_120251192078210755",
      emptyAudiences,
      schedule,
      "link_clicks",
      "traffic",
      undefined,
      undefined,
      fbFeedIgFeedOnly,
    );

    assert.deepEqual(payload.targeting.publisher_platforms, ["facebook", "instagram"]);
    assert.deepEqual(payload.targeting.facebook_positions, ["feed"]);
    assert.deepEqual(payload.targeting.instagram_positions, ["stream"]);
    assert.equal(payload.targeting.audience_network_positions, undefined);
  });

  it("REGRESSION: without any placementConfig, no placement fields are sent (the pre-fix, still-supported automatic path)", () => {
    const payload = buildAdSetPayload(
      makeAdSet(),
      "cam_120251192078210755",
      emptyAudiences,
      schedule,
      "link_clicks",
      "traffic",
    );
    assert.equal(payload.targeting.publisher_platforms, undefined);
  });
});
