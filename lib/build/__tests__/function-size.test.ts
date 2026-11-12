import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { FUNCTION_SIZE_LIMIT_MB, MB, functionSizes, missingParts, overLimit, packageOf } from "../function-size.ts";

const root = mkdtempSync(join(tmpdir(), "function-size-"));
after(() => rmSync(root, { recursive: true, force: true }));

function file(rel: string, bytes: number): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes));
}

function trace(route: string, files: string[]): void {
  const dir = join(root, ".next", "server", "app", route);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "route.js"), "x".repeat(10));
  // Paths in a trace are relative to the trace's own folder.
  const up = "../".repeat(route.split("/").length + 3);
  writeFileSync(join(dir, "route.js.nft.json"), JSON.stringify({ version: 1, files: files.map((f) => up + f) }));
}

file("node_modules/big-binary/bin", 3000);
file("node_modules/@scope/lib/index.js", 500);
file("lib/thing.js", 40);
trace("api/heavy", ["node_modules/big-binary/bin", "node_modules/@scope/lib/index.js", "lib/thing.js", "node_modules/big-binary/bin", "missing/file.js"]);
trace("api/light", ["lib/thing.js"]);

describe("functionSizes", () => {
  it("adds the entry and each traced file once, and names the route", () => {
    const sizes = functionSizes(root);
    assert.deepEqual(sizes.map((s) => s.route), ["/api/heavy", "/api/light"]);
    const heavy = sizes[0]!;
    assert.equal(heavy.bytes, 10 + 3000 + 500 + 40);
    assert.equal(heavy.parts[0]!.name, "big-binary");
    assert.equal(heavy.parts[1]!.name, "@scope/lib");
    assert.equal(sizes[1]!.bytes, 50);
  });

  it("flags a function over the limit and passes one under it", () => {
    const sizes = functionSizes(root);
    assert.deepEqual(overLimit(sizes, 3000 / MB).map((s) => s.route), ["/api/heavy"]);
    assert.deepEqual(overLimit(sizes), []);
  });

  it("stays under Vercel's 250 MB cap", () => {
    assert.ok(FUNCTION_SIZE_LIMIT_MB < 250);
  });
});

describe("missingParts", () => {
  it("names a required route that lost a part, or has no trace", () => {
    const sizes = functionSizes(root);
    assert.deepEqual(missingParts(sizes, { "/api/heavy": ["big-binary", "@scope/lib"] }), []);
    assert.deepEqual(missingParts(sizes, { "/api/light": ["big-binary"], "/api/gone": ["x"] }), [
      "/api/light: big-binary is not traced",
      "/api/gone: no trace",
    ]);
  });
});

describe("packageOf", () => {
  it("groups by package, scoped or not, else by top folders", () => {
    assert.equal(packageOf("node_modules/@sparticuz/chromium/bin/x.br"), "@sparticuz/chromium");
    assert.equal(packageOf("node_modules/ffmpeg-static/ffmpeg"), "ffmpeg-static");
    assert.equal(packageOf(".next/server/chunks/a.js"), ".next/server");
  });
});
