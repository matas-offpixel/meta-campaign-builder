/**
 * Regression tests for IG identity in new-ad creative payloads.
 *
 * History:
 *   b57a98e — removed instagram_user_id from new-ad payloads entirely
 *             → caused 1772103 (IG placements rejected for page-only creatives)
 *   PR #563 — re-added the field but used the legacy key `instagram_actor_id`
 *             → Meta rejected with (#100) even when the id was valid
 *   PR #569 — audit proved the issue: `instagram_actor_id` is rejected by Meta
 *             v21+ on this account; `instagram_user_id` is accepted (proven via
 *             validate_only probes on v21.0 and v23.0)
 *   PR #570 — renamed `instagram_actor_id` → `instagram_user_id` in all three
 *             new-ad builders (link, video, multi-placement)
 *
 * Test cases:
 *   A — validated IG id → `instagram_user_id` present in object_story_spec
 *   B — unvalidated IG id (validator returned null) → field omitted (b57a98e protection)
 *   C — no IG account on draft → field omitted
 *   D — field-name guard: `instagram_actor_id` must NEVER appear in the payload
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
      instagramAccountId: "17841407313865620",
      instagramActorId: "17841407313865620",
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
  c.identity = { pageId: "PAGE_4THEFANS" };
  return c;
}

// ── Case A: validated IG id → instagram_user_id present ──────────────────────

describe("Case A — validated IG id: instagram_user_id present in payload", () => {
  it("image creative with validated id includes instagram_user_id in object_story_spec", () => {
    const payload = buildCreativePayload(imageCreative(), {
      validatedIgActorId: "17841407313865620",
    });
    assert.equal(
      payload.object_story_spec?.instagram_user_id,
      "17841407313865620",
      "image creative must send instagram_user_id when caller provides a validated id — " +
        "page-only identity causes Meta 1772103 at /ads creation for IG placements",
    );
  });

  it("video creative with validated id includes instagram_user_id in object_story_spec", () => {
    const payload = buildCreativePayload(videoCreative(), {
      validatedIgActorId: "17841407313865620",
    });
    assert.equal(
      payload.object_story_spec?.instagram_user_id,
      "17841407313865620",
      "video creative must send instagram_user_id when caller provides a validated id",
    );
  });
});

// ── Case B: unvalidated IG id → field omitted (b57a98e protection) ───────────

describe("Case B — unvalidated IG id: instagram_user_id omitted", () => {
  it("image creative falls back to page-only when validatedIgActorId is undefined", () => {
    const payload = buildCreativePayload(imageCreative(), {
      validatedIgActorId: undefined,
    });
    assert.equal(
      payload.object_story_spec?.instagram_user_id,
      undefined,
      "must omit instagram_user_id when validation returned null (b57a98e protection — " +
        "sending an unauthorised id causes Meta #100)",
    );
    assert.ok(payload.object_story_spec?.page_id, "page_id must still be present");
  });

  it("video creative falls back to page-only when validatedIgActorId is undefined", () => {
    const payload = buildCreativePayload(videoCreative(), {
      validatedIgActorId: undefined,
    });
    assert.equal(payload.object_story_spec?.instagram_user_id, undefined);
    assert.ok(payload.object_story_spec?.page_id);
  });
});

// ── Case C: no IG account on draft → field omitted ───────────────────────────

describe("Case C — no IG account: instagram_user_id omitted without error", () => {
  it("creative with no instagramActorId omits instagram_user_id", () => {
    const payload = buildCreativePayload(creativeNoIgActor());
    assert.equal(payload.object_story_spec?.instagram_user_id, undefined);
    assert.ok(payload.object_story_spec?.page_id);
  });
});

// ── Case D: field-name guard — instagram_actor_id must NEVER appear ───────────
//
// Meta Marketing API (v21+ confirmed via validate_only) rejects payloads that
// use the legacy `instagram_actor_id` field even when the id value is correct.
// This test prevents any regression back to the wrong field name (PR #569).

describe("Case D — field-name guard: instagram_actor_id must not appear in payload", () => {
  it("image creative with validated id uses instagram_user_id, NOT instagram_actor_id", () => {
    const payload = buildCreativePayload(imageCreative(), {
      validatedIgActorId: "17841407313865620",
    });
    const raw = JSON.stringify(payload);
    assert.equal(
      payload.object_story_spec?.instagram_user_id,
      "17841407313865620",
      "instagram_user_id must be set",
    );
    assert.ok(
      !raw.includes("instagram_actor_id"),
      `payload must not contain the legacy field "instagram_actor_id" — Meta v21+ rejects it (#100). ` +
        `Payload: ${raw}`,
    );
  });

  it("video creative with validated id uses instagram_user_id, NOT instagram_actor_id", () => {
    const payload = buildCreativePayload(videoCreative(), {
      validatedIgActorId: "17841407313865620",
    });
    const raw = JSON.stringify(payload);
    assert.ok(
      !raw.includes("instagram_actor_id"),
      `video payload must not contain legacy "instagram_actor_id". Payload: ${raw}`,
    );
  });

  it("image creative without validated id also omits instagram_actor_id", () => {
    const payload = buildCreativePayload(imageCreative());
    const raw = JSON.stringify(payload);
    assert.ok(
      !raw.includes("instagram_actor_id"),
      `page-only payload must not contain "instagram_actor_id". Payload: ${raw}`,
    );
  });
});
