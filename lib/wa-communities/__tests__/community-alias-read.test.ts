import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { communityAliasReadResponse } from "../community-alias-read.ts";

describe("community alias read response", () => {
  it("returns the destination on a hit", () => {
    const res = communityAliasReadResponse({
      slug: "puzzle-circuit",
      configured: true,
      authorized: true,
      rateLimited: false,
      lookupError: null,
      destinationInviteCode: "EIRmWYF6uTVBBfXVE5vXxU",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      slug: "puzzle-circuit",
      invite_code: "EIRmWYF6uTVBBfXVE5vXxU",
      effective_destination: "https://chat.whatsapp.com/EIRmWYF6uTVBBfXVE5vXxU?mode=gi_t",
    });
    assert.equal(res.cacheControl, "private, max-age=60");
  });

  it("404s a miss so cirqlin can tell it from a broken dashboard", () => {
    const res = communityAliasReadResponse({
      slug: "missing",
      configured: true,
      authorized: true,
      rateLimited: false,
      lookupError: null,
      destinationInviteCode: null,
    });
    assert.equal(res.status, 404);
  });

  it("returns a degraded 200 when the lookup throws", () => {
    const res = communityAliasReadResponse({
      slug: "puzzle-circuit",
      configured: true,
      authorized: true,
      rateLimited: false,
      lookupError: new Error("connection reset"),
      destinationInviteCode: null,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      slug: "puzzle-circuit",
      invite_code: null,
      effective_destination: null,
      degraded: true,
      reason: "lookup_failed",
    });
    assert.equal(res.cacheControl, "private, no-store");
  });

  it("rejects a missing bearer when the secret is configured", () => {
    const res = communityAliasReadResponse({
      slug: "puzzle-circuit",
      configured: true,
      authorized: false,
      rateLimited: false,
      lookupError: null,
      destinationInviteCode: "EIRmWYF6uTVBBfXVE5vXxU",
    });
    assert.equal(res.status, 401);
  });
});
