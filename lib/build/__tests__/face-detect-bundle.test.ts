import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { checkFaceDetectBundle, FACE_API_FILES, FACE_DETECT_MARKER, loadDetectorFromTrace, RENDER_TICK_ROUTE, type Io } from "../face-detect-bundle.ts";

const ROOT = "/repo";
const ENTRY = join(ROOT, ".next/server/app/api/cron/creative-lab-render-tick/route.js");

function fakeBuild(chunkBody: string, traced: readonly string[] = FACE_API_FILES): Io {
  // Trace paths are relative to the trace file, as next build writes them.
  const up = "../../../../../../";
  const files: Record<string, string> = {
    [`${ENTRY}.nft.json`]: JSON.stringify({ files: ["../../../../chunks/route-abc.js", ...traced.map((path) => `${up}${path}`)] }),
    [ENTRY]: "require('../../../../chunks/route-abc.js')",
    [join(ROOT, ".next/server/chunks/route-abc.js")]: chunkBody,
  };
  return { exists: (path) => path in files, read: (path) => files[path] ?? "" };
}

describe("face-detect bundle check (after next build)", () => {
  it("passes when the runtime import is left intact and face-api is traced, and lists the traced files", () => {
    const io = fakeBuild(`let e=await import(n(t).href);throw Error(\`${FACE_DETECT_MARKER} (active: \${b})\`)`);
    const result = checkFaceDetectBundle(ROOT, RENDER_TICK_ROUTE, io);
    assert.deepEqual(result.problems, []);
    assert.equal(result.chunk, ".next/server/chunks/route-abc.js");
    for (const want of FACE_API_FILES) assert.ok(result.traced.includes(want), want);
  });

  it("fails on Turbopack's too-dynamic stub (production, 17 Nov 2026)", () => {
    const io = fakeBuild(
      `let e=await Promise.reject(Object.assign(Error("Cannot find module as expression is too dynamic"),{code:"MODULE_NOT_FOUND"}));throw Error("${FACE_DETECT_MARKER}")`,
    );
    const result = checkFaceDetectBundle(ROOT, RENDER_TICK_ROUTE, io);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0]!, /webpackIgnore/);
  });

  it("names each file the trace left out (the models, the SIMD .wasm)", () => {
    const traced = FACE_API_FILES.filter((f) => !f.endsWith(".bin") && !f.endsWith("-simd.wasm"));
    const io = fakeBuild(`throw Error("${FACE_DETECT_MARKER}")`, traced);
    const result = checkFaceDetectBundle(ROOT, RENDER_TICK_ROUTE, io);
    assert.equal(result.problems.length, 3);
    assert.ok(result.problems.every((problem) => problem.includes("outputFileTracingIncludes")));
    assert.ok(result.problems.some((p) => p.includes("tfjs-backend-wasm-simd.wasm")));
  });

  it("fails when face-detect.ts is not compiled into the route at all", () => {
    const result = checkFaceDetectBundle(ROOT, RENDER_TICK_ROUTE, fakeBuild("module.exports={}"));
    assert.match(result.problems[0]!, /no compiled chunk holds face-detect\.ts/);
  });

  it("asks for a build when there is no trace", () => {
    const result = checkFaceDetectBundle(ROOT, RENDER_TICK_ROUTE, { exists: () => false, read: () => "" });
    assert.match(result.problems[0]!, /Run npm run build first/);
  });
});

/** The files next.config.ts includes for the render tick's face detection, from this checkout's node_modules. */
function includedFiles(root: string): string[] {
  const list = (dir: string, keep: (name: string) => boolean) =>
    existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter(keep).map((name) => `${dir}/${name}`) : [];
  const tfjs = readdirSync(join(root, "node_modules/@tensorflow")).filter((name) => name.startsWith("tfjs"));
  return [
    "node_modules/@vladmandic/face-api/package.json",
    "node_modules/@vladmandic/face-api/dist/face-api.node-wasm.js",
    ...list("node_modules/@vladmandic/face-api/model", () => true),
    ...tfjs.flatMap((name) => [`node_modules/@tensorflow/${name}/package.json`, ...list(`node_modules/@tensorflow/${name}/dist`, (f) => f.endsWith(".node.js"))]),
    ...list("node_modules/@tensorflow/tfjs-backend-wasm/dist", (f) => f.endsWith(".wasm")),
    "node_modules/long/package.json",
    "node_modules/long/src/long.js",
    "node_modules/seedrandom/package.json",
    ...list("node_modules/seedrandom", (f) => f.endsWith(".js")),
    ...list("node_modules/seedrandom/lib", (f) => f.endsWith(".js")),
  ];
}

describe("face-detect.ts on the included files alone (as in the function)", { timeout: 120_000 }, () => {
  const root = process.cwd();

  it("loads face-api from the copy and detects on wasm with SIMD", async () => {
    const load = await loadDetectorFromTrace(root, includedFiles(root));
    assert.equal(load.error, undefined);
    assert.ok(load.main?.startsWith(join(load.dir, "node_modules")), load.main);
    assert.equal(load.backend, "wasm");
    assert.equal(load.simd, true);
    assert.equal(load.fallback, null);
    assert.ok((load.faces ?? 0) >= 1);
  });

  it("falls back to cpu, says why, and still detects, when the .wasm files are missing", async () => {
    const load = await loadDetectorFromTrace(root, includedFiles(root).filter((f) => !f.endsWith(".wasm")));
    assert.equal(load.error, undefined);
    assert.equal(load.backend, "cpu");
    assert.match(load.fallback ?? "", /wasm/i);
    assert.ok((load.faces ?? 0) >= 1);
  });
});
