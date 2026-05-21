import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  parseGeoTargetsColumn,
  serializeGeoTargetsColumn,
} from "../geo-targets-codec.ts";

describe("parseGeoTargetsColumn", () => {
  it("decodes the legacy array shape as PRESENCE (default)", () => {
    const decoded = parseGeoTargetsColumn([
      { location: "London", bid_modifier_pct: 20 },
      { location: "Manchester" },
    ]);
    assert.equal(decoded.geo_target_type, "PRESENCE");
    assert.deepEqual(decoded.targets, [
      { location: "London", bid_modifier_pct: 20 },
      { location: "Manchester", bid_modifier_pct: null },
    ]);
  });

  it("decodes the Phase-5 wrapping object shape", () => {
    const decoded = parseGeoTargetsColumn({
      targets: [{ location: "London", bid_modifier_pct: 15 }],
      geo_target_type: "PRESENCE_OR_INTEREST",
    });
    assert.equal(decoded.geo_target_type, "PRESENCE_OR_INTEREST");
    assert.deepEqual(decoded.targets, [{ location: "London", bid_modifier_pct: 15 }]);
  });

  it("defaults to PRESENCE when geo_target_type is missing / unrecognised", () => {
    const a = parseGeoTargetsColumn({ targets: [], geo_target_type: "WHATEVER" });
    assert.equal(a.geo_target_type, "PRESENCE");
    const b = parseGeoTargetsColumn({ targets: [] });
    assert.equal(b.geo_target_type, "PRESENCE");
  });

  it("returns defaults for null / garbage", () => {
    assert.deepEqual(parseGeoTargetsColumn(null), {
      targets: [],
      geo_target_type: "PRESENCE",
    });
    assert.deepEqual(parseGeoTargetsColumn("not-jsonb-i-promise"), {
      targets: [],
      geo_target_type: "PRESENCE",
    });
  });

  it("skips targets with no `location` field", () => {
    const decoded = parseGeoTargetsColumn([
      { bid_modifier_pct: 20 },
      { location: "London", bid_modifier_pct: 10 },
      "garbage",
      null,
    ]);
    assert.deepEqual(decoded.targets, [{ location: "London", bid_modifier_pct: 10 }]);
  });
});

describe("serializeGeoTargetsColumn", () => {
  it("always emits the Phase-5 wrapping object", () => {
    const wire = serializeGeoTargetsColumn({
      targets: [{ location: "London", bid_modifier_pct: 20 }],
      geo_target_type: "PRESENCE_OR_INTEREST",
    });
    assert.deepEqual(wire, {
      targets: [{ location: "London", bid_modifier_pct: 20 }],
      geo_target_type: "PRESENCE_OR_INTEREST",
    });
  });

  it("round-trips with parseGeoTargetsColumn", () => {
    const original = {
      targets: [
        { location: "London, England, United Kingdom", bid_modifier_pct: 20 },
        { location: "South East England", bid_modifier_pct: -10 },
      ],
      geo_target_type: "PRESENCE_OR_INTEREST" as const,
    };
    const wire = serializeGeoTargetsColumn(original);
    const decoded = parseGeoTargetsColumn(wire);
    assert.deepEqual(decoded, original);
  });

  it("re-serialising a legacy-decoded value upgrades it to the wrapping object", () => {
    const legacyWire = [{ location: "London", bid_modifier_pct: 20 }];
    const decoded = parseGeoTargetsColumn(legacyWire);
    const upgraded = serializeGeoTargetsColumn(decoded);
    assert.ok(
      !Array.isArray(upgraded),
      "re-serialised legacy rows must be the wrapping object form",
    );
    assert.equal(upgraded.geo_target_type, "PRESENCE");
  });

  // ── Totality (hotfix regression tests) ────────────────────────────
  // These cover the root-cause scenario: a stale client-side tree
  // sent via PUT with geo_target_type or geo_targets missing at
  // runtime (TypeScript type says non-null but JSON body can diverge).

  it("does NOT throw when geo_target_type is undefined at runtime — defaults to PRESENCE", () => {
    // Cast through unknown to simulate the stale-client-state scenario
    // where the JavaScript value is undefined despite the TS type.
    const decoded = { targets: [], geo_target_type: undefined } as unknown as import("../geo-targets-codec.ts").DecodedGeoTargetsColumn;
    let wire: { targets: unknown[]; geo_target_type: string } | undefined;
    assert.doesNotThrow(() => { wire = serializeGeoTargetsColumn(decoded); });
    assert.equal(wire?.geo_target_type, "PRESENCE");
  });

  it("does NOT throw when geo_target_type is an unrecognised string — defaults to PRESENCE", () => {
    const decoded = { targets: [], geo_target_type: "UNKNOWN_VALUE" } as unknown as import("../geo-targets-codec.ts").DecodedGeoTargetsColumn;
    let wire: { geo_target_type: string } | undefined;
    assert.doesNotThrow(() => { wire = serializeGeoTargetsColumn(decoded); });
    assert.equal(wire?.geo_target_type, "PRESENCE");
  });

  it("does NOT throw when targets is undefined at runtime — returns []", () => {
    // This is the critical regression test: normaliseTargets(undefined)
    // previously threw TypeError: undefined is not iterable.
    const decoded = { targets: undefined, geo_target_type: "PRESENCE" } as unknown as import("../geo-targets-codec.ts").DecodedGeoTargetsColumn;
    let wire: { targets: unknown[] } | undefined;
    assert.doesNotThrow(() => { wire = serializeGeoTargetsColumn(decoded); });
    assert.deepEqual(wire?.targets, []);
  });

  it("does NOT throw when targets is null at runtime — returns []", () => {
    const decoded = { targets: null, geo_target_type: "PRESENCE" } as unknown as import("../geo-targets-codec.ts").DecodedGeoTargetsColumn;
    let wire: { targets: unknown[] } | undefined;
    assert.doesNotThrow(() => { wire = serializeGeoTargetsColumn(decoded); });
    assert.deepEqual(wire?.targets, []);
  });

  it("does NOT throw when the entire decoded object is null / undefined", () => {
    assert.doesNotThrow(() => serializeGeoTargetsColumn(null as unknown as import("../geo-targets-codec.ts").DecodedGeoTargetsColumn));
    assert.doesNotThrow(() => serializeGeoTargetsColumn(undefined as unknown as import("../geo-targets-codec.ts").DecodedGeoTargetsColumn));
  });
});
