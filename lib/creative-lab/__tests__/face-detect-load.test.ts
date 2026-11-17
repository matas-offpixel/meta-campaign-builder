import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import sharp from "sharp";

import { detectFaces, FACE_API_MAIN, faceApiMain } from "../face-detect.ts";

const SOURCE = readFileSync(new URL("../face-detect.ts", import.meta.url), "utf8")
  .replace(/\/\*(?!\s*webpackIgnore)[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("face-detect.ts loads face-api the way the production bundle can", () => {
  it("marks every computed import() webpackIgnore, so the bundler leaves it to run at runtime", () => {
    const imports = [...SOURCE.matchAll(/\bimport\(\s*([^)]*)\)/g)].map((m) => m[1]!.trim());
    const computed = imports.filter((arg) => !/^(\/\*[^*]*\*\/\s*)?["']/.test(arg));
    assert.ok(computed.length >= 1, "face-api is loaded with a computed import()");
    for (const arg of computed) assert.match(arg, /^\/\*\s*webpackIgnore:\s*true\s*\*\//, `unmarked computed import(${arg})`);
  });

  it("prefers the traced copy under the working directory (the Vercel function)", () => {
    const cwd = "/var/task";
    assert.equal(faceApiMain(cwd, (path) => path === join(cwd, "node_modules", FACE_API_MAIN)), join(cwd, "node_modules", FACE_API_MAIN));
  });

  it("falls back to resolving from the module when the working directory has no copy", () => {
    const main = faceApiMain("/nowhere", () => false);
    assert.ok(main.endsWith(join("@vladmandic", "face-api", "dist", "face-api.esm.js")), main);
  });

  it("loads face-api and its models through that path and runs a detection", async () => {
    const blank = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#808080" } }).png().toBuffer();
    const faces = await detectFaces(blank);
    assert.deepEqual(faces, []);
  });
});
