import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";

/**
 * Regression guard for the video-thumbnail cost-reduction PR: the ONLY
 * place allowed to call Meta's `/{video_id}/thumbnails` Graph edge is
 * `lib/meta/video-thumbnail-cache.ts` (`fetchThumbnailUrl` /
 * `fetchThumbnailUrlsBatch`). Every other consumer (active-creatives
 * enrichment, the ad_id thumbnail proxy's video fallback, the audience
 * builder video picker) must route through it so a `video_id` is never
 * re-fetched from Meta once cached in Storage.
 *
 * Scans every `.ts`/`.tsx` source file under `lib/` and `app/` (excluding
 * tests, docs, and the allowed helper itself) for the interpolated-path
 * call shape `` `/${...}/thumbnails` `` or the nested batched-field shape
 * `"thumbnails{"` — both indicate a raw, uncached Graph call.
 */

const REPO_ROOT = process.cwd();
const SCAN_DIRS = ["lib", "app"];
const ALLOWED_FILES = new Set([
  join(REPO_ROOT, "lib", "meta", "video-thumbnail-cache.ts"),
]);
const VIOLATION_PATTERNS = [
  /\$\{[^}]+\}\/thumbnails[`'"]/,
  /thumbnails\{uri/,
];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("no raw Meta /{video_id}/thumbnails calls outside video-thumbnail-cache.ts", () => {
  it("every scanned source file is either the allowed helper or violation-free", () => {
    const files = SCAN_DIRS.flatMap((d) =>
      collectSourceFiles(join(REPO_ROOT, d)),
    );
    assert.ok(files.length > 100, "sanity check: expected to scan many files");

    const violations: string[] = [];
    for (const file of files) {
      if (ALLOWED_FILES.has(file)) continue;
      const contents = readFileSync(file, "utf8");
      for (const pattern of VIOLATION_PATTERNS) {
        if (pattern.test(contents)) {
          violations.push(`${relative(REPO_ROOT, file).split(sep).join("/")} matches ${pattern}`);
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Raw /{video_id}/thumbnails call(s) found outside lib/meta/video-thumbnail-cache.ts:\n${violations.join("\n")}`,
    );
  });

  it("the allowed helper is the one that actually calls the edge", () => {
    const helper = readFileSync(
      join(REPO_ROOT, "lib", "meta", "video-thumbnail-cache.ts"),
      "utf8",
    );
    assert.match(helper, /\$\{videoId\}\/thumbnails/);
  });
});
