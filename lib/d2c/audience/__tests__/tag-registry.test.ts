/**
 * Unit tests for lib/d2c/audience/tag-registry.ts pure seams:
 *   recommendTagsForEvent, buildSegmentOpts, resolveAudienceTags.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSegmentOpts,
  recommendTagsForEvent,
  resolveAudienceTags,
  type AudienceTag,
} from "../tag-registry.ts";

const tag = (name: string, member_count: number, id = 0): AudienceTag => ({
  id: id || name.length,
  name,
  member_count,
});

describe("recommendTagsForEvent", () => {
  const all: AudienceTag[] = [
    tag("T26-ALGARVE", 500, 1),
    tag("T26-PORTO", 800, 2),
    tag("H25-PORTO", 300, 3),
    tag("T26-LISBON", 200, 4),
    tag("RANDOM-TAG", 999, 5),
  ];

  it("recommends own tag + city/country matches, ranked by reach", () => {
    const { recommended, other } = recommendTagsForEvent(
      { ownTag: "T26-ALGARVE", venue_city: "Porto", venue_country: "Portugal" },
      all,
    );
    // T26-PORTO (800) + H25-PORTO (300) contain "porto"; T26-ALGARVE is own tag.
    assert.deepEqual(
      recommended.map((t) => t.name),
      ["T26-PORTO", "T26-ALGARVE", "H25-PORTO"],
    );
    // Ranked by member_count desc: 800, 500, 300.
    assert.deepEqual(
      recommended.map((t) => t.member_count),
      [800, 500, 300],
    );
    // Others alphabetical.
    assert.deepEqual(other.map((t) => t.name), ["RANDOM-TAG", "T26-LISBON"]);
  });

  it("matches on event_code substring", () => {
    const { recommended } = recommendTagsForEvent({ event_code: "PORTO" }, all);
    assert.deepEqual(new Set(recommended.map((t) => t.name)), new Set(["T26-PORTO", "H25-PORTO"]));
  });

  it("empty event fields → everything is 'other'", () => {
    const { recommended, other } = recommendTagsForEvent({}, all);
    assert.equal(recommended.length, 0);
    assert.equal(other.length, all.length);
  });
});

describe("buildSegmentOpts", () => {
  it("builds a match-any segment_opts from a name→id map", () => {
    const opts = buildSegmentOpts({ "T26-ALGARVE": 101, "H26-PORTO": 202 }, [
      "T26-ALGARVE",
      "H26-PORTO",
    ]);
    assert.deepEqual(opts, {
      match: "any",
      conditions: [
        { condition_type: "StaticSegment", field: "static_segment", op: "static_is", value: 101 },
        { condition_type: "StaticSegment", field: "static_segment", op: "static_is", value: 202 },
      ],
    });
  });
  it("throws (never silently drops) on an unresolved tag", () => {
    assert.throws(
      () => buildSegmentOpts({ "T26-ALGARVE": 101 }, ["T26-ALGARVE", "MISSING"]),
      /Tag "MISSING" could not be resolved/,
    );
  });
});

describe("resolveAudienceTags (back-compat)", () => {
  it("prefers audience.tags[]", () => {
    assert.deepEqual(resolveAudienceTags({ tags: ["A", "B"], tag: "C" }), ["A", "B"]);
  });
  it("falls back to [audience.tag]", () => {
    assert.deepEqual(resolveAudienceTags({ tag: "C" }), ["C"]);
  });
  it("ignores empty tags[] and falls back", () => {
    assert.deepEqual(resolveAudienceTags({ tags: [], tag: "C" }), ["C"]);
    assert.deepEqual(resolveAudienceTags({ tags: ["", "  "], tag: "C" }), ["C"]);
  });
  it("returns [] when neither present", () => {
    assert.deepEqual(resolveAudienceTags({}), []);
  });
});
