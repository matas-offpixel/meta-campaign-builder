import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type OpenAI from "openai";

import {
  autoTag,
  buildAutoTagSystemPrompt,
  type AutoTagInput,
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

    for (const dimension of CREATIVE_TAG_DIMENSIONS) {
      assert.match(prompt, new RegExp(`\\b${dimension}\\b`));
      const rows = TAXONOMY.filter((row) => row.dimension === dimension);
      for (const row of rows) {
        assert.match(prompt, new RegExp(`\\b${row.value_key}\\b`));
        assert.match(prompt, new RegExp(row.value_label));
        assert.match(prompt, new RegExp(`${row.value_label} definition`));
      }
    }
  });

  it("filters hallucinated value_keys before returning", async () => {
    let request: unknown;
    const openai = {
      chat: {
        completions: {
          create(args: unknown) {
            request = args;
            return Promise.resolve({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
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
                    }),
                  },
                },
              ],
            });
          },
        },
      },
    } as unknown as OpenAI;

    const result = await autoTag(INPUT, {
      taxonomy: TAXONOMY,
      openai,
      modelVersion: "gpt-4o-mini",
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
    assert.match(JSON.stringify(request), /"type":"image_url"/);
    assert.match(JSON.stringify(request), /Final tickets/);
  });
});
