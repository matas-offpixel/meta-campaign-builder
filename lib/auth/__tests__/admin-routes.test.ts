import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adminClientSlugFromPath,
  isAdminPath,
  isAdminPublicPath,
  isOperatorAdminPath,
} from "../admin-routes.ts";

/**
 * Phase 1 of the client admin dashboard arc (OP909) — path classification
 * feeding the proxy. Pinned here because a misclassification is an auth
 * bug: a path wrongly marked public bypasses the session check; a path
 * wrongly marked operator bypasses the client_users membership check.
 */

describe("isAdminPath", () => {
  it("matches /admin and everything under it", () => {
    assert.equal(isAdminPath("/admin"), true);
    assert.equal(isAdminPath("/admin/login"), true);
    assert.equal(isAdminPath("/admin/gmc-worldwide-productions"), true);
    assert.equal(isAdminPath("/admin/gmc-worldwide-productions/pages"), true);
  });

  it("does NOT match /administrator or other prefixes sharing letters", () => {
    assert.equal(isAdminPath("/administrator"), false);
    assert.equal(isAdminPath("/admins"), false);
    assert.equal(isAdminPath("/"), false);
    assert.equal(isAdminPath("/login"), false);
  });
});

describe("isAdminPublicPath", () => {
  it("login page and auth callbacks are public", () => {
    assert.equal(isAdminPublicPath("/admin/login"), true);
    assert.equal(isAdminPublicPath("/admin/auth/callback"), true);
  });

  it("everything else under /admin requires a session", () => {
    assert.equal(isAdminPublicPath("/admin"), false);
    assert.equal(isAdminPublicPath("/admin/gmc-worldwide-productions"), false);
    assert.equal(
      isAdminPublicPath("/admin/gmc-worldwide-productions/settings"),
      false,
    );
    // A client slug that HAPPENS to start with "login" must not be public.
    assert.equal(isAdminPublicPath("/admin/login-records"), false);
  });
});

describe("isOperatorAdminPath", () => {
  it("pre-existing operator pages skip the membership check", () => {
    assert.equal(isOperatorAdminPath("/admin/render-test"), true);
    assert.equal(isOperatorAdminPath("/admin/render-reel"), true);
    assert.equal(isOperatorAdminPath("/admin/cron-health"), true);
    assert.equal(isOperatorAdminPath("/admin/cron-health/details"), true);
  });

  it("client dashboards are NOT operator paths", () => {
    assert.equal(isOperatorAdminPath("/admin"), false);
    assert.equal(isOperatorAdminPath("/admin/gmc-worldwide-productions"), false);
    // Prefix-sharing slugs must not leak into the operator carve-out.
    assert.equal(isOperatorAdminPath("/admin/render-testify"), false);
  });
});

describe("adminClientSlugFromPath", () => {
  it("extracts the slug segment", () => {
    assert.equal(
      adminClientSlugFromPath("/admin/gmc-worldwide-productions"),
      "gmc-worldwide-productions",
    );
    assert.equal(
      adminClientSlugFromPath("/admin/gmc-worldwide-productions/pages/new"),
      "gmc-worldwide-productions",
    );
  });

  it("bare /admin yields null (proxy redirects to the member's slug)", () => {
    assert.equal(adminClientSlugFromPath("/admin"), null);
    assert.equal(adminClientSlugFromPath("/admin/"), null);
  });

  it("non-admin paths yield null", () => {
    assert.equal(adminClientSlugFromPath("/clients/abc"), null);
  });
});
