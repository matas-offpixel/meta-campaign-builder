/**
 * Fails when the built render tick can't load the face detector the way
 * production does (lib/build/face-detect-bundle.ts). Run after `npm run build`:
 *
 *   node --experimental-strip-types scripts/check-face-detect-bundle.mts
 *
 * It also loads each timing-sample backend (lib/creative-lab/face-detect-bench.ts)
 * from the route's traced files alone: wasm must load with SIMD. tfjs-node
 * is not a dependency (its native libtensorflow is 401 MB, over Vercel's
 * 250 MB function cap), so its result is printed, not required.
 */

import { checkFaceBenchBundle, checkFaceDetectBundle, loadBenchFromTrace, RENDER_TICK_ROUTE } from "../lib/build/face-detect-bundle.ts";

const root = process.cwd();
const result = checkFaceDetectBundle(root);
console.log(`${RENDER_TICK_ROUTE}: ${result.files} files traced; face-detect.ts compiled into ${result.chunk ?? "(not found)"}`);
const problems = [...result.problems];

const bench = checkFaceBenchBundle(root);
problems.push(...bench.problems);
if (!bench.problems.length) {
  const wasm = await loadBenchFromTrace(root, bench.traced, "wasm");
  console.log(`timing sample, wasm from the traced files: ${JSON.stringify(wasm)}`);
  if (!wasm.loaded || wasm.backend !== "wasm") problems.push(`the wasm backend didn't load from the traced files: ${wasm.error ?? JSON.stringify(wasm)}`);
  else if (!wasm.simd) problems.push("the wasm backend loaded without SIMD");
  else if (typeof wasm.detectS !== "number") problems.push(`the wasm backend loaded but didn't detect: ${wasm.error ?? JSON.stringify(wasm)}`);
  const node = await loadBenchFromTrace(root, bench.traced, "tfjs-node");
  console.log(`timing sample, tfjs-node from the traced files (recorded, not required): ${JSON.stringify(node)}`);
}

if (problems.length) {
  for (const problem of problems) console.error(`✖ ${problem}`);
  process.exit(1);
}
console.log("✔ face-detect.ts's runtime import of face-api is left intact, face-api's bundle and models are in the function, and the wasm timing sample loads from the traced files with SIMD.");
