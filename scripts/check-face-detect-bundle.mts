/**
 * Fails when the built render tick can't load the face detector the way
 * production does (lib/build/face-detect-bundle.ts). Run after `npm run build`:
 *
 *   node --experimental-strip-types scripts/check-face-detect-bundle.mts
 *
 * Then it runs the real face-detect.ts on the route's traced files alone: it
 * must load face-api from the traced copy, on the wasm backend with SIMD, and
 * find the face in face-api's sample photo.
 */

import { join } from "node:path";

import { checkFaceDetectBundle, loadDetectorFromTrace, RENDER_TICK_ROUTE } from "../lib/build/face-detect-bundle.ts";

const root = process.cwd();
const result = checkFaceDetectBundle(root);
console.log(`${RENDER_TICK_ROUTE}: ${result.files} files traced; face-detect.ts compiled into ${result.chunk ?? "(not found)"}`);
const problems = [...result.problems];

if (!problems.length) {
  const load = await loadDetectorFromTrace(root, result.traced);
  console.log(`face detection from the traced files: ${JSON.stringify({ ...load, main: load.main?.replace(load.dir, "<trace>") })}`);
  if (load.error) problems.push(`face-detect.ts failed on the traced files: ${load.error}`);
  else if (!load.main?.startsWith(join(load.dir, "node_modules"))) problems.push(`face-detect.ts loaded face-api from ${load.main}, not the traced copy`);
  else if (load.backend !== "wasm") problems.push(`face detection fell back to ${load.backend}: ${load.fallback ?? "no reason given"}`);
  else if (!load.simd) problems.push("the wasm backend started without SIMD");
  else if (!load.faces) problems.push("face detection on the traced files found no face in face-api's sample photo");
}

if (problems.length) {
  for (const problem of problems) console.error(`✖ ${problem}`);
  process.exit(1);
}
console.log("✔ face-detect.ts's runtime import of face-api is left intact, and the detector runs on wasm with SIMD from the traced files alone.");
