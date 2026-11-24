/**
 * M1 is read-only: outside the action log (mcp_actions) and the OAuth
 * store (mcp_oauth_*), nothing the MCP reaches writes anything. A grep over
 * every file the MCP server and its tools import (relative and `@/`, walked
 * transitively), plus the routes, and a check of migration 268.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), "../../.."));
const WRITE = /\.(insert|update|upsert|delete|rpc)\s*\(/g;
const NETWORK = /\b(fetch|graphPost|graphPostWithToken|graphDelete)\s*\(/;

/** The only files allowed a write, and the only tables each may write. */
const ALLOWED_WRITERS: Record<string, RegExp> = {
  "lib/mcp/action-log.ts": /^mcp_actions$/,
  "lib/mcp/oauth/store.ts": /^mcp_oauth_(clients|grants|codes|tokens)$/,
};

const ENTRIES = [
  "lib/mcp/server.ts",
  "lib/mcp/tools/index.ts",
  "lib/mcp/readers.ts",
  "lib/mcp/route-deps.ts",
  "lib/mcp/oauth/http.ts",
  "app/api/mcp/route.ts",
  "app/api/oauth/register/route.ts",
  "app/api/oauth/token/route.ts",
  "app/api/oauth/revoke/route.ts",
  "app/oauth/authorize/page.tsx",
  "app/oauth/authorize/actions.ts",
  "app/.well-known/oauth-protected-resource/route.ts",
  "app/.well-known/oauth-protected-resource/api/mcp/route.ts",
  "app/.well-known/oauth-authorization-server/route.ts",
];

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = join(ROOT, dirname(from), spec);
  else return null;
  const rel = (p: string) => p.slice(ROOT.length + 1);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (/\.(ts|tsx)$/.test(cand) && existsSync(cand)) return rel(cand);
  }
  return null;
}

function walk(): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [...ENTRIES];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const src = readFileSync(join(ROOT, file), "utf8");
    seen.set(file, src);
    // Value imports only: `import type` brings no code.
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+["']([^"']+)["']/gm)) {
      const next = resolve(file, m[1]!);
      if (next) queue.push(next);
    }
    for (const m of src.matchAll(/await import\(\s*["']([^"']+)["']\s*\)/g)) {
      const next = resolve(file, m[1]!);
      if (next) queue.push(next);
    }
  }
  return seen;
}

/** Every function the MCP imports from outside lib/mcp, by file. Each one is a reader. */
const EXTERNAL_READERS: Record<string, readonly string[]> = {
  "lib/db/paged-read.ts": ["loadAllPaged"],
  "lib/db/client-status.ts": ["dropArchivedClientRows", "loadArchivedClientIds"],
  "lib/db/event-daily-rollups.ts": ["listRollupsForEvent"],
  "lib/db/signup-source-snapshots.ts": ["loadCirqlinSnapshotsForEvent"],
  "lib/db/ticketing.ts": ["listAllSnapshotsForEvent"],
  "lib/cirqlin/page-audience/read.ts": ["pageAudienceForShow"],
  "lib/learning/findings/phase.ts": ["phaseOf"],
  "lib/learning/findings/observed-tests.ts": ["addDays"],
  "lib/learning/findings/read-all.ts": ["all", "chunks"],
  "lib/learning/findings/digest.ts": ["learningLine", "showLine", "testLine"],
  "lib/onsale-refresh/on-sale.ts": ["isShowWeek"],
  "lib/autosave.ts": ["migrateDraft"],
  "lib/auth/operator-allowlist.ts": ["isOperator", "MATAS_USER_IDS"],
  "lib/supabase/server.ts": ["createServiceRoleClient", "createClient"],
  "components/ui/button.tsx": ["Button"],
};

const isOwn = (f: string) => f.startsWith("lib/mcp/") || f.startsWith("app/") || f.startsWith("components/mcp/");

function importsOf(file: string, src: string): Array<{ target: string; names: string[] }> {
  const out: Array<{ target: string; names: string[] }> = [];
  for (const m of src.matchAll(/^\s*import\s+(?!type\b)\{([^}]*)\}\s*from\s+["']([^"']+)["']/gm)) {
    const target = resolve(file, m[2]!);
    if (!target) continue;
    const names = m[1]!
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n && !n.startsWith("type "))
      .map((n) => n.split(/\s+as\s+/)[0]!.trim());
    out.push({ target, names });
  }
  return out;
}

