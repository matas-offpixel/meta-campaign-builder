import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types.ts";
import { TIKTOK_WRITES_DISABLED_REASON } from "../write/feature-flag.ts";
import { handleTikTokLaunch } from "../write/launch.ts";
import { mapTikTokLaunchError } from "../write/error-classify.ts";

class EmptyDraftSession {
  from() {
    return {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle() {
        return Promise.resolve({ data: null, error: null });
      },
    };
  }
}

afterEach(() => {
  delete process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED;
});

describe("handleTikTokLaunch", () => {
  it("returns 401 when there is no session user", async () => {
    const result = await handleTikTokLaunch({
      userId: null,
      draftId: "draft-1",
      session: new EmptyDraftSession() as unknown as SupabaseClient<Database>,
      admin: new EmptyDraftSession() as unknown as SupabaseClient,
    });
    assert.equal(result.status, 401);
    assert.equal(result.body.ok, false);
  });

  it("returns 400 when draftId is missing", async () => {
    const result = await handleTikTokLaunch({
      userId: "user-1",
      draftId: "",
      session: new EmptyDraftSession() as unknown as SupabaseClient<Database>,
      admin: new EmptyDraftSession() as unknown as SupabaseClient,
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.ok, false);
    if (!result.body.ok) assert.match(result.body.error, /draftId/);
  });

  it("returns 503 with the flag reason when writes are off", async () => {
    const result = await handleTikTokLaunch({
      userId: "user-1",
      draftId: "draft-1",
      session: new EmptyDraftSession() as unknown as SupabaseClient<Database>,
      admin: new EmptyDraftSession() as unknown as SupabaseClient,
    });
    assert.equal(result.status, 503);
    assert.equal(result.body.ok, false);
    if (!result.body.ok) {
      assert.equal(result.body.error, TIKTOK_WRITES_DISABLED_REASON);
      assert.equal(result.body.reason, "writes_disabled");
    }
  });

  it("returns 404 when the draft is missing or not owned", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const result = await handleTikTokLaunch({
      userId: "user-1",
      draftId: "draft-1",
      session: new EmptyDraftSession() as unknown as SupabaseClient<Database>,
      admin: new EmptyDraftSession() as unknown as SupabaseClient,
    });
    assert.equal(result.status, 404);
    assert.equal(result.body.ok, false);
    if (!result.body.ok) assert.match(result.body.error, /not found/i);
  });
});

describe("mapTikTokLaunchError", () => {
  it("maps rate-limit, auth, and other TikTok codes", () => {
    const rate = mapTikTokLaunchError({
      code: 50001,
      message: "too many requests",
      requestId: "req-1",
    });
    assert.equal(rate.kind, "rate_limit");
    assert.equal(rate.status, 429);
    assert.match(rate.message, /req-1/);

    const auth = mapTikTokLaunchError({
      code: 40001,
      message: "invalid token",
      requestId: "req-2",
    });
    assert.equal(auth.kind, "auth");
    assert.equal(auth.status, 401);

    const other = mapTikTokLaunchError({
      code: 40000,
      message: "invalid params",
      requestId: "req-3",
    });
    assert.equal(other.kind, "other");
    assert.equal(other.status, 502);
  });

  it("maps 40002 campaign-name collision to an actionable Step 2 message", () => {
    const mapped = mapTikTokLaunchError({
      code: 40002,
      message: "Campaign name already exists. Please try another one.",
      requestId: "20260821071348308F4888CBE8D17022B5",
      campaignName: "[IRW0001] Jamie Jones -sig",
    });
    assert.equal(mapped.kind, "name_collision");
    assert.equal(mapped.status, 400);
    assert.match(mapped.message, /Step 2/);
    assert.match(mapped.message, /\[IRW0001\] Jamie Jones -sig/);
    assert.doesNotMatch(mapped.message, /TikTok connection is invalid/);
  });

  it("does not treat 40002 parameter-validation errors as auth", () => {
    const budget = mapTikTokLaunchError({
      code: 40002,
      message: "Your budget setting must not be less than £50",
    });
    assert.equal(budget.kind, "other");
    assert.equal(budget.status, 502);
    assert.match(budget.message, /TikTok error 40002/);
    assert.match(budget.message, /Your budget setting must not be less than £50/);
    assert.doesNotMatch(budget.message, /TikTok connection is invalid/);

    const identity = mapTikTokLaunchError({
      code: 40002,
      message: "Identity_type and Identity_bc_ID don't match",
    });
    assert.equal(identity.kind, "other");
    assert.equal(identity.status, 502);
    assert.match(identity.message, /TikTok error 40002/);
    assert.match(identity.message, /Identity_type and Identity_bc_ID don't match/);
    assert.doesNotMatch(identity.message, /TikTok connection is invalid/);

    const nameExists = mapTikTokLaunchError({
      code: 40002,
      message: "Campaign name already exists. Please try another one.",
    });
    assert.equal(nameExists.kind, "name_collision");
    assert.doesNotMatch(nameExists.message, /TikTok connection is invalid/);
    assert.match(
      nameExists.message,
      /already used on this advertiser/,
    );
  });
});
