import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { detectFaces, faceApiEntry } from "../face-detect.ts";

function read(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

describe("face-api loads in the deployed function", () => {
  it("every computed import() in face-detect.ts is left to Node, never to the bundler", () => {
    // Turbopack compiles import(<expression>) to a stub that throws "Cannot find
    // module as expression is too dynamic". In production that stub was the
    // only thing face-detect ever ran: every stored face_samples row held it.
    const source = read("lib/creative-lab/face-detect.ts");
    const calls = [...source.matchAll(/\bimport\(([^)]*)/g)].map((m) => m[1]!.trim());
    // An empty argument is prose ("a computed import()") in a comment.
    const computed = calls.filter((arg) => arg !== "" && !/^["']/.test(arg));
    assert.ok(computed.length > 0, "face-api is imported by path");
    for (const arg of computed) assert.match(arg, /turbopackIgnore: true/, `import(${arg}) must carry turbopackIgnore`);
    assert.doesNotMatch(source, /createRequire\(import\.meta\.url\)/, "import.meta.url is the build's path inside a bundle, not the function's");
  });

  it("the entry and the two models it loads sit under node_modules, and the render tick traces them", () => {
    const entry = faceApiEntry();
    assert.ok(existsSync(entry), entry);
    const model = join(dirname(entry), "..", "model");
    for (const name of ["ssd_mobilenetv1_model", "face_landmark_68_model"]) {
      assert.ok(existsSync(join(model, `${name}.bin`)), name);
      assert.ok(existsSync(join(model, `${name}-weights_manifest.json`)), name);
    }
    const config = read("next.config.ts");
    const tick = config.slice(config.indexOf('"/api/cron/creative-lab-render-tick"'));
    const block = tick.slice(0, tick.indexOf("],"));
    for (const path of [
      "./node_modules/@vladmandic/face-api/package.json",
      "./node_modules/@vladmandic/face-api/dist/face-api.esm.js",
      "./node_modules/@vladmandic/face-api/model/**/*",
    ]) {
      assert.ok(block.includes(`"${path}"`), path);
    }
    assert.equal(faceApiEntry("/var/task"), "/var/task/node_modules/@vladmandic/face-api/dist/face-api.esm.js");
  });

  it("loads the detector and its weights and runs it on a frame", async () => {
    const sharp = (await import("sharp")).default;
    const blank = await sharp({ create: { width: 320, height: 480, channels: 3, background: { r: 120, g: 90, b: 60 } } }).png().toBuffer();
    assert.deepEqual(await detectFaces(blank), []);
  });
});
