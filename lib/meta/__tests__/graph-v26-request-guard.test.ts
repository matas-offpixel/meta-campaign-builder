import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";

/**
 * Graph API v26 removed the `ids` multi-read, and on 27 Oct 2026 Meta
 * removes that query parameter on every version. The replacement is
 * `graphMultiGetByIds` (and the pure builder in graph-multi-get-parse).
 * Nothing else may pass `ids` to `graphGet` / `graphGetWithToken`, or
 * put `?ids=` / `&ids=` on a Graph URL.
 *
 * The same scan rejects Graph requests that set `pretty`, `debug` or
 * `date_format`, or send `If-None-Match`. `/debug_token` is a path, not
 * a `debug` query param. Our own `/api/meta/interest-suggestions?debug=1`
 * is not a Graph request; comments are stripped before the scan so that
 * note does not trip the URL pattern.
 */

const REPO_ROOT = process.cwd();
const SCAN_DIRS = ["lib", "app", "scripts"];
const IDS_ALLOWED = new Set([
  join(REPO_ROOT, "lib", "meta", "graph-multi-get.ts"),
  join(REPO_ROOT, "lib", "meta", "graph-multi-get-parse.ts"),
]);

const IDS_CALL = /\bgraphGet(?:WithToken)?\s*(?:<[^>\n]*>)?\s*\(\s*[^,)]*,\s*\{[^}]*\bids\s*:/;

/** A Graph URL, not a sentence that mentions the removed parameter. */
function hasIdsUrl(code: string): boolean {
  const lines = code.split("\n");
  const aimed = /(?:https?:\/\/\S*|graph\.facebook\.com\S*|[`"']\/\S*)[?&]ids=/;
  return lines.some((line) => aimed.test(line));
}
const GRAPH_QUERY = /[?&](?:pretty|debug|date_format)=|searchParams\s*\.\s*(?:set|append)\(\s*["'](?:pretty|debug|date_format)["']/;
const GRAPH_QUERY_KEY = /\b(?:graphGetWithToken|graphPostWithToken|graphGet|graphPost|graphMultiGetByIds)\s*(?:<[^>\n]*>)?\s*\([^)]{0,400}\b(?:pretty|debug|date_format)\s*:/;
const IF_NONE_MATCH = /If-None-Match/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "__tests__" || entry === "out" || entry.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx|mts)$/.test(entry) && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Drop block comments and line comments, keeping `https://` intact. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Graph requests do not use removed or heavy query params", () => {
  it("no ids multi-read, and no pretty, debug, date_format, or If-None-Match", () => {
    const files = SCAN_DIRS.flatMap((d) => collectSourceFiles(join(REPO_ROOT, d)));
    assert.ok(files.length > 100, "sanity check: expected to scan many files");

    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).split(sep).join("/");
      const code = stripComments(readFileSync(file, "utf8"));
      if (!IDS_ALLOWED.has(file)) {
        if (IDS_CALL.test(code)) violations.push(`${rel} passes ids to graphGet`);
        if (hasIdsUrl(code)) violations.push(`${rel} has a ?ids= / &ids= URL`);
      }
      if (GRAPH_QUERY.test(code) || GRAPH_QUERY_KEY.test(code)) {
        violations.push(`${rel} sets pretty, debug, or date_format on a Graph request`);
      }
      if (IF_NONE_MATCH.test(code)) violations.push(`${rel} sends If-None-Match`);
    }

    assert.deepEqual(violations, [], violations.join("\n"));
  });

  it("the batch reader is what production uses for ad set facts", () => {
    const route = readFileSync("app/api/cron/ad-daily-insights/route.ts", "utf8");
    assert.match(route, /graphMultiGetByIds/);
    assert.match(route, /multiGet:/);
    for (const script of [
      "scripts/backfill-insights-objective.mts",
      "scripts/backfill-ad-daily-insights.mts",
    ]) {
      assert.match(readFileSync(script, "utf8"), /graphMultiGetByIds/);
    }
    const adset = readFileSync("lib/ad-daily-insights/adset-meta.ts", "utf8");
    assert.match(adset, /multiGet\(\s*"\/",\s*\{\s*ids:/);
    assert.doesNotMatch(adset, /\bgraphGet\b/);
  });
});
