/**
 * Public surfaces must not reach the copy library. Modelled on the
 * client-status guard: follow @/ and relative imports from the share,
 * landing, client-admin and webhook trees, and fail if a reachable file
 * imports the cross-client module or names copy_performance or ad_copy.
 * Every other importer of that module has to call requireOperator(.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const ROOTS = ["app/share/", "app/l/", "app/admin/[clientSlug]/", "app/c/", "app/j/", "app/api/share/", "app/api/l/", "app/api/webhooks/"];
const IMPORT_FROM = /(?:import|export)\s+(?:type\s+)?[^'"\n]*?\sfrom\s+["']([^"']+)["']/g;
const IMPORT_SIDE = /import\s+["']([^"']+)["']/g;
const IMPORT_DYNAMIC = /import\(\s*["']([^"']+)["']\s*\)/g;

function sourceFiles(): string[] {
  return execSync("git ls-files -co --exclude-standard -- '*.ts' '*.tsx'", { encoding: "utf8" })
    .split("\n")
    .filter((file) => file && !file.includes("node_modules/") && !file.startsWith("scripts/out/"));
}

function specs(src: string): string[] {
  const out: string[] = [];
  for (const pattern of [IMPORT_FROM, IMPORT_SIDE, IMPORT_DYNAMIC]) {
    pattern.lastIndex = 0;
    for (const match of src.matchAll(pattern)) out.push(match[1]!);
  }
  return out;
}

function resolveImport(fromFile: string, spec: string): string | null {
  let target = spec;
  if (spec.startsWith("@/")) target = spec.slice(2);
  else if (spec.startsWith(".")) target = path.normalize(path.join(path.dirname(fromFile), spec));
  else return null;
  const candidates = [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts"), path.join(target, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function reachable(): Map<string, string> {
  const files = sourceFiles();
  const start = files.filter((file) => ROOTS.some((root) => file.startsWith(root)));
  const seen = new Map<string, string>();
  const queue = [...start];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    seen.set(file, src);
    for (const spec of specs(src)) {
      const next = resolveImport(file, spec);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

/**
 * The Google drawer field key `ad_copy` is a section alias, not the table.
 * The Insights rail (components/insights, lib/insights) reads through the
 * cross-client module, so it is operator-only too (R3).
 */
function namesCopyLibrary(src: string): boolean {
  return (
    /learning\/cross-client/.test(src) ||
    /\bcopy_performance\b/.test(src) ||
    /(["'`])ad_copy\1/.test(src) ||
    /components\/insights-rail\//.test(src) ||
    /lib\/insights-rail\//.test(src) ||
    /api\/insights-rail/.test(src)
  );
}

describe("cross-client copy guard", () => {
  it("share, landing, client admin and webhooks cannot reach the copy library", () => {
    const hits: string[] = [];
    for (const [file, src] of reachable()) {
      if (namesCopyLibrary(src)) hits.push(file);
    }
    assert.deepEqual(hits, []);
  });

  it("the Insights rail is mounted by the operator layout only (R3)", () => {
    const mounts = sourceFiles().filter((file) => {
      if (file.startsWith("components/insights-rail/") || file.startsWith("scripts/plan-frames/") || file.includes("__tests__")) return false;
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        return false;
      }
      return /<InsightsRail\b/.test(src);
    });
    assert.deepEqual(mounts, ["app/(dashboard)/layout.tsx"]);
    const layouts = sourceFiles().filter((file) => /^app\/(admin|share|l|c|j)\/.*layout\.tsx$/.test(file));
    for (const file of layouts) {
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(src, /insights/i, file);
    }
  });

  it("every importer of lib/learning/cross-client/ calls requireOperator(", () => {
    const misses: string[] = [];
    for (const file of sourceFiles()) {
      if (file.startsWith("lib/learning/cross-client/")) continue;
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const importsModule = specs(src).some((spec) => spec.includes("learning/cross-client") || spec.includes("/cross-client"));
      if (importsModule && !src.includes("requireOperator(")) misses.push(file);
    }
    assert.deepEqual(misses, []);
  });
});
