import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";

import {
  AI_AUTOTAG_MODEL_VERSION,
  autoTag,
  autoTagDeduped,
  buildAutoTagSystemPrompt,
  buildAutoTagTool,
  hashAutoTagImage,
  type AutoTagInput,
  type AutoTagResult,
} from "../auto-tagger.ts";
import {
  CREATIVE_TAG_DIMENSIONS,
  type CreativeTagDimension,
  type MotionCreativeTagRow,
} from "../../db/creative-tags.ts";

const USER_ID = "00000000-0000-0000-0000-000000000001";

function tag(
  dimension: CreativeTagDimension,
  value_key: string,
  value_label: string,
): MotionCreativeTagRow {
  return {
    id: `${dimension}-${value_key}`,
    user_id: USER_ID,
    dimension,
    value_key,
    value_label,
    description: `${value_label} definition`,
    source: "motion_seed",
    created_at: "2026-05-02T00:00:00Z",
    updated_at: "2026-05-02T00:00:00Z",
  };
}

const TAXONOMY: MotionCreativeTagRow[] = CREATIVE_TAG_DIMENSIONS.flatMap(
  (dimension) => [
    tag(dimension, `${dimension}_one`, `${dimension} one`),
    tag(dimension, `${dimension}_two`, `${dimension} two`),
  ],
);

const INPUT: AutoTagInput = {
  thumbnailUrl: "https://example.com/thumb.jpg",
  headline: "Final tickets",
  body: "Saturday night at the venue.",
};

