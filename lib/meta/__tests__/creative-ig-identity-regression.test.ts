/**
 * Regression test for Meta code=100 subcode=1772103
 * "Select an Instagram account or Facebook Page".
 *
 * Root cause (see docs/AUDIT_DUAL_IMAGE_1772103_2026-06-05.md):
 *   Commit b57a98e removed `instagram_actor_id` from new-ad link/video
 *   creatives, so `buildCreativePayload` emits a PAGE-ONLY object_story_spec.
 *   When the ad set serves Instagram placements (Stories/Reels — exactly what a
 *   dual 4:5 + 9:16 upload targets), Meta rejects the /ads call with 1772103
 *   because the creative has no Instagram identity to render IG placements.
 *
 *   This is NOT caused by PR #561 — the flag-OFF payload is byte-identical
 *   pre/post #561. The defect predates it (b57a98e, 2026-04-18).
 *
 * Expected behaviour (post-fix): a new-ad creative whose identity carries an
 * ads-authorised Instagram actor id MUST include an Instagram identity in the
 * payload so IG placements can serve.
 *
 * THIS TEST IS INTENTIONALLY RED on current main and turns green once the
 * Instagram identity is restored to the new-ad creative builders.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCreativePayload } from "../creative.ts";
import type { AdCreativeDraft } from "../../types.ts";

const enhancements = {
  enabled: false,
  textOptimizations: false,
  visualEnhancements: false,
  musicEnhancements: false,
  autoVariations: false,
} as const;

function imageCreative(): AdCreativeDraft {
  return {
    id: "cr_img",
    name: "Aberdeen WC26 — Dual Image",
    sourceType: "new",
    mediaType: "image",
    assetMode: "dual",
    identity: {
      pageId: "PAGE_4THEFANS",
      instagramAccountId: "1750802446345627",
      instagramActorId: "1750802446345627",
    },
    assetVariations: [
      {
        id: "v",
        name: "V1",
        assets: [
          { id: "a45", aspectRatio: "4:5", uploadStatus: "uploaded", assetHash: "HASH_45" },
          { id: "a916", aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: "HASH_916" },
        ],
      },
    ],
    captions: [{ id: "c", text: "Get your Aberdeen tickets" }],
    headline: "World Classic 2026",
    description: "",
    destinationUrl: "https://example.com/aberdeen",
    cta: "book_now",
    enhancements,
  } as AdCreativeDraft;
}

function videoCreative(): AdCreativeDraft {
  return {
    ...imageCreative(),
    id: "cr_vid",
    name: "Aberdeen WC26 — Video",
    mediaType: "video",
    assetVariations: [
      {
        id: "v",
        name: "V1",
        assets: [
          {
            id: "a916",
            aspectRatio: "9:16",
            uploadStatus: "uploaded",
            videoId: "VID_916",
            thumbnailUrl: "https://cdn/t.jpg",
          },
        ],
      },
    ],
  } as AdCreativeDraft;
}

describe("new-ad creative carries Instagram identity (regression: code=100 subcode=1772103)", () => {
  it("image creative includes an Instagram identity when the draft has an IG actor", () => {
    const payload = buildCreativePayload(imageCreative());
    assert.ok(
      payload.object_story_spec?.instagram_actor_id,
      "image creative must send instagram_actor_id so IG (Stories/Reels) placements can render — " +
        "page-only identity causes Meta 1772103 at /ads creation",
    );
  });

  it("video creative includes an Instagram identity when the draft has an IG actor", () => {
    const payload = buildCreativePayload(videoCreative());
    assert.ok(
      payload.object_story_spec?.instagram_actor_id,
      "video creative must send instagram_actor_id so IG (Stories/Reels) placements can render",
    );
  });
});
