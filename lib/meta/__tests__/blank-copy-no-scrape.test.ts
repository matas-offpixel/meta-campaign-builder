/**
 * A blank headline or description is sent as one space, and a space read
 * back is an empty field. Operator-typed copy is unchanged.
 *
 * Run: node --test lib/meta/__tests__/blank-copy-no-scrape.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { migrateDraft } from "../../autosave.ts";
import { firstPresentCopy } from "../../reporting/creative-preview-extract.ts";
import { extractPreview } from "../../reporting/creative-preview-extract.ts";
import type { AdCreativeDraft } from "../../types.ts";
import {
  blankAsNoScrape,
  buildCreativePayload,
  isBlankCopy,
  readBlankCopy,
  suppressedCopyNote,
} from "../creative.ts";

const enhancements = {
  enabled: false,
  textOptimizations: false,
  visualEnhancements: false,
  musicEnhancements: false,
  autoVariations: false,
} as const;

function creative(overrides: Partial<AdCreativeDraft> = {}): AdCreativeDraft {
  return {
    id: "cr_test",
    name: "Test Creative",
    sourceType: "new",
    mediaType: "image",
    assetMode: "single",
    identity: { pageId: "pg_123", instagramAccountId: "" },
    assetVariations: [
      {
        id: "var_1",
        name: "Variation 1",
        assets: [
          {
            id: "a",
            aspectRatio: "4:5",
            uploadStatus: "uploaded",
            assetHash: "hash_feed",
          },
        ],
      },
    ],
    captions: [{ id: "cap_1", text: "Come see us live" }],
    headline: "Buy tickets now",
    description: "Limited availability",
    destinationUrl: "https://example.com/tickets",
    cta: "learn_more",
    enhancements,
    ...overrides,
  };
}

function dualImage(overrides: Partial<AdCreativeDraft> = {}): AdCreativeDraft {
  return creative({
    assetMode: "dual",
    assetVariations: [
      {
        id: "var_1",
        name: "Variation 1",
        assets: [
          { id: "a45", aspectRatio: "4:5", uploadStatus: "uploaded", assetHash: "hash_45" },
          { id: "a916", aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: "hash_916" },
        ],
      },
    ],
    ...overrides,
  });
}

describe("blankAsNoScrape", () => {
  it("returns operator text unchanged", () => {
    assert.equal(blankAsNoScrape("Sign up now"), "Sign up now");
    assert.equal(blankAsNoScrape("  Sign up now  "), "  Sign up now  ");
  });

  it("turns an empty or whitespace-only field into one space", () => {
    for (const value of ["", " ", "   ", "\n", undefined, null]) {
      assert.equal(blankAsNoScrape(value), " ");
      assert.equal(isBlankCopy(value), true);
    }
    assert.equal(isBlankCopy("Sign up now"), false);
  });

  it("reads a space back as an empty string and leaves real copy", () => {
    assert.equal(readBlankCopy(" "), "");
    assert.equal(readBlankCopy("   "), "");
    assert.equal(readBlankCopy("Sign up now"), "Sign up now");
    assert.equal(readBlankCopy(null), "");
  });
});

describe("payloads", () => {
  it("sends a space for a blank headline and description on the link_data path", async () => {
    const payload = await buildCreativePayload(
      creative({ headline: "", description: "" }),
    );
    const link = payload.object_story_spec?.link_data;
    assert.equal(link?.name, " ");
    assert.equal(link?.description, " ");
    assert.equal(payload.asset_feed_spec, undefined);
  });

  it("keeps a typed headline and sends a space only for the blank description", async () => {
    const payload = await buildCreativePayload(
      creative({ headline: "Sign up now", description: "" }),
    );
    const link = payload.object_story_spec?.link_data;
    assert.equal(link?.name, "Sign up now");
    assert.equal(link?.description, " ");
  });

  it("treats whitespace-only operator input as blank", async () => {
    const payload = await buildCreativePayload(
      creative({ headline: "   ", description: "   " }),
    );
    const link = payload.object_story_spec?.link_data;
    assert.equal(link?.name, " ");
    assert.equal(link?.description, " ");
  });

  it("sends spaces on the asset_feed_spec path and leaves typed copy byte-identical", async () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    try {
      const blank = await buildCreativePayload(dualImage({ headline: "", description: "" }));
      assert.deepEqual(blank.asset_feed_spec?.titles, [{ text: " " }]);
      assert.deepEqual(blank.asset_feed_spec?.descriptions, [{ text: " " }]);

      const typed = await buildCreativePayload(dualImage());
      assert.equal(typed.asset_feed_spec?.titles?.[0]?.text, "Buy tickets now");
      assert.equal(typed.asset_feed_spec?.descriptions?.[0]?.text, "Limited availability");
    } finally {
      delete process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
    }
  });

  it("sets video_data.title to a space and does not invent a description", async () => {
    const payload = await buildCreativePayload(
      creative({
        mediaType: "video",
        headline: "",
        description: "",
        assetVariations: [
          {
            id: "var_1",
            name: "Variation 1",
            assets: [
              {
                id: "a",
                aspectRatio: "9:16",
                uploadStatus: "uploaded",
                videoId: "vid_1",
                thumbnailUrl: "https://cdn/thumb.jpg",
              },
            ],
          },
        ],
      }),
    );
    const video = payload.object_story_spec?.video_data;
    assert.equal(video?.title, " ");
    assert.equal("description" in (video ?? {}), false);
  });

  it("does not put copy onto an existing-post boost", async () => {
    const payload = await buildCreativePayload(
      creative({
        sourceType: "existing_post",
        headline: "",
        description: "",
        destinationUrl: "",
        existingPost: { postId: "pg_123_999", source: "facebook" },
      }),
    );
    assert.equal(payload.object_story_spec, undefined);
    assert.equal(payload.asset_feed_spec, undefined);
    assert.equal(payload.object_story_id, "pg_123_999");
    assert.equal(suppressedCopyNote(creative({ sourceType: "existing_post", headline: "", description: "" })), null);
  });
});

describe("read-back", () => {
  it("extractPreview treats a space as no headline and does not fall through to the creative name", () => {
    const preview = extractPreview({
      name: "Static - Ahmed 2026-09-16-a397abdcdcab914ef3b67ed5aff41ec3",
      asset_feed_spec: {
        titles: [{ text: " " }],
        descriptions: [{ text: " " }],
      },
      object_story_spec: { link_data: { name: " ", description: " " } },
    });
    assert.equal(preview.headline, null);
    assert.notEqual(preview.headline, " ");
    assert.equal(
      firstPresentCopy([" "], "Static - Ahmed 2026-09-16-a397abdcdcab914ef3b67ed5aff41ec3"),
      null,
    );
  });

  it("still shows a real title, and a missing title can fall back to the name", () => {
    assert.equal(firstPresentCopy(["Sign up now"], "internal-name"), "Sign up now");
    assert.equal(firstPresentCopy([undefined], "internal-name"), "internal-name");
  });

  it("a draft loaded with a space headline shows an empty field", () => {
    const draft = migrateDraft({
      creatives: [
        {
          id: "cr_space",
          name: "Static - Ahmed",
          headline: " ",
          description: " ",
        },
      ],
    } as unknown as Record<string, unknown>);
    assert.equal(draft.creatives[0]?.headline, "");
    assert.equal(draft.creatives[0]?.description, "");
  });

  it("a draft loaded with real copy keeps it", () => {
    const draft = migrateDraft({
      creatives: [{ id: "cr_real", name: "Poster", headline: "Sign up now", description: "Tonight" }],
    } as unknown as Record<string, unknown>);
    assert.equal(draft.creatives[0]?.headline, "Sign up now");
    assert.equal(draft.creatives[0]?.description, "Tonight");
  });
});

describe("launch summary", () => {
  it("names the blank fields and stays quiet when both were typed", () => {
    assert.equal(
      suppressedCopyNote({ sourceType: "new", headline: "", description: "" }),
      "headline: none · description: none",
    );
    assert.equal(
      suppressedCopyNote({ sourceType: "new", headline: "Sign up now", description: "   " }),
      "description: none",
    );
    assert.equal(
      suppressedCopyNote({ sourceType: "new", headline: "Sign up now", description: "Tonight" }),
      null,
    );
  });

  it("the review line appends the note the launch route records", () => {
    const review = readFileSync("components/steps/review-launch.tsx", "utf8");
    const route = readFileSync("app/api/meta/launch-campaign/route.ts", "utf8");
    assert.match(review, /Creative created · \$\{identityLabel\} · \$\{c\.copyNote\}/);
    assert.match(route, /suppressedCopyNote\(creative\)/);
  });
});
