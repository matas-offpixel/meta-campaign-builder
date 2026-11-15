/**
 * Fails when any Vercel function the build traced is over 230 MB
 * uncompressed (Vercel refuses a deploy over 250 MB), or when an in-process
 * Remotion route lost the Chromium / serve bundle files next.config.ts
 * includes for it. Run after `npm run build`:
 *
 *   node --experimental-strip-types scripts/check-function-size.mts [--limit 230] [--top 5]
 *
 * CI runs it on Ubuntu after the build job's `npm run build`, so it measures
 * the Linux binaries Vercel ships. On macOS the darwin binaries are smaller
 * (ffmpeg-static is about 44 MB there and 80 MB on linux-x64), so a local
 * number reads low. See lib/build/function-size.ts.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { FUNCTION_SIZE_LIMIT_MB, formatMb, functionSizes, missingParts, overLimit } from "../lib/build/function-size.ts";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const limit = Number(flag("--limit") ?? FUNCTION_SIZE_LIMIT_MB);
const top = Number(flag("--top") ?? 5);
const root = process.cwd();

if (!existsSync(join(root, ".next", "server", "app"))) {
  console.error("No .next/server/app. Run npm run build first.");
  process.exit(2);
}

const sizes = functionSizes(root);
if (sizes.length === 0) {
  console.error("No *.js.nft.json traces under .next/server/app.");
  process.exit(2);
}

console.log(`Largest functions (limit ${limit} MB; Vercel's is 250 MB):`);
for (const s of sizes.slice(0, top)) {
  console.log(`  ${formatMb(s.bytes).padStart(10)}  ${s.route}  (${s.files} files)`);
}

let failed = false;
const missing = missingParts(sizes);
if (missing.length) {
  failed = true;
  console.error("\nIn-process Remotion routes are missing files next.config.ts includes for them:");
  for (const m of missing) console.error(`  ${m}`);
}

const over = overLimit(sizes, limit);
if (over.length) {
  failed = true;
  for (const s of over) {
    console.error(`\n${s.route} is ${formatMb(s.bytes)}, over ${limit} MB. Largest parts:`);
    for (const p of s.parts.slice(0, 8)) console.error(`  ${formatMb(p.bytes).padStart(10)}  ${p.name}`);
  }
  console.error(
    "\nExclude files the route never loads (outputFileTracingExcludes in next.config.ts), or move a heavy import out of the modules the route imports.",
  );
}
if (failed) process.exit(1);
