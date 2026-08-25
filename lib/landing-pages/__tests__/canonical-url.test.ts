import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fanPath, fanUrl } from "../../admin/pages-list.ts";
import {
  canonicalLandingPageUrl,
  normalizeCustomHost,
  resolveCanonicalLandingPage,
} from "../canonical-url.ts";

/**
 * Three states the wizards must treat as distinct: custom host, /l/ path,
 * and none. Asserted as `kind`, not as a brittle literal list that could
 * be rewritten to match a broken builder.
 */

const ORIGIN = "https://app.offpixel.co.uk";

describe("resolveCanonicalLandingPage — states", () => {
  it("custom domain → custom URL (apex as stored, never invented www)", () => {
    const resolved = resolveCanonicalLandingPage({
      hasPage: true,
      clientSlug: "gmc-worldwide-productions",
      eventSlug: "dod-newcastle",
      publicOrigin: ORIGIN,
      customHost: "dod-newcastle.com",
    });
    assert.equal(resolved.kind, "custom");
    if (resolved.kind !== "custom") return;
    assert.equal(resolved.host, "dod-newcastle.com");
    assert.equal(resolved.url, "https://dod-newcastle.com");
    assert.doesNotMatch(resolved.url, /www\./);
  });

  it("no custom domain → /l/… via fanUrl (the LP system's own builder)", () => {
    const resolved = resolveCanonicalLandingPage({
      hasPage: true,
      clientSlug: "gmc-worldwide-productions",
      eventSlug: "jackies-mallorca",
      publicOrigin: ORIGIN,
      customHost: null,
    });
    assert.equal(resolved.kind, "path");
    if (resolved.kind !== "path") return;
    assert.equal(
      resolved.path,
      fanPath("gmc-worldwide-productions", "jackies-mallorca"),
    );
    assert.equal(
      resolved.url,
      fanUrl(ORIGIN, "gmc-worldwide-productions", "jackies-mallorca"),
    );
  });

  it("event with no LP → none", () => {
    const resolved = resolveCanonicalLandingPage({
      hasPage: false,
      clientSlug: "gmc-worldwide-productions",
      eventSlug: "no-page-yet",
      publicOrigin: ORIGIN,
      customHost: "dod-newcastle.com",
    });
    assert.equal(resolved.kind, "none");
    assert.equal(canonicalLandingPageUrl(resolved), null);
  });
});

describe("normalizeCustomHost", () => {
  it("strips protocol and path; does not add www", () => {
    assert.equal(normalizeCustomHost("https://dod-newcastle.com/foo"), "dod-newcastle.com");
    assert.equal(normalizeCustomHost("DOD-NEWCASTLE.COM"), "dod-newcastle.com");
    assert.equal(normalizeCustomHost("  "), null);
    assert.equal(normalizeCustomHost(null), null);
  });

  it("keeps www only when that host was explicitly supplied", () => {
    assert.equal(normalizeCustomHost("www.dod-newcastle.com"), "www.dod-newcastle.com");
  });
});

describe("resolveCanonicalLandingPage — missing slugs", () => {
  it("has a page but no slugs and no custom host → none", () => {
    const resolved = resolveCanonicalLandingPage({
      hasPage: true,
      clientSlug: null,
      eventSlug: null,
      publicOrigin: ORIGIN,
      customHost: null,
    });
    assert.equal(resolved.kind, "none");
  });
});
