/**
 * Unit tests for lib/meta/placement-config.ts (task #117 — wizard-wide
 * placement targeting).
 *
 * Reproducer: East End Dubs Newcastle signup launch (2026-08-07) shipped 42
 * ads to every Meta placement (Audience Network, Marketplace, Search, …)
 * because nothing set `publisher_platforms` for a normal ad set, so Meta
 * defaulted to automatic Advantage+ Placements.
 *
 * Run: node --test lib/meta/__tests__/placement-config.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_PLACEMENT_CONFIG,
  resolveEffectivePlacementConfig,
  buildPlacementConfigTargeting,
  summarisePlacementConfig,
  validatePlacementConfig,
} from "../placement-config.ts";
import type { PlacementConfig } from "../../types.ts";

// ─── resolveEffectivePlacementConfig ──────────────────────────────────────

describe("resolveEffectivePlacementConfig", () => {
  it("returns the automatic default when neither campaign-wide nor per-ad-set config is set", () => {
    const result = resolveEffectivePlacementConfig(undefined, undefined);
    assert.deepEqual(result, DEFAULT_PLACEMENT_CONFIG);
    assert.equal(result.mode, "advantage_plus");
  });

  it("uses the campaign-wide config when no per-ad-set override is set", () => {
    const campaignWide: PlacementConfig = { mode: "manual", publisherPlatforms: ["facebook"] };
    const result = resolveEffectivePlacementConfig(campaignWide, undefined);
    assert.deepEqual(result, campaignWide);
  });

  it("per-ad-set override takes precedence over the campaign-wide config", () => {
    const campaignWide: PlacementConfig = { mode: "manual", publisherPlatforms: ["facebook"] };
    const perAdSet: PlacementConfig = { mode: "manual", publisherPlatforms: ["instagram"] };
    const result = resolveEffectivePlacementConfig(campaignWide, perAdSet);
    assert.deepEqual(result, perAdSet);
  });
});

// ─── buildPlacementConfigTargeting ─────────────────────────────────────────

describe("buildPlacementConfigTargeting", () => {
  it("returns null (omit all fields) for advantage_plus mode — Meta's automatic default", () => {
    assert.equal(buildPlacementConfigTargeting({ mode: "advantage_plus" }), null);
  });

  it("returns null when config is absent entirely (regression proof — matches pre-existing behavior)", () => {
    assert.equal(buildPlacementConfigTargeting(undefined), null);
  });

  it("returns null for manual mode with zero platforms selected — falls back to automatic", () => {
    assert.equal(buildPlacementConfigTargeting({ mode: "manual", publisherPlatforms: [] }), null);
    assert.equal(buildPlacementConfigTargeting({ mode: "manual" }), null);
  });

  it("sends FB Feed + IG Feed only — the East End Dubs operator-intended shape", () => {
    const result = buildPlacementConfigTargeting({
      mode: "manual",
      publisherPlatforms: ["facebook", "instagram"],
      facebookPositions: ["feed"],
      instagramPositions: ["stream"],
    });
    assert.deepEqual(result, {
      publisher_platforms: ["facebook", "instagram"],
      facebook_positions: ["feed"],
      instagram_positions: ["stream"],
    });
  });

  it("omits facebook_positions/instagram_positions when that platform isn't selected, even if positions are set", () => {
    const result = buildPlacementConfigTargeting({
      mode: "manual",
      publisherPlatforms: ["facebook"],
      facebookPositions: ["feed"],
      instagramPositions: ["stream"], // stale — instagram not in publisherPlatforms
    });
    assert.deepEqual(result, {
      publisher_platforms: ["facebook"],
      facebook_positions: ["feed"],
    });
    assert.ok(!("instagram_positions" in (result ?? {})));
  });

  it("includes audience_network_positions only when audience_network is selected", () => {
    const result = buildPlacementConfigTargeting({
      mode: "manual",
      publisherPlatforms: ["audience_network"],
      audienceNetworkPositions: ["classic"],
    });
    assert.deepEqual(result, {
      publisher_platforms: ["audience_network"],
      audience_network_positions: ["classic"],
    });
  });

  it("includes device_platforms when set, e.g. mobile-only", () => {
    const result = buildPlacementConfigTargeting({
      mode: "manual",
      publisherPlatforms: ["facebook"],
      devicePlatforms: ["mobile"],
    });
    assert.deepEqual(result?.device_platforms, ["mobile"]);
  });

  it("omits device_platforms when absent (Meta serves both by default)", () => {
    const result = buildPlacementConfigTargeting({
      mode: "manual",
      publisherPlatforms: ["facebook"],
    });
    assert.ok(!("device_platforms" in (result ?? {})));
  });

  it("does not mutate the input config (returns fresh arrays)", () => {
    const config: PlacementConfig = {
      mode: "manual",
      publisherPlatforms: ["facebook"],
      facebookPositions: ["feed"],
    };
    const result = buildPlacementConfigTargeting(config);
    result!.publisher_platforms.push("instagram");
    assert.deepEqual(config.publisherPlatforms, ["facebook"], "original config must be untouched");
  });
});

// ─── summarisePlacementConfig ──────────────────────────────────────────────

describe("summarisePlacementConfig", () => {
  it("describes advantage_plus / absent as automatic", () => {
    assert.equal(summarisePlacementConfig(undefined), "Advantage+ Placements (automatic)");
    assert.equal(summarisePlacementConfig({ mode: "advantage_plus" }), "Advantage+ Placements (automatic)");
  });

  it("describes manual placements by platform", () => {
    const summary = summarisePlacementConfig({
      mode: "manual",
      publisherPlatforms: ["facebook", "instagram"],
    });
    assert.equal(summary, "Facebook + Instagram");
  });

  it("flags manual mode with nothing selected", () => {
    assert.equal(
      summarisePlacementConfig({ mode: "manual", publisherPlatforms: [] }),
      "Manual — no placements selected (falls back to automatic)",
    );
  });
});

// ─── validatePlacementConfig ────────────────────────────────────────────────

describe("validatePlacementConfig", () => {
  it("advantage_plus / absent is always valid", () => {
    assert.equal(validatePlacementConfig(undefined).valid, true);
    assert.equal(validatePlacementConfig({ mode: "advantage_plus" }).valid, true);
  });

  it("manual mode with no platforms selected is invalid", () => {
    const result = validatePlacementConfig({ mode: "manual", publisherPlatforms: [] });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes("no platform is enabled"));
  });

  it("manual mode with audience_network selected produces a soft warning, still valid", () => {
    const result = validatePlacementConfig({
      mode: "manual",
      publisherPlatforms: ["audience_network"],
    });
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some((w) => w.includes("Audience Network")));
  });
});