/** The body of one exported function (to the next top-level export). */
function bodyOf(src: string, name: string): string | null {
  const m = new RegExp(`export (?:async )?function ${name}\\b|export const ${name}\\b`).exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const next = rest.slice(1).search(/\nexport /);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the MCP's own code writes only mcp_actions and mcp_oauth_*", () => {
  const own = [...walk().entries()].filter(([f]) => isOwn(f));
  const hits: string[] = [];
  for (const [file, src] of own) {
    // Hash.update() in crypto.ts is not a write.
    const code = strip(src).replace(/createHash\([^)]*\)\s*\.update\(/g, "createHash().digestOf(");
    const writes = [...code.matchAll(WRITE)];
    if (writes.length === 0) continue;
    const allowed = ALLOWED_WRITERS[file];
    if (!allowed) {
      hits.push(`${file}: ${writes.map((w) => w[0]).join(", ")}`);
      continue;
    }
    for (const m of code.matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g)) {
      if (!allowed.test(m[1]!)) hits.push(`${file}: from("${m[1]}")`);
    }
  }
  assert.deepEqual(hits, []);
});

test("from outside lib/mcp the MCP imports only reader functions, and none of them writes", () => {
  const own = [...walk().entries()].filter(([f]) => isOwn(f));
  const unexpected: string[] = [];
  const used = new Map<string, Set<string>>();
  for (const [file, src] of own) {
    for (const { target, names } of importsOf(file, src)) {
      if (isOwn(target)) continue;
      const allowed = EXTERNAL_READERS[target];
      for (const n of names) {
        if (!allowed?.includes(n)) unexpected.push(`${file} imports ${n} from ${target}`);
        else (used.get(target) ?? used.set(target, new Set()).get(target)!).add(n);
      }
    }
  }
  assert.deepEqual(unexpected, []);
  const writers: string[] = [];
  for (const [target, names] of used) {
    const src = readFileSync(join(ROOT, target), "utf8");
    for (const n of names) {
      const body = bodyOf(src, n);
      assert.ok(body, `${n} in ${target}`);
      if (WRITE.test(strip(body!))) writers.push(`${target}#${n}`);
      WRITE.lastIndex = 0;
    }
  }
  assert.deepEqual(writers, []);
});

test("the tools and the server make no network calls and import no write paths", () => {
  const files = walk();
  const hits: string[] = [];
  for (const [file, src] of files) {
    if (!isOwn(file)) continue;
    if (NETWORK.test(src)) hits.push(`${file}: network`);
    if (/from\s+["'](@\/|\.\.?\/)+.*\b(meta\/(?!.*read)|tiktok\/|google-ads\/|notify\/|d2c\/|actions\/)/.test(src)) hits.push(`${file}: write-path import`);
  }
  assert.deepEqual(hits, []);
});

test("every tool is registered read-only", () => {
  const server = readFileSync(join(ROOT, "lib/mcp/server.ts"), "utf8");
  assert.match(server, /readOnlyHint: true, destructiveHint: false/);
  assert.match(server, /kind: "read"/);
});

test("migration 268: six service-role-only tables, RLS on, no policies, hashes only", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/268_mcp_actions.sql"), "utf8");
  const tables = ["mcp_oauth_clients", "mcp_oauth_grants", "mcp_oauth_codes", "mcp_oauth_tokens", "mcp_actions", "client_spend_ceilings"];
  for (const t of tables) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t} \\(`), t);
    assert.match(sql, new RegExp(`alter table public\\.${t}\\s+enable row level security;`), t);
    assert.match(sql, new RegExp(`revoke all on public\\.${t}\\s+from anon, authenticated;`), t);
  }
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /\b(drop table|truncate|alter table [^;]* drop column)\b/i, "additive only");
  // Codes and tokens are stored as SHA-256 hex, never plaintext.
  assert.match(sql, /code_hash\s+text\s+primary key check \(code_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sql, /token_hash\s+text\s+primary key check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.doesNotMatch(sql, /\b(access_token|refresh_token|client_secret)\s+text/);
  // The plan's columns on mcp_actions.
  for (const col of ["user_id", "client_id", "event_id", "tool", "args", "kind", "status", "approved_by", "approved_at", "approval_source", "result", "error", "created_at", "updated_at", "duration_ms", "result_bytes"]) {
    assert.match(sql, new RegExp(`\\n  ${col}\\s`), col);
  }
  assert.match(sql, /kind in \('read', 'draft', 'meta'\)/);
  assert.match(sql, /status in \('requested', 'approved', 'rejected', 'done', 'failed'\)/);
  assert.match(sql, /approval_source in \('claude_prompt', 'today'\)/);
  assert.match(sql, /daily_gbp\s+numeric\s+not null/);
});

test("the proxy opens exactly the MCP paths", async () => {
  const { MCP_PUBLIC_PATHS, isPublicPath } = await import("../../auth/public-routes.ts");
  assert.deepEqual([...MCP_PUBLIC_PATHS].sort(), [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/api/mcp",
    "/api/mcp",
    "/api/oauth/register",
    "/api/oauth/revoke",
    "/api/oauth/token",
    "/oauth/authorize",
  ]);
  assert.equal(isPublicPath("/api/mcpx"), false);
  assert.equal(isPublicPath("/api/mcp/anything"), false);
  assert.equal(isPublicPath("/api/oauth/other"), false);
});
