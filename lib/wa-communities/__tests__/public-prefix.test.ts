import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROUTES_PATH = path.resolve(
  HERE,
  "../../../lib/auth/public-routes.ts",
);

describe("PUBLIC_PREFIXES /j/ entry", () => {
  it('public-routes.ts contains the "/j/" prefix', async () => {
    const src = await readFile(PUBLIC_ROUTES_PATH, "utf8");
    assert.match(src, /"\/j\/"/, 'expected "/j/" in PUBLIC_PREFIXES');
  });

  it("isPublicPath: /j/{slug} and /j/{invite} are public", async () => {
    const { isPublicPath } = await import("../../../lib/auth/public-routes.ts");
    assert.equal(isPublicPath("/j/throwback-madrid"), true);
    assert.equal(isPublicPath("/j/IPCpHTE8JMu9JT5DenZglv"), true);
    assert.equal(isPublicPath("/jackets"), false);
  });
});

describe("ops UI /wa-communities is NOT public", () => {
  it("isPublicPath rejects the ops page and its API", async () => {
    const { isPublicPath } = await import("../../../lib/auth/public-routes.ts");
    assert.equal(isPublicPath("/wa-communities"), false);
    assert.equal(isPublicPath("/wa-communities/"), false);
    assert.equal(isPublicPath("/api/wa-communities"), false);
    assert.equal(isPublicPath("/api/wa-communities/some-id"), false);
  });

  it("PUBLIC_PREFIXES does not list /wa-communities", async () => {
    const src = await readFile(PUBLIC_ROUTES_PATH, "utf8");
    assert.ok(
      !/"\/wa-communities\/?"/.test(src),
      "/wa-communities must not appear in PUBLIC_PREFIXES",
    );
  });

  it("ops page gates on operator allowlist (same shape as BM)", async () => {
    const pagePath = path.resolve(
      HERE,
      "../../../app/(dashboard)/wa-communities/page.tsx",
    );
    const src = await readFile(pagePath, "utf8");
    assert.match(src, /MATAS_USER_IDS/, "page must check operator allowlist");
    assert.match(src, /redirect\("\/login"\)/, "page must require a session");
  });
});
