/**
 * D11 / M5: the Internal Counts review list is internal only. It must never
 * be reachable from a share link or the client /admin dashboard, and its
 * routes sit behind the operator session.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function files(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(files(full));
    else if (/\.(tsx?|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

/** Every directory under app/ whose path names a share or the client admin namespace. */
function publicSurfaces(): string[] {
  const dirs: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      const rel = path.relative(path.join(ROOT, "app"), full).split(path.sep);
      if (rel.includes("share") || rel[rel.length - 1] === "admin" || rel.includes("(client-admin)")) dirs.push(full);
      else walk(full);
    }
  };
  walk(path.join(ROOT, "app"));
  return dirs;
}

describe("the review list is internal only", () => {
  it("nothing under a share route or /admin imports it", () => {
    const surfaces = publicSurfaces();
    assert.ok(surfaces.length > 0, "found the share and admin routes");
    const offenders = surfaces
      .flatMap(files)
      .filter((f) => /internal-counts|lib\/gmail/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    assert.deepEqual(offenders, []);
  });

  it("isn't a public route", () => {
    const publicRoutes = readFileSync(path.join(ROOT, "lib/auth/public-routes.ts"), "utf8");
    assert.ok(!/internal-counts/.test(publicRoutes));
    assert.ok(!/["'`]\/api\/gmail/.test(publicRoutes));
  });

  it("every page and route checks the operator session", () => {
    const own = [
      ...files(path.join(ROOT, "app/(dashboard)/internal-counts")),
      ...files(path.join(ROOT, "app/api/internal-counts")),
      ...files(path.join(ROOT, "app/api/gmail")),
    ];
    assert.ok(own.length >= 5);
    for (const f of own) {
      assert.ok(/auth\.getUser\(\)/.test(readFileSync(f, "utf8")), `${path.relative(ROOT, f)} checks the session`);
    }
  });
});
