/**
 * Checks, on the real `next build` output, that the render tick can load the
 * face detector the way production does.
 *
 * lib/creative-lab/face-detect.ts loads face-api's ESM bundle with a runtime
 * `import()` of a file URL. Turbopack cannot analyse a computed import, and
 * unless it is told to leave it alone it replaces the call with a stub that
 * throws "Cannot find module as expression is too dynamic". On 17 Nov 2026
 * every clip's face samples in production held exactly that error, and
 * render-queue.ts left those caption renders queued. Node runs the source
 * file fine, so only the compiled route shows it.
 *
 * scripts/check-face-detect-bundle.mts runs this in CI after `npm run build`.
 * No `@/` imports: node --test cannot resolve them.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const RENDER_TICK_ROUTE = "/api/cron/creative-lab-render-tick";
/** A string literal only face-detect.ts has; it survives minification. */
export const FACE_DETECT_MARKER = "face-detect: canvas is not available";
/** Turbopack's replacement for an import it cannot analyse. */
export const TOO_DYNAMIC = "expression is too dynamic";
export const FACE_API_FILES = [
  "node_modules/@vladmandic/face-api/dist/face-api.esm.js",
  "node_modules/@vladmandic/face-api/model/ssd_mobilenetv1_model.bin",
  "node_modules/@vladmandic/face-api/model/face_landmark_68_model.bin",
] as const;

export type Io = { exists(path: string): boolean; read(path: string): string };
const fsIo: Io = { exists: existsSync, read: (path) => readFileSync(path, "utf8") };

export type BundleCheck = { problems: string[]; chunk: string | null; files: number };

/** The route's compiled entry and every file its trace lists. */
function routeFiles(root: string, route: string, io: Io): { entry: string; files: string[] } | null {
  const entry = join(root, ".next", "server", "app", ...route.split("/").filter(Boolean), "route.js");
  const trace = `${entry}.nft.json`;
  if (!io.exists(trace)) return null;
  const { files } = JSON.parse(io.read(trace)) as { files: string[] };
  return { entry, files: [entry, ...files.map((file) => resolve(dirname(trace), file))] };
}

export function checkFaceDetectBundle(root: string, route: string = RENDER_TICK_ROUTE, io: Io = fsIo): BundleCheck {
  const found = routeFiles(root, route, io);
  if (!found) return { problems: [`${route}: no route.js.nft.json. Run npm run build first.`], chunk: null, files: 0 };
  const problems: string[] = [];
  const rel = found.files.map((path) => relative(root, path).split("\\").join("/"));
  for (const want of FACE_API_FILES) {
    if (!rel.includes(want)) problems.push(`${route}: ${want} is not in the function (next.config.ts outputFileTracingIncludes).`);
  }
  const compiled = found.files.filter((path) => path.endsWith(".js") && relative(root, path).startsWith(".next"));
  const chunk = compiled.find((path) => io.exists(path) && io.read(path).includes(FACE_DETECT_MARKER)) ?? null;
  if (!chunk) {
    problems.push(`${route}: no compiled chunk holds face-detect.ts ("${FACE_DETECT_MARKER}").`);
  } else if (io.read(chunk).includes(TOO_DYNAMIC)) {
    problems.push(
      `${relative(root, chunk)}: the bundler replaced a dynamic import in face-detect.ts with a stub that throws "Cannot find module as ${TOO_DYNAMIC}". Mark it /* webpackIgnore: true */.`,
    );
  }
  return { problems, chunk: chunk ? relative(root, chunk) : null, files: found.files.length };
}
