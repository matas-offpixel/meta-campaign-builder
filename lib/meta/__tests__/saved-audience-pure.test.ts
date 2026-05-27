import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSavedAudienceCreateParams,
  classifyCloneError,
  findDuplicateName,
  parseSavedAudienceListResponse,
} from "../saved-audience-pure.ts";

describe("parseSavedAudienceListResponse", () => {
  it("normalises name/description/updatedAt and drops invalid rows", () => {
    const raw = {
      data: [
        {
          id: "23856781234",
          name: "Headsy Curated – Full – London",
          description: "DJ Heartstring engagers + Overmono IG followers",
          targeting: { geo_locations: { cities: [{ key: "2643743", radius: 40 }] } },
          time_updated: "2026-04-12T11:00:00+0000",
          time_created: "2026-01-02T10:00:00+0000",
        },
        // Missing required name → dropped.
        { id: "111", description: "no name" },
        // Non-object → dropped.
        "string row",
        // Falls back to time_created when time_updated absent.
        {
          id: "23856785555",
          name: "Backup",
          time_created: "2026-02-02T10:00:00+0000",
        },
        // Empty description coerced to null.
        { id: "23856786666", name: "Minimal", description: "  " },
      ],
    };
    const out = parseSavedAudienceListResponse(raw);
    assert.equal(out.length, 3);
    assert.deepEqual(out[0], {
      id: "23856781234",
      name: "Headsy Curated – Full – London",
      description: "DJ Heartstring engagers + Overmono IG followers",
      updatedAt: "2026-04-12T11:00:00+0000",
    });
    assert.equal(out[1].updatedAt, "2026-02-02T10:00:00+0000");
    assert.equal(out[2].description, null);
  });

  it("returns [] for non-object / missing data", () => {
    assert.deepEqual(parseSavedAudienceListResponse(null), []);
    assert.deepEqual(parseSavedAudienceListResponse({}), []);
    assert.deepEqual(parseSavedAudienceListResponse({ data: "nope" }), []);
  });
});

describe("buildSavedAudienceCreateParams", () => {
  it("preserves name + description and JSON-stringifies targeting", () => {
    // Mirror of the "Headsy Curated" example: geo + age + 50+ custom_audience
    // inclusions. The clone POST must preserve all three slices verbatim.
    const targeting = {
      age_min: 18,
      age_max: 45,
      geo_locations: {
        custom_locations: [
          { latitude: 51.5074, longitude: -0.1278, radius: 40, distance_unit: "kilometer" },
        ],
      },
      custom_audiences: [
        { id: "23856797010001", name: "DJ Heartstring FB Engagers 365" },
        { id: "23856797010002", name: "Overmono IG Followers" },
      ],
      excluded_custom_audiences: [
        { id: "23856797010099", name: "Past purchasers" },
      ],
    };
    const params = buildSavedAudienceCreateParams({
      name: "Headsy Curated – Full – London",
      description: "Big multi-source build",
      targeting,
    });
    assert.equal(params.name, "Headsy Curated – Full – London");
    assert.equal(params.description, "Big multi-source build");
    const parsed = JSON.parse(params.targeting) as Record<string, unknown>;
    assert.deepEqual(parsed, targeting);
  });

  it("omits description when blank or missing", () => {
    const p1 = buildSavedAudienceCreateParams({
      name: "X",
      description: "   ",
      targeting: { age_min: 18 },
    });
    assert.equal(p1.description, undefined);
    const p2 = buildSavedAudienceCreateParams({
      name: "Y",
      targeting: { age_min: 18 },
    });
    assert.equal(p2.description, undefined);
  });

  it("throws when targeting is missing — cloning needs a spec", () => {
    assert.throws(
      () =>
        buildSavedAudienceCreateParams({
          name: "X",
          targeting: undefined as unknown,
        }),
      /targeting is missing/i,
    );
    assert.throws(
      () =>
        buildSavedAudienceCreateParams({
          name: "X",
          targeting: null as unknown,
        }),
      /targeting is missing/i,
    );
  });
});

describe("findDuplicateName", () => {
  it("is case-sensitive — matches Meta's uniqueness rule", () => {
    const existing = new Set(["Headsy Curated – Full – London", "Other"]);
    assert.equal(findDuplicateName("Headsy Curated – Full – London", existing), true);
    assert.equal(findDuplicateName("headsy curated – full – london", existing), false);
    assert.equal(findDuplicateName("Brand New", existing), false);
  });
});

describe("classifyCloneError", () => {
  it("flags duplicate-name messages from Meta", () => {
    assert.equal(
      classifyCloneError({ code: 100, message: "Name has already been taken" }),
      "duplicate_name",
    );
    assert.equal(
      classifyCloneError({ code: 100, message: "An audience with this name already exists" }),
      "duplicate_name",
    );
  });

  it("flags rate limit codes (80004, 4, 17) as rate_limit", () => {
    assert.equal(classifyCloneError({ code: 80004 }), "rate_limit");
    assert.equal(classifyCloneError({ code: 4 }), "rate_limit");
    assert.equal(classifyCloneError({ code: 17 }), "rate_limit");
  });

  it("flags auth codes (190, 102) as auth", () => {
    assert.equal(classifyCloneError({ code: 190 }), "auth");
    assert.equal(classifyCloneError({ code: 102 }), "auth");
  });

  it("flags permission errors by code 200 or message", () => {
    assert.equal(classifyCloneError({ code: 200 }), "permission");
    assert.equal(
      classifyCloneError({ code: 100, message: "Permission denied for this resource" }),
      "permission",
    );
  });

  it("falls through to unknown for everything else", () => {
    assert.equal(classifyCloneError({ code: 1, message: "transient" }), "unknown");
    assert.equal(classifyCloneError({}), "unknown");
  });
});
