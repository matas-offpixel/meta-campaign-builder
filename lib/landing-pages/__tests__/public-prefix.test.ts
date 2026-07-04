// NOTE (PR 2): /api/l/ assertions appended below the PR-1 cases.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Guard that `/l/` is (and stays) in PUBLIC_PREFIXES — without it the
 * default-deny proxy 307s every fan to /login and the landing pages
 * silently die (the /api/cron lesson). Source-shape check because
 * lib/auth/public-routes.ts has no runtime deps and the prefix list is a
 * literal.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROUTES_PATH = path.resolve(
  HERE,
  "../../../lib/auth/public-routes.ts",
);

describe("PUBLIC_PREFIXES /l/ entry", () => {
  it('public-routes.ts contains the "/l/" prefix', async () => {
    const src = await readFile(PUBLIC_ROUTES_PATH, "utf8");
    assert.match(src, /"\/l\/"/, 'expected "/l/" in PUBLIC_PREFIXES');
  });

  it("prefix has the trailing slash (a bare /l would also match /login)", async () => {
    const src = await readFile(PUBLIC_ROUTES_PATH, "utf8");
    // A bare "/l" entry would be a prefix of "/login" and every other
    // /l-prefixed path. Assert it does not exist as a standalone entry.
    assert.ok(!/"\/l",/.test(src), 'found a bare "/l" prefix — must be "/l/"');
  });

  it("isPublicPath behaviour: /l/{client}/{event} is public, unrelated /l* paths are not", async () => {
    const { isPublicPath } = await import(
      "../../../lib/auth/public-routes.ts"
    );
    assert.equal(
      isPublicPath("/l/gmc-worldwide-productions/jackies-mallorca-wlf8br"),
      true,
    );
    assert.equal(isPublicPath("/lounge"), false);
    assert.equal(isPublicPath("/library"), false);
  });
});

describe("PUBLIC_PREFIXES /api/l/ entry (PR 2 — signup POST)", () => {
  it('public-routes.ts contains the "/api/l/" prefix with trailing slash', async () => {
    const src = await readFile(PUBLIC_ROUTES_PATH, "utf8");
    assert.match(src, /"\/api\/l\/"/, 'expected "/api/l/" in PUBLIC_PREFIXES');
    assert.ok(!/"\/api\/l",/.test(src), 'found a bare "/api/l" prefix — must be "/api/l/"');
  });

  it("isPublicPath: the signup endpoint is public, /api/library-lookalikes are not", async () => {
    const { isPublicPath } = await import(
      "../../../lib/auth/public-routes.ts"
    );
    assert.equal(
      isPublicPath("/api/l/gmc-worldwide-productions/jackies-mallorca-wlf8br/signup"),
      true,
    );
    assert.equal(isPublicPath("/api/library"), false);
    assert.equal(isPublicPath("/api/launch"), false);
  });
});
