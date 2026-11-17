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

/**
 * The face check's timing samples (lib/creative-lab/face-detect-bench.ts) run the wasm backend in a child
 * process that no import reaches, so next.config.ts includes its files by hand. These must be in the
 * function; loadBenchFromTrace then loads the backend from the traced files alone.
 */
export const FACE_BENCH_FILES = [
  "lib/creative-lab/face-bench-child.cjs",
  "node_modules/@vladmandic/face-api/dist/face-api.node-wasm.js",
  "node_modules/@tensorflow/tfjs/dist/tf.node.js",
  "node_modules/@tensorflow/tfjs-core/dist/tf-core.node.js",
  "node_modules/@tensorflow/tfjs-backend-wasm/dist/tf-backend-wasm.node.js",
  "node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm",
  "node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm",
] as const;

/** The route's traced files, relative to the root, and which of FACE_BENCH_FILES are missing. */
export function checkFaceBenchBundle(root: string, route: string = RENDER_TICK_ROUTE, io: Io = fsIo): { problems: string[]; traced: string[] } {
  const found = routeFiles(root, route, io);
  if (!found) return { problems: [`${route}: no route.js.nft.json. Run npm run build first.`], traced: [] };
  const traced = [...new Set(found.files.map((path) => relative(root, path).split("\\").join("/")))];
  const problems = FACE_BENCH_FILES.filter((want) => !traced.includes(want)).map(
    (want) => `${route}: ${want} is not in the function (next.config.ts outputFileTracingIncludes).`,
  );
  return { problems, traced };
}

export type BenchLoad = { loaded?: boolean; backend?: string; simd?: boolean; threads?: boolean; detectS?: number; error?: string };

/**
 * Copy only the route's traced files from node_modules and lib into an empty directory, as the function holds
 * them, and run the timing child there on a blank 64 × 64 frame. Anything the child needs that the trace left
 * out fails here as it would on Vercel.
 */
export async function loadBenchFromTrace(root: string, traced: readonly string[], candidate: "wasm" | "tfjs-node"): Promise<BenchLoad> {
  const { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "face-bench-trace-"));
  try {
    for (const rel of traced) {
      if (!(rel.startsWith("node_modules/") || rel.startsWith("lib/"))) continue;
      const from = join(root, rel);
      if (!existsSync(from)) continue;
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      cpSync(from, join(dir, rel), { dereference: true });
    }
    const raw = join(dir, "blank.rgb");
    writeFileSync(raw, Buffer.alloc(64 * 64 * 3, 128));
    const child = join(dir, "lib", "creative-lab", "face-bench-child.cjs");
    if (!existsSync(child)) return { loaded: false, error: "face-bench-child.cjs is not in the function" };
    const model = join(dir, "node_modules", "@vladmandic", "face-api", "model");
    const out = execFileSync(process.execPath, [child, candidate, raw, "64", "64", model], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120_000 });
    return JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as BenchLoad;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
