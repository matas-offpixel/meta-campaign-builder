/**
 * Regression guard: client-archived checks go through lib/db/client-status.ts.
 *
 * `"archived"` is also a draft, plan, audience, ad plan, landing page and
 * TikTok status, so a bare literal ban would fail on ~50 legitimate files.
 * A literal is a client-status literal when its line mentions "client", or
 * when the nearest `.from("…")` within LOOKBACK_LINES above it is `clients`.
 */

import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const LOOKBACK_LINES = 40;
const LITERAL = /["'`]archived["'`]/g;

function clientStatusLiterals(file: string, src: string): string[] {
  const out: string[] = [];
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    LITERAL.lastIndex = 0;
    if (!LITERAL.test(line)) return;
    if (/client/i.test(line)) {
      out.push(`${file}:${i + 1}: ${line.trim()}`);
      return;
    }
    const window = lines.slice(Math.max(0, i - LOOKBACK_LINES), i + 1).join("\n");
    const tables = [...window.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g)];
    if (tables.at(-1)?.[1] === "clients") out.push(`${file}:${i + 1}: ${line.trim()}`);
  });
  return out;
}

function sourceFiles(): string[] {
  return execSync("git ls-files -co --exclude-standard -- '*.ts' '*.tsx'", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter(
      (f) =>
        f !== "lib/db/client-status.ts" &&
        !f.includes("node_modules/") &&
        !f.includes("/__tests__/") &&
        !f.startsWith("supabase/") &&
        !f.startsWith("scripts/out/") &&
        !f.endsWith("database.types.ts"),
    );
}

describe("client-status literal guard", () => {
  it("the rules catch an inline client-archived check", () => {
    assert.equal(clientStatusLiterals("x.ts", `if (client.status === "archived") {}`).length, 1);
    assert.equal(
      clientStatusLiterals("x.ts", `await sb\n  .from("clients")\n  .select("id")\n  .neq("status", "archived");`).length,
      1,
    );
    assert.equal(
      clientStatusLiterals("x.ts", `await sb.from("campaign_drafts").update({ status: "archived" });`).length,
      0,
    );
  });

  it("no client-status 'archived' literal outside lib/db/client-status.ts", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      offenders.push(...clientStatusLiterals(file, src));
    }
    assert.deepEqual(offenders, [], `use ARCHIVED / activeClientFilter from lib/db/client-status.ts:\n${offenders.join("\n")}`);
  });

  it("the helper owns the literal", () => {
    const src = readFileSync("lib/db/client-status.ts", "utf8");
    assert.match(src, /export const ARCHIVED = "archived" as const;/);
    assert.match(src, /query\.neq\("status", ARCHIVED\)/);
    const imports = src.split("\n").filter((line) => line.startsWith("import "));
    assert.deepEqual(imports, ['import type { SupabaseClient } from "@supabase/supabase-js";']);
  });
});
