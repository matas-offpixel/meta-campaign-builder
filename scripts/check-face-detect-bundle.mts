/**
 * Fails when the built render tick can't load the face detector the way
 * production does (lib/build/face-detect-bundle.ts). Run after `npm run build`:
 *
 *   node --experimental-strip-types scripts/check-face-detect-bundle.mts
 */

import { checkFaceDetectBundle, RENDER_TICK_ROUTE } from "../lib/build/face-detect-bundle.ts";

const result = checkFaceDetectBundle(process.cwd());
console.log(`${RENDER_TICK_ROUTE}: ${result.files} files traced; face-detect.ts compiled into ${result.chunk ?? "(not found)"}`);
if (result.problems.length) {
  for (const problem of result.problems) console.error(`✖ ${problem}`);
  process.exit(1);
}
console.log("✔ face-detect.ts's runtime import of face-api is left intact, and face-api's bundle and models are in the function.");
