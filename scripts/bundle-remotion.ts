/**
 * Pre-build Remotion bundle for SSR rendering.
 *
 * @remotion/bundler cannot run inside a Next.js API route (Webpack-in-Webpack).
 * Run this script before `next build` / first local render so the provider can
 * point @remotion/renderer at the on-disk serve URL.
 */

import fs from "node:fs";
import path from "node:path";

import { bundle } from "@remotion/bundler";

const ROOT = process.cwd();
const ENTRY = path.join(ROOT, "src/remotion/index.tsx");
const OUT_DIR = path.join(ROOT, ".remotion/bundle");

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(OUT_DIR), { recursive: true });

  console.info(`[bundle-remotion] entry=${ENTRY}`);
  console.info(`[bundle-remotion] outDir=${OUT_DIR}`);

  const serveUrl = await bundle({
    entryPoint: ENTRY,
    outDir: OUT_DIR,
  });

  console.info(`[bundle-remotion] done serveUrl=${serveUrl}`);
}

main().catch((err) => {
  console.error("[bundle-remotion] failed:", err);
  process.exit(1);
});