describe("autoTag", () => {
  it("embeds every dimension's full enum in the system prompt", () => {
    const prompt = buildAutoTagSystemPrompt(TAXONOMY);
    const toolJson = JSON.stringify(buildAutoTagTool(TAXONOMY));

    assert.equal(AI_AUTOTAG_MODEL_VERSION, "claude-haiku-4-5");
    for (const dimension of CREATIVE_TAG_DIMENSIONS) {
      assert.match(prompt, new RegExp(`\\b${dimension}\\b`));
      assert.match(toolJson, new RegExp(`"const":"${dimension}"`));
      const rows = TAXONOMY.filter((row) => row.dimension === dimension);
      for (const row of rows) {
        assert.match(prompt, new RegExp(`\\b${row.value_key}\\b`));
        assert.match(prompt, new RegExp(row.value_label));
        assert.match(prompt, new RegExp(`${row.value_label} definition`));
        assert.match(toolJson, new RegExp(`"${row.value_key}"`));
      }
    }
  });

  it("filters hallucinated value_keys before returning", async () => {
    let request: unknown;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      assert.equal(String(url), INPUT.thumbnailUrl);
      return {
        ok: true,
        headers: {
          get(name: string) {
            return name.toLowerCase() === "content-type"
              ? "image/webp"
              : null;
          },
        },
        async arrayBuffer() {
          return new Uint8Array([1, 2, 3]).buffer;
        },
      } as Response;
    }) as typeof fetch;
    const anthropic = {
      messages: {
        create(args: unknown) {
          request = args;
          return Promise.resolve({
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "record_creative_tags",
                input: {
                  tags: [
                    {
                      dimension: "asset_type",
                      value_key: "asset_type_one",
                      confidence: 0.91,
                    },
                    {
                      dimension: "asset_type",
                      value_key: "made_up_value",
                      confidence: 0.99,
                    },
                    {
                      dimension: "visual_format",
                      value_key: "visual_format_two",
                      confidence: 1.7,
                    },
                  ],
                },
              },
            ],
          });
        },
      },
    } as unknown as Anthropic;

    try {
      const result = await autoTag(INPUT, {
        taxonomy: TAXONOMY,
        anthropic,
        modelVersion: AI_AUTOTAG_MODEL_VERSION,
      });

      assert.deepEqual(result, [
        {
          dimension: "asset_type",
          value_key: "asset_type_one",
          confidence: 0.91,
        },
        {
          dimension: "visual_format",
          value_key: "visual_format_two",
          confidence: 1,
        },
      ]);
      const requestJson = JSON.stringify(request);
      assert.match(requestJson, /"type":"image"/);
      assert.match(requestJson, /"source":\{"type":"base64"/);
      assert.match(requestJson, /"media_type":"image\/webp"/);
      assert.match(requestJson, /"data":"AQID"/);
      assert.match(requestJson, /Final tickets/);
      assert.match(requestJson, /record_creative_tags/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// Image bytes keyed by URL. "ad-a" and "ad-b" deliberately resolve to the SAME
// bytes (so the same content hash) under different URLs — the rename/duplicate
// case the dedup layer must collapse. "ad-c" is a distinct image.
const DEDUP_IMAGES: Record<string, number[]> = {
  "https://cdn/a?sig=1": [1, 2, 3, 4],
  "https://cdn/b?sig=2": [1, 2, 3, 4],
  "https://cdn/c?sig=3": [9, 8, 7, 6],
};

function dedupFetchStub(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const bytes = DEDUP_IMAGES[String(url)] ?? [0];
    return {
      ok: true,
      headers: {
        get(name: string) {
          return name.toLowerCase() === "content-type" ? "image/png" : null;
        },
      },
      async arrayBuffer() {
        return new Uint8Array(bytes).buffer;
      },
    } as Response;
  }) as typeof fetch;
}

function singleTagAnthropic(counter: { calls: number }): Anthropic {
  return {
    messages: {
      create() {
        counter.calls += 1;
        return Promise.resolve({
          content: [
            {
              type: "tool_use",
              id: "toolu_dedup",
              name: "record_creative_tags",
              input: {
                tags: [
                  {
                    dimension: "asset_type",
                    value_key: "asset_type_one",
                    confidence: 0.8,
                  },
                ],
              },
            },
          ],
        });
      },
    },
  } as unknown as Anthropic;
}

describe("autoTagDeduped", () => {
  it("calls Claude once per unique thumbnail and reuses across creative names", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = dedupFetchStub();
    const counter = { calls: 0 };
    try {
      const results = await autoTagDeduped(
        [
          { creativeName: "ad-a", thumbnailUrl: "https://cdn/a?sig=1", headline: null, body: null },
          { creativeName: "ad-b", thumbnailUrl: "https://cdn/b?sig=2", headline: null, body: null },
          { creativeName: "ad-c", thumbnailUrl: "https://cdn/c?sig=3", headline: null, body: null },
        ],
        {
          taxonomy: TAXONOMY,
          anthropic: singleTagAnthropic(counter),
          modelVersion: AI_AUTOTAG_MODEL_VERSION,
          concurrency: 1,
        },
      );

      // Two distinct images → exactly two Claude calls (ad-a/ad-b collapse).
      assert.equal(counter.calls, 2);

      const byName = new Map(results.map((r) => [r.creativeName, r]));
      const a = byName.get("ad-a")!;
      const b = byName.get("ad-b")!;
      const c = byName.get("ad-c")!;

      // Same image → same hash; both names carry the (identical) tags.
      assert.equal(a.thumbnailHash, b.thumbnailHash);
      assert.notEqual(a.thumbnailHash, c.thumbnailHash);
      const expectedTags: AutoTagResult[] = [
        { dimension: "asset_type", value_key: "asset_type_one", confidence: 0.8 },
      ];
      assert.deepEqual(a.tags, expectedTags);
      assert.deepEqual(b.tags, expectedTags);
      assert.deepEqual(c.tags, expectedTags);

      // First occurrence of a hash is the one that was sent to Claude.
      assert.equal(a.outcome, "tagged");
      assert.equal(b.outcome, "reused_run");
      assert.equal(c.outcome, "tagged");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reuses persisted tags for a known hash without calling Claude", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = dedupFetchStub();
    const counter = { calls: 0 };
    const knownHash = hashAutoTagImage(
      Buffer.from(new Uint8Array([1, 2, 3, 4])).toString("base64"),
    );
    const persisted: AutoTagResult[] = [
      { dimension: "hook_tactic", value_key: "hook_tactic_two", confidence: 0.5 },
    ];
    try {
      const results = await autoTagDeduped(
        [
          { creativeName: "ad-a", thumbnailUrl: "https://cdn/a?sig=1", headline: null, body: null },
          { creativeName: "ad-b", thumbnailUrl: "https://cdn/b?sig=2", headline: null, body: null },
        ],
        {
          taxonomy: TAXONOMY,
          anthropic: singleTagAnthropic(counter),
          modelVersion: AI_AUTOTAG_MODEL_VERSION,
          concurrency: 2,
          knownTagsByHash: new Map([[knownHash, persisted]]),
        },
      );

      // The hash is already known → no Claude calls at all.
      assert.equal(counter.calls, 0);
      for (const result of results) {
        assert.equal(result.outcome, "reused_persisted");
        assert.deepEqual(result.tags, persisted);
        assert.equal(result.thumbnailHash, knownHash);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports thumbnail-less inputs without a Claude call", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = dedupFetchStub();
    const counter = { calls: 0 };
    try {
      const results = await autoTagDeduped(
        [{ creativeName: "ad-x", thumbnailUrl: null, headline: null, body: null }],
        {
          taxonomy: TAXONOMY,
          anthropic: singleTagAnthropic(counter),
          modelVersion: AI_AUTOTAG_MODEL_VERSION,
        },
      );
      assert.equal(counter.calls, 0);
      assert.equal(results[0].outcome, "no_thumbnail");
      assert.equal(results[0].thumbnailHash, null);
      assert.deepEqual(results[0].tags, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
