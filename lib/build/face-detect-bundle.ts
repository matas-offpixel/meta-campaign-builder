/**
 * Checks, on the real `next build` output, that the render tick can load the
 * face detector the way production does.
 *
 * lib/creative-lab/face-detect.ts loads face-api's Node wasm build with a
 * runtime `import()` of a file URL. Turbopack cannot analyse a computed import, and
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
export const FACE_DETECT_MARKER = "face-detect: the wasm backend didn't start";
/** Turbopack's replacement for an import it cannot analyse. */
export const TOO_DYNAMIC = "expression is too dynamic";
/** What face-detect.ts loads at runtime, which no import reaches, so next.config.ts includes it by hand. */
export const FACE_API_FILES = [
  "node_modules/@vladmandic/face-api/dist/face-api.node-wasm.js",
  "node_modules/@vladmandic/face-api/model/ssd_mobilenetv1_model.bin",
  "node_modules/@vladmandic/face-api/model/face_landmark_68_model.bin",
  "node_modules/@tensorflow/tfjs/dist/tf.node.js",
  "node_modules/@tensorflow/tfjs-core/dist/tf-core.node.js",
  "node_modules/@tensorflow/tfjs-backend-wasm/dist/tf-backend-wasm.node.js",
  "node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm",
  "node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm",
] as const;

export type Io = { exists(path: string): boolean; read(path: string): string };
const fsIo: Io = { exists: existsSync, read: (path) => readFileSync(path, "utf8") };

export type BundleCheck = {
  problems: string[];
  chunk: string | null;
  files: number;
  /** The route's traced files, relative to the root. */
  traced: string[];
};

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
  if (!found) return { problems: [`${route}: no route.js.nft.json. Run npm run build first.`], chunk: null, files: 0, traced: [] };
  const problems: string[] = [];
  const rel = [...new Set(found.files.map((path) => relative(root, path).split("\\").join("/")))];
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
  return { problems, chunk: chunk ? relative(root, chunk) : null, files: found.files.length, traced: rel };
}

export type DetectorLoad = {
  backend?: string;
  simd?: boolean | null;
  threads?: boolean | null;
  fallback?: string | null;
  /** The face-api file face-detect.ts loaded: it must be the traced copy. */
  main?: string;
  faces?: number;
  error?: string;
};

/**
 * Copy only the route's traced node_modules into an empty directory, as the function holds them, and run the
 * real face-detect.ts there on face-api's own sample photo (the function's working directory is where the
 * traced node_modules sit, so face-detect.ts loads face-api from the copy, and face-api's requires resolve
 * only inside it). Anything the trace left out fails here as it would on Vercel.
 */
export async function loadDetectorFromTrace(root: string, traced: readonly string[]): Promise<DetectorLoad & { dir: string }> {
  const { cpSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  // Real path: the child's process.cwd() is one (macOS's tmpdir is behind a symlink).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "face-detect-trace-")));
  try {
    for (const rel of traced) {
      if (!rel.startsWith("node_modules/")) continue;
      const from = join(root, rel);
      if (!existsSync(from)) continue;
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      cpSync(from, join(dir, rel), { dereference: true });
    }
    const probe = join(dir, "probe.mjs");
    writeFileSync(probe, [
      'import { readFileSync } from "node:fs";',
      `const m = await import(${JSON.stringify(pathToFileURL(join(root, "lib", "creative-lab", "face-detect.ts")).href)});`,
      "const out = { main: m.faceApiMain() };",
      "try {",
      `  const faces = await m.detectFaces(readFileSync(${JSON.stringify(join(root, "node_modules", "@vladmandic", "face-api", "demo", "sample1.jpg"))}));`,
      "  Object.assign(out, await m.faceBackend(), { faces: faces.length });",
      "} catch (err) { out.error = String(err?.message ?? err).split(\"\\n\")[0]; }",
      "console.log(JSON.stringify(out));",
    ].join("\n"));
    const stdout = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", probe], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
    return { ...(JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as DetectorLoad), dir };
  } catch (err) {
    return { error: (err instanceof Error ? err.message : String(err)).split("\n")[0], dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
