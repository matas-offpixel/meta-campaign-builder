import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildPlacementConfigTargeting } from "../placement-config.ts";
import type { PlacementConfig } from "../../types.ts";

/**
 * Follow-up to task #117 / PR #751 — corrects the seed the Step 5
 * "Placements" section uses the moment an operator flips the toggle from
 * Advantage+ to Manual.
 *
 * PR #751 shipped `FB Feed + IG Feed only` as that seed. Wrong per operator
 * ask (2026-08-07): FB Reels/Story/Marketplace underperform for electronic
 * music campaigns, while IG's Reels/Story/Explore are strong placements
 * that shouldn't be excluded by default. Corrected shape:
 *   - Facebook: Feed ONLY
 *   - Instagram: ALL placements (stream, story, explore, reels, ig_search,
 *     explore_home)
 *   - Audience Network / Messenger: still OFF (operator opts in explicitly)
 *   - Device: both mobile + desktop (unchanged — Meta's default when the
 *     field is omitted)
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const BUDGET_SCHEDULE = code("components/steps/budget-schedule.tsx");

describe("Step 5 Placements: MANUAL_PLACEMENT_DEFAULTS seed (post-#751 correction)", () => {
  it("source: the manual-mode default seeds FB Feed only + ALL Instagram positions", () => {
    const match = BUDGET_SCHEDULE.match(
      /const MANUAL_PLACEMENT_DEFAULTS: PlacementConfig = \{([\s\S]*?)\n\};/,
    );
    assert.ok(match, "expected to find the MANUAL_PLACEMENT_DEFAULTS constant in budget-schedule.tsx");
    const body = match![1];

    assert.match(body, /mode:\s*"manual"/);
    assert.match(body, /publisherPlatforms:\s*\["facebook",\s*"instagram"\]/);
    assert.match(body, /facebookPositions:\s*\["feed"\]/);
    assert.match(
      body,
      /instagramPositions:\s*\["stream",\s*"story",\s*"explore",\s*"reels",\s*"ig_search",\s*"explore_home"\]/,
    );

    // Audience Network / Messenger must stay opt-in: no audienceNetworkPositions
    // key, and "audience_network" / "messenger" absent from publisherPlatforms.
    assert.doesNotMatch(body, /audienceNetworkPositions/);
    assert.doesNotMatch(body, /audience_network/);
    assert.doesNotMatch(body, /messenger/);
  });

  it("behavioural: the corrected default produces the exact Meta targeting shape from the task spec", () => {
    const manualDefault: PlacementConfig = {
      mode: "manual",
      publisherPlatforms: ["facebook", "instagram"],
      facebookPositions: ["feed"],
      instagramPositions: ["stream", "story", "explore", "reels", "ig_search", "explore_home"],
    };

    const targeting = buildPlacementConfigTargeting(manualDefault);
    assert.ok(targeting);
    assert.deepEqual(targeting!.publisher_platforms, ["facebook", "instagram"]);
    assert.deepEqual(targeting!.facebook_positions, ["feed"]);
    assert.deepEqual(targeting!.instagram_positions, [
      "stream",
      "story",
      "explore",
      "reels",
      "ig_search",
      "explore_home",
    ]);
    assert.equal(targeting!.audience_network_positions, undefined);
    // devicePlatforms is left unset in the seed on purpose — Meta already
    // treats an absent device_platforms field as "both".
    assert.equal(targeting!.device_platforms, undefined);
  });

  it("REGRESSION: the old (pre-correction) FB-Feed + IG-Feed-only default is no longer what's seeded", () => {
    const match = BUDGET_SCHEDULE.match(
      /const MANUAL_PLACEMENT_DEFAULTS: PlacementConfig = \{([\s\S]*?)\n\};/,
    );
    const body = match![1];
    const igArrayMatch = body.match(/instagramPositions:\s*\[([^\]]*)\]/);
    assert.ok(igArrayMatch, "expected an instagramPositions array in the default seed");
    const igCount = igArrayMatch![1].split(",").filter((s) => s.trim().length > 0).length;
    assert.ok(
      igCount > 1,
      `instagramPositions must no longer be limited to a single position (Feed/Stream only) — found ${igCount}`,
    );
  });
});
