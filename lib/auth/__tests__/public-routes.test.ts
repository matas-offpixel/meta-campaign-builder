import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPublicPath } from "../public-routes.ts";

describe("isPublicPath — venue daily-budget carve-out", () => {
  it("matches the canonical dynamic path", () => {
    assert.equal(
      isPublicPath(
        "/api/clients/8e3f7b62-7a4f-4e63-b7c8-1a2b3c4d5e6f/venues/WC26-LON-FRA/daily-budget",
      ),
      true,
    );
  });

  it("matches with url-encoded event_code segments", () => {
    // Event codes can include hyphens/slugs; the regex restricts a single
    // path segment so encoded slashes (%2F) cannot smuggle extra segments.
    assert.equal(
      isPublicPath(
        "/api/clients/c1/venues/BB26-KAYODE%2DLON/daily-budget",
      ),
      true,
    );
  });

  it("rejects trailing path segments after /daily-budget", () => {
    assert.equal(
      isPublicPath(
        "/api/clients/c1/venues/EVT-1/daily-budget/leak",
      ),
      false,
    );
  });

  it("rejects the path without the /venues/ middle segment", () => {
    assert.equal(isPublicPath("/api/clients/c1/daily-budget"), false);
  });

  it("rejects sibling routes under /api/clients/[id]/venues/[code]/*", () => {
    assert.equal(
      isPublicPath("/api/clients/c1/venues/EVT-1/insights"),
      false,
    );
  });
});

describe("isPublicPath — pre-existing rules still hold", () => {
  it("admits /share/* prefixes", () => {
    assert.equal(isPublicPath("/share/client/abcdef1234"), true);
    assert.equal(isPublicPath("/api/share/client/abcdef1234/tickets"), true);
  });

  it("admits /api/cron/* prefixes", () => {
    assert.equal(isPublicPath("/api/cron/funnel-pacing-refresh"), true);
  });

  it("denies generic gated routes", () => {
    assert.equal(isPublicPath("/api/clients"), false);
    assert.equal(isPublicPath("/api/intelligence/creatives"), false);
  });
});
