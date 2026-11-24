/**
 * The SDK ships express, hono and the Node HTTP adapters as dependencies.
 * The MCP route must reach none of them: it imports the web-standard
 * transport and McpServer only. This walks the SDK's own ESM import graph
 * from exactly what lib/mcp imports and fails on any express / hono /
 * cors / node-server import.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), "../../.."));
const SDK = join(ROOT, "node_modules/@modelcontextprotocol/sdk/dist/esm");
const FORBIDDEN = /^(express|express-rate-limit|hono|@hono\/node-server|cors|eventsource|cross-spawn)(\/|$)/;

function mcpSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : mcpSources(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

test("lib/mcp imports only the SDK's McpServer and web-standard transport", () => {
  const specs = new Set<string>();
  for (const file of [...mcpSources(join(ROOT, "lib/mcp")), join(ROOT, "app/api/mcp/route.ts")]) {
    for (const m of readFileSync(file, "utf8").matchAll(/from\s+["'](@modelcontextprotocol\/sdk[^"']*)["']/g)) specs.add(m[1]!);
  }
  assert.deepEqual([...specs].sort(), ["@modelcontextprotocol/sdk/server/mcp.js", "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"]);
});

test("the SDK files the route reaches import no express, hono or node adapters", () => {
  const queue = [join(SDK, "server/mcp.js"), join(SDK, "server/webStandardStreamableHttp.js")];
  const seen = new Set<string>();
  const bare = new Set<string>();
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = (m[1] ?? m[2])!;
      if (spec.startsWith(".")) {
        const next = join(dirname(file), spec);
        if (existsSync(next)) queue.push(next);
      } else {
        bare.add(spec);
      }
    }
  }
  assert.ok(seen.size > 5, `walked ${seen.size} SDK files`);
  const bad = [...bare].filter((s) => FORBIDDEN.test(s));
  assert.deepEqual(bad, [], `SDK imports reached by the route: ${[...bare].sort().join(", ")}`);
});
