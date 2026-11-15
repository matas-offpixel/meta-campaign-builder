/**
 * Module resolve hooks for node --test files that exercise loaders written
 * against the `@/` alias. Register once at the top of a test file:
 *
 *   register(new URL("../../__tests__/support/alias-hooks.mjs", import.meta.url));
 *   const { fn } = await import("../loader.ts");
 *
 * - `@/x` and extensionless relative paths resolve to `.ts`/`.tsx` files.
 * - `@/lib/supabase/server` and `@/lib/supabase/client` resolve to
 *   supabase-stub.ts, whose clients are whatever the test put on
 *   `globalThis.__supabaseStub`.
 * - Bare subpaths without an exports map (`next/headers`) get `.js`.
 *
 * node --test runs every file in its own process, so these hooks never
 * leak into another test file.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const STUB = pathToFileURL(path.join(ROOT, "lib/__tests__/support/supabase-stub.ts")).href;
const STUBBED = new Set(["@/lib/supabase/server", "@/lib/supabase/client"]);

function isFile(candidate) {
  return existsSync(candidate) && !statSync(candidate).isDirectory();
}

function findFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (STUBBED.has(specifier)) return { url: STUB, shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const hit = findFile(path.join(ROOT, specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    if (!isFile(base)) {
      const hit = findFile(base);
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
    }
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" && !specifier.startsWith(".") && !specifier.endsWith(".js")) {
      return next(`${specifier}.js`, context);
    }
    throw err;
  }
}
