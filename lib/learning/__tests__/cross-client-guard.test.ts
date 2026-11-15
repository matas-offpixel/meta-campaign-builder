/**
 * Public surfaces must not reach the copy library. Modelled on the
 * client-status guard: follow @/ and relative imports from the share,
 * landing, client-admin and webhook trees, and fail if a reachable file
 * imports the cross-client module or names copy_performance,
 * copy_features or ad_copy.
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
    /\bcopy_features\b/.test(src) ||
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

  it("the build-2 readers live in the cross-client module and only the rail route reaches them (issue 2 guard)", () => {
    const readers = /\b(railClusterRows|railTikTokRows|sumLatestWindows)\b/;
    const users = sourceFiles().filter((file) => {
      if (file.includes("__tests__")) return false;
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        return false;
      }
      return readers.test(src);
    });
    assert.deepEqual(users, ["lib/learning/cross-client/index.ts", "lib/learning/cross-client/rail.ts"]);
    // The rail is the only thing outside the learning loop that reads live_evidence or the TikTok breakdown table for a page.
    for (const [file, src] of reachable()) {
      assert.doesNotMatch(src, /railData|railClusterRows|railTikTokRows/, file);
    }
  });

  it("the audience-builder and TikTok contexts are declared under the operator layout only (issue 2 guard)", () => {
    const declared = sourceFiles().filter((file) => {
      if (file.includes("__tests__") || file.startsWith("scripts/plan-frames/") || file.startsWith("components/insights-rail/")) return false;
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        return false;
      }
      return /surface=\{?"?(audience_builder|tiktok_campaign)|drawerFromQuery === "tt" \? "tiktok_campaign"/.test(src);
    });
    assert.ok(declared.length >= 3, declared.join(", "));
    for (const file of declared) assert.match(file, /^app\/\(dashboard\)\//, file);
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
