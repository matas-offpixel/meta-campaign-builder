import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  communityAliasBearerMatches,
  communityAliasReadResponse,
} from "../community-alias-read.ts";

describe("community alias read response", () => {
  it("returns the destination on a hit", () => {
    const res = communityAliasReadResponse({
      slug: "puzzle-circuit",
      configured: true,
      authorized: true,
      rateLimited: false,
      lookupError: null,
      destinationInviteCode: "EIRmWYF6uTVBBfXVE5vXxU",
      interstitialEnabled: false,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      slug: "puzzle-circuit",
      invite_code: "EIRmWYF6uTVBBfXVE5vXxU",
      effective_destination: "https://chat.whatsapp.com/EIRmWYF6uTVBBfXVE5vXxU?mode=gi_t",
      interstitial_enabled: false,
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
      interstitialEnabled: false,
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
      interstitialEnabled: true,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      slug: "puzzle-circuit",
      invite_code: null,
      effective_destination: null,
      interstitial_enabled: false,
      degraded: true,
      reason: "lookup_failed",
    });
    assert.equal(res.cacheControl, "private, no-store");
  });

  it("refuses every request when the bearer is unset", () => {
    const res = communityAliasReadResponse({
      slug: "locklead-nx",
      configured: false,
      authorized: true,
      rateLimited: false,
      lookupError: null,
      destinationInviteCode: "C7WMSoEAPJL59FIY0iDJd2",
      interstitialEnabled: true,
    });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: "Unauthorized." });
    assert.equal(JSON.stringify(res.body).includes("C7WM"), false);
  });

  it("rejects a missing bearer when the secret is configured", () => {
    const res = communityAliasReadResponse({
      slug: "puzzle-circuit",
      configured: true,
      authorized: false,
      rateLimited: false,
      lookupError: null,
      destinationInviteCode: "EIRmWYF6uTVBBfXVE5vXxU",
      interstitialEnabled: true,
    });
    assert.equal(res.status, 401);
  });

  it("returns interstitial_enabled alongside the invite code", () => {
    const res = communityAliasReadResponse({
      slug: "puzzle-circuit",
      configured: true,
      authorized: true,
      rateLimited: false,
      lookupError: null,
      destinationInviteCode: "EIRmWYF6uTVBBfXVE5vXxU",
      interstitialEnabled: true,
    });
    assert.equal(res.status, 200);
    assert.equal(
      (res.body as { interstitial_enabled?: boolean }).interstitial_enabled,
      true,
    );
  });
});

describe("community alias bearer", () => {
  const secret = "test-bearer-value";

  it("matches the bearer with a timing-safe compare", () => {
    assert.equal(communityAliasBearerMatches(`Bearer ${secret}`, secret), true);
    assert.equal(communityAliasBearerMatches(`bearer ${secret}`, secret), true);
  });

  it("rejects a wrong token of the same length, a different length, and an empty secret", () => {
    assert.equal(communityAliasBearerMatches("Bearer test-bearer-WRONG", secret), false);
    assert.equal(communityAliasBearerMatches("Bearer short", secret), false);
    assert.equal(communityAliasBearerMatches(`Bearer ${secret}`, ""), false);
    assert.equal(communityAliasBearerMatches(null, secret), false);
  });
});
