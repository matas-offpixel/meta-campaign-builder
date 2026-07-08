/**
 * Unit tests for lib/d2c/audience/tag-registry.ts pure seams:
 *   recommendTagsForEvent, buildSegmentOpts, resolveAudienceTags,
 *   resolveMailchimpListId, getAudienceTags (Bug C, 2026-07-08).
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  __clearTagCacheForTests,
  buildSegmentOpts,
  getAudienceTags,
  recommendTagsForEvent,
  resolveAudienceTags,
  resolveMailchimpListId,
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

// ── Bug C (2026-07-08): list_id vs audience_id key drift ───────────────────

describe("resolveMailchimpListId", () => {
  it("prefers list_id when both keys are present", () => {
    assert.equal(
      resolveMailchimpListId({ list_id: "c2b4d77acb", audience_id: "old-id" }),
      "c2b4d77acb",
    );
  });
  it("falls back to audience_id (historical rows)", () => {
    assert.equal(resolveMailchimpListId({ audience_id: "c2b4d77acb" }), "c2b4d77acb");
  });
  it("trims whitespace", () => {
    assert.equal(resolveMailchimpListId({ list_id: "  c2b4d77acb  " }), "c2b4d77acb");
  });
  it("returns null when neither key is a non-empty string", () => {
    assert.equal(resolveMailchimpListId({}), null);
    assert.equal(resolveMailchimpListId({ list_id: "" }), null);
    assert.equal(resolveMailchimpListId({ list_id: 123 as unknown as string }), null);
  });
});

// ── Bug C (2026-07-08): tags 404 → correct segments endpoint ───────────────

describe("getAudienceTags", () => {
  let origFetch: typeof fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    __clearTagCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("hits GET /lists/{id}/segments?type=static (NOT /tags, which 404s)", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ segments: [] }), { status: 200 });
    };
    await getAudienceTags("us7", "ak", "c2b4d77acb");
    assert.match(requestedUrl, /\/3\.0\/lists\/c2b4d77acb\/segments\?type=static/);
    assert.doesNotMatch(requestedUrl, /\/tags\b/);
  });

  it("maps segments[] to AudienceTag[] with member_count, filtering malformed entries", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          segments: [
            { id: 1, name: "T26-ALGARVE", member_count: 500 },
            { id: 2, name: "  T26-PORTO  ", member_count: 800 },
            { id: 3, name: "NO-COUNT" },
            { name: "missing-id" },
            { id: 4 },
          ],
        }),
        { status: 200 },
      );
    const tags = await getAudienceTags("us7", "ak", "c2b4d77acb");
    const expected: AudienceTag[] = [
      { id: 1, name: "T26-ALGARVE", member_count: 500 },
      { id: 2, name: "T26-PORTO", member_count: 800 },
      { id: 3, name: "NO-COUNT", member_count: 0 },
    ];
    assert.deepEqual(tags, expected);
  });

  it("caches per (serverPrefix, listId) for 5 minutes, skipping a second fetch", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ segments: [{ id: 1, name: "A", member_count: 1 }] }), {
        status: 200,
      });
    };
    const t0 = 1_000_000;
    await getAudienceTags("us7", "ak", "list-a", { nowMs: t0 });
    await getAudienceTags("us7", "ak", "list-a", { nowMs: t0 + 60_000 });
    assert.equal(calls, 1, "second call within TTL must be served from cache");

    await getAudienceTags("us7", "ak", "list-a", { nowMs: t0 + 6 * 60_000 });
    assert.equal(calls, 2, "call past the 5-minute TTL must re-fetch");
  });

  it("propagates a 404 as a MailchimpHttpError (regression guard for the original bug)", async () => {
    globalThis.fetch = async () =>
      new Response("Resource Not Found", { status: 404 });
    await assert.rejects(
      () => getAudienceTags("us7", "ak", "bad-list", { nowMs: 2_000_000 }),
      /Mailchimp HTTP 404/,
    );
  });
});
