import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import sharp from "sharp";

import { faceSampleState, isDetectorLoadError } from "../caption-placement.ts";
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

describe("a detector that failed to load is tried again (faceSampleState)", () => {
  const clip = { cropFocusX: 0.5, cropFocusY: 0.5, inS: 0, outS: 30 };
  const stored = (extra: Record<string, unknown>) => ({ detector: "ssd_mobilenet_v1", fps: 5 as const, cropFocusX: 0.5, cropFocusY: 0.5, inS: 0, outS: 30, ...extra });

  it("reads production's stored bundler error (17 Nov 2026) as checking, so the render tick re-detects", () => {
    assert.equal(faceSampleState(stored({ error: "Cannot find module as expression is too dynamic" }), clip), "checking");
    assert.equal(isDetectorLoadError("Cannot find module '@vladmandic/face-api'"), true);
  });

  it("keeps a real detection failure failed, and good samples ready", () => {
    assert.equal(faceSampleState(stored({ error: "ffmpeg exited with code 1" }), clip), "failed");
    assert.equal(faceSampleState(stored({ samples: [{ t: 0, faces: [] }] }), clip), "ready");
  });
});
