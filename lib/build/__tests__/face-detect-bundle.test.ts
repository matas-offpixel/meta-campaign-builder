import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { checkFaceDetectBundle, FACE_API_FILES, FACE_DETECT_MARKER, RENDER_TICK_ROUTE, type Io } from "../face-detect-bundle.ts";

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
  it("passes when the runtime import is left intact and face-api is traced", () => {
    const io = fakeBuild(`let e=await import(n(t).href);throw Error("${FACE_DETECT_MARKER}; pass a tensor")`);
    const result = checkFaceDetectBundle(ROOT, RENDER_TICK_ROUTE, io);
    assert.deepEqual(result.problems, []);
    assert.equal(result.chunk, ".next/server/chunks/route-abc.js");
  });

  it("fails on Turbopack's too-dynamic stub (production, 17 Nov 2026)", () => {
    const io = fakeBuild(
      `let e=await Promise.reject(Object.assign(Error("Cannot find module as expression is too dynamic"),{code:"MODULE_NOT_FOUND"}));throw Error("${FACE_DETECT_MARKER}")`,
    );
    const result = checkFaceDetectBundle(ROOT, RENDER_TICK_ROUTE, io);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0]!, /webpackIgnore/);
  });

  it("fails when face-api's bundle or models are not traced into the function", () => {
    const io = fakeBuild(`throw Error("${FACE_DETECT_MARKER}")`, [FACE_API_FILES[0]]);
    const result = checkFaceDetectBundle(ROOT, RENDER_TICK_ROUTE, io);
    assert.equal(result.problems.length, FACE_API_FILES.length - 1);
    assert.ok(result.problems.every((problem) => problem.includes("outputFileTracingIncludes")));
  });

  it("fails when the person-outline model (segment.ts, O120) is not traced", () => {
    const traced = FACE_API_FILES.filter((path) => !path.includes("/selfie/"));
    const result = checkFaceDetectBundle(ROOT, RENDER_TICK_ROUTE, fakeBuild(`throw Error("${FACE_DETECT_MARKER}")`, traced));
    assert.deepEqual(
      result.problems.map((problem) => problem.split(": ")[1]!.split(" ")[0]),
      ["lib/creative-lab/models/selfie/selfie.json", "lib/creative-lab/models/selfie/selfie.bin"],
    );
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
