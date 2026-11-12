/**
 * The uncompressed size of each Vercel function, read from the traces
 * `next build` writes beside every server entry (`*.js.nft.json`).
 *
 * Vercel refuses a deploy when one function is over 250 MB uncompressed.
 * #1186 took /api/admin/remotion/render-caption to 270.41 MB and production
 * stopped deploying. scripts/check-function-size.mts runs this after the CI
 * build on Ubuntu, so the Linux binaries (ffmpeg, sharp's libvips, the
 * compositor) are the ones measured, and fails above FUNCTION_SIZE_LIMIT_MB.
 *
 * MB here is 1,000,000 bytes. That reads higher than MiB, so the check
 * errs early. No `@/` imports: node --test cannot resolve them.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** Vercel's cap is 250 MB. The check fails at 230, before a deploy does. */
export const FUNCTION_SIZE_LIMIT_MB = 230;

export const MB = 1_000_000;

export type FunctionSize = {
  /** The route as the build names it, e.g. /api/admin/remotion/render-caption. */
  route: string;
  bytes: number;
  files: number;
  /** Every package (or top folders outside node_modules), biggest first. */
  parts: { name: string; bytes: number }[];
};

/**
 * Files that next.config.ts outputFileTracingIncludes must still add. The
 * in-process Remotion routes launch Chromium and read the serve bundle; a
 * tracing key that stops matching them would only show at render time.
 */
export const REQUIRED_PARTS: Record<string, string[]> = {
  "/api/admin/remotion/render": ["@sparticuz/chromium", ".remotion/bundle", "@remotion/renderer"],
  "/api/admin/remotion/render-reel": ["@sparticuz/chromium", ".remotion/bundle", "@remotion/renderer"],
};

type Io = {
  list: (dir: string) => { name: string; isDirectory: boolean }[];
  read: (file: string) => string;
  /** Size of a regular file, else null (missing, or a directory). */
  size: (file: string) => number | null;
};

const fsIo: Io = {
  list: (dir) => readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
  read: (file) => readFileSync(file, "utf8"),
  size: (file) => {
    try {
      const s = statSync(file);
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  },
};

function traces(dir: string, io: Io): string[] {
  const out: string[] = [];
  for (const entry of io.list(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) out.push(...traces(path, io));
    else if (entry.name.endsWith(".js.nft.json")) out.push(path);
  }
  return out;
}

/** node_modules/@scope/pkg or node_modules/pkg, else the first two folders of the path. */
export function packageOf(relPath: string): string {
  const m = relPath.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (m) return m[1]!;
  return relPath.split("/").slice(0, 2).join("/");
}

/** One function: the entry itself plus every file its trace lists, each counted once. */
export function functionSize(trace: string, root: string, appDir: string, io: Io = fsIo): FunctionSize {
  const { files } = JSON.parse(io.read(trace)) as { files: string[] };
  const entry = trace.replace(/\.nft\.json$/, "");
  const paths = new Set([resolve(entry), ...files.map((f) => resolve(dirname(trace), f))]);
  const byPackage = new Map<string, number>();
  let bytes = 0;
  for (const path of paths) {
    const size = io.size(path) ?? 0;
    bytes += size;
    const name = packageOf(relative(root, path));
    byPackage.set(name, (byPackage.get(name) ?? 0) + size);
  }
  const route = "/" + relative(appDir, dirname(entry)).split("\\").join("/");
  const parts = [...byPackage].map(([name, b]) => ({ name, bytes: b })).sort((a, b) => b.bytes - a.bytes);
  return { route, bytes, files: paths.size, parts };
}

/** Every app route and page the build traced, biggest first. */
export function functionSizes(root: string, io: Io = fsIo): FunctionSize[] {
  const appDir = join(root, ".next", "server", "app");
  return traces(appDir, io)
    .map((trace) => functionSize(trace, root, appDir, io))
    .sort((a, b) => b.bytes - a.bytes);
}

export function overLimit(sizes: FunctionSize[], limitMb: number = FUNCTION_SIZE_LIMIT_MB): FunctionSize[] {
  return sizes.filter((s) => s.bytes > limitMb * MB);
}

/** Each required route that is missing, or traced without one of its parts. */
export function missingParts(sizes: FunctionSize[], required: Record<string, string[]> = REQUIRED_PARTS): string[] {
  const out: string[] = [];
  for (const [route, names] of Object.entries(required)) {
    const size = sizes.find((s) => s.route === route);
    if (!size) {
      out.push(`${route}: no trace`);
      continue;
    }
    const have = new Set(size.parts.filter((p) => p.bytes > 0).map((p) => p.name));
    for (const name of names) if (!have.has(name)) out.push(`${route}: ${name} is not traced`);
  }
  return out;
}

export function formatMb(bytes: number): string {
  return `${(bytes / MB).toFixed(2)} MB`;
}
