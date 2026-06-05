/**
 * Regression test for Meta code=100 subcode=1772103
 * "Select an Instagram account or Facebook Page".
 *
 * Root cause (see docs/AUDIT_DUAL_IMAGE_1772103_2026-06-05.md):
 *   Commit b57a98e removed `instagram_actor_id` from new-ad link/video
 *   creatives, so `buildCreativePayload` emitted a PAGE-ONLY object_story_spec.
 *   When the ad set serves Instagram placements (Stories/Reels — exactly what a
 *   dual 4:5 + 9:16 upload targets), Meta rejected the /ads call with 1772103
 *   because the creative had no Instagram identity to render IG placements.
 *
 * Fix (PR #563):
 *   `buildCreativePayload` now accepts `opts.validatedIgActorId`. When the
 *   caller passes a pre-validated actor id (verified against the ad account's
 *   /instagram_accounts list via `createIgActorValidator`), the builders set
 *   `object_story_spec.instagram_actor_id` — enabling Instagram placements
 *   while avoiding the b57a98e "unauthorised actor" (#100) regression for
 *   accounts where the IG id is not in the authorised list.
 *
 * Test cases:
 *   A — validated IG actor → instagram_actor_id present in payload
 *   B — unvalidated IG actor (validation returned null) → field omitted
 *   C — no IG account on the draft → field omitted
 */

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

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

function creativeNoIgActor(): AdCreativeDraft {
  const c = imageCreative();
  // No IG actor — pure page-only creative (e.g. Facebook-only campaign)
  c.identity = { pageId: "PAGE_4THEFANS" };
  return c;
}

// ── Test case A: validated IG actor → instagram_actor_id present ─────────────

describe("Case A — validated IG actor: instagram_actor_id present in payload", () => {
  it("image creative with validated actor id includes instagram_actor_id", () => {
    const payload = buildCreativePayload(imageCreative(), {
      validatedIgActorId: "1750802446345627",
    });
    assert.equal(
      payload.object_story_spec?.instagram_actor_id,
      "1750802446345627",
      "image creative must send instagram_actor_id when caller provides a validated id — " +
        "page-only identity causes Meta 1772103 at /ads creation for IG placements",
    );
  });

  it("video creative with validated actor id includes instagram_actor_id", () => {
    const payload = buildCreativePayload(videoCreative(), {
      validatedIgActorId: "1750802446345627",
    });
    assert.equal(
      payload.object_story_spec?.instagram_actor_id,
      "1750802446345627",
      "video creative must send instagram_actor_id when caller provides a validated id",
    );
  });
});

// ── Test case B: unvalidated IG actor → field omitted, no exception ──────────
// This is the b57a98e protection: an id that is NOT in the ad account's
// /instagram_accounts list returns null from the validator. The builder must
// omit the field rather than sending an unauthorised id (which causes #100).

describe("Case B — unvalidated IG actor: instagram_actor_id omitted", () => {
  it("image creative falls back to page-only when validatedIgActorId is undefined", () => {
    // Simulates validator.validate() returning null → caller passes undefined
    const payload = buildCreativePayload(imageCreative(), {
      validatedIgActorId: undefined,
    });
    assert.equal(
      payload.object_story_spec?.instagram_actor_id,
      undefined,
      "must omit instagram_actor_id when validation returned null (unauthorised actor guard — b57a98e protection)",
    );
    assert.ok(
      payload.object_story_spec?.page_id,
      "page_id must still be present for page-only fallback",
    );
  });

  it("video creative falls back to page-only when validatedIgActorId is undefined", () => {
    const payload = buildCreativePayload(videoCreative(), {
      validatedIgActorId: undefined,
    });
    assert.equal(payload.object_story_spec?.instagram_actor_id, undefined);
    assert.ok(payload.object_story_spec?.page_id);
  });
});

// ── Test case C: no IG account on draft → field omitted, no error ────────────

describe("Case C — no IG account: instagram_actor_id omitted without error", () => {
  it("creative with no instagramActorId omits instagram_actor_id", () => {
    // No opts.validatedIgActorId — because identity has no IG actor, the route
    // would not call validator.validate() and passes no opts.
    const payload = buildCreativePayload(creativeNoIgActor());
    assert.equal(payload.object_story_spec?.instagram_actor_id, undefined);
    assert.ok(payload.object_story_spec?.page_id);
  });
});
