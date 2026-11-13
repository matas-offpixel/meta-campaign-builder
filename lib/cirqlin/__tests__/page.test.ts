import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cirqlinPageUrl, lookupCirqlinPage, type CirqlinPageQuery } from "../page.ts";

const SECRET = "test-partner-secret-6f1c";
const BASE = "https://cirqlin.example";
const PAGE = { id: "5f3c2a10-8b7e-4d21-9c64-0e1a2b3c4d5e", slug: "ipc-newcastle-nov", title: "Interplanetary Criminal · Newcastle", custom_domain: null };

type Call = { url: URL; init: RequestInit | undefined };

function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const lookup = (q: CirqlinPageQuery, fetchImpl: typeof fetch) => lookupCirqlinPage(q, { fetchImpl, secret: SECRET, base: BASE });

describe("lookupCirqlinPage: the request", () => {
  for (const [name, url] of [
    ["crqln.com/{slug}", "crqln.com/ipc-newcastle-nov"],
    ["app.cirqlin.com/l/{slug}", "https://app.cirqlin.com/l/ipc-newcastle-nov"],
    ["the editor /pages/{id}", "https://app.cirqlin.com/pages/5f3c2a10-8b7e-4d21-9c64-0e1a2b3c4d5e"],
    ["a custom domain", "https://tickets.example-promoter.co.uk/"],
    ["a custom domain with www", "https://www.example-promoter.co.uk/lineup?utm_source=ig"],
  ] as const) {
    it(`sends ${name} as ?url=, exactly as pasted (trimmed)`, async () => {
      const calls: Call[] = [];
      const found = await lookup({ url: `  ${url} ` }, fakeFetch(200, PAGE, calls));
      assert.equal(found.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url.origin + calls[0]!.url.pathname, `${BASE}/api/partner/page`);
      assert.equal(calls[0]!.url.searchParams.get("url"), url);
      assert.equal(calls[0]!.url.searchParams.has("id"), false);
    });
  }

  it("sends a stored page id as ?id=, never ?url=", async () => {
    const calls: Call[] = [];
    await lookup({ id: PAGE.id.toUpperCase() }, fakeFetch(200, PAGE, calls));
    assert.equal(calls[0]!.url.searchParams.get("id"), PAGE.id);
    assert.equal(calls[0]!.url.searchParams.has("url"), false);
  });

  it("sends the bearer, asks for no-store, and returns the page", async () => {
    const calls: Call[] = [];
    const found = await lookup({ url: "crqln.com/ipc-newcastle-nov" }, fakeFetch(200, PAGE, calls));
    const headers = calls[0]!.init?.headers as Record<string, string>;
    assert.equal(headers.authorization, `Bearer ${SECRET}`);
    assert.equal(calls[0]!.init?.cache, "no-store");
    assert.deepEqual(found, { ok: true, page: { id: PAGE.id, slug: PAGE.slug, title: PAGE.title, customDomain: null } });
  });

  it("keeps the custom domain CIRQLIN returns", async () => {
    const found = await lookup({ url: "www.example-promoter.co.uk" }, fakeFetch(200, { ...PAGE, custom_domain: "example-promoter.co.uk" }));
    assert.equal(found.ok && found.page.customDomain, "example-promoter.co.uk");
  });

  it("uses https://app.cirqlin.com when no base is set", () => {
    assert.equal(cirqlinPageUrl("https://app.cirqlin.com", { id: PAGE.id }), `https://app.cirqlin.com/api/partner/page?id=${PAGE.id}`);
  });
});

describe("lookupCirqlinPage: failures save nothing upstream", () => {
  for (const [status, body, reason] of [
    [404, { error: "no_page" }, "no_page"],
    [401, { error: "unauthorized" }, "unauthorized"],
    [500, { error: "read_failed" }, "read_failed"],
    [429, { error: "rate_limited", retryAfterSeconds: 600 }, "rate_limited"],
    [400, { error: "bad_request" }, "read_failed"],
    [502, "<html>bad gateway</html>", "read_failed"],
  ] as const) {
    it(`${status} → ${reason}`, async () => {
      const found = await lookup({ url: "crqln.com/x" }, fakeFetch(status, body));
      assert.deepEqual(found, { ok: false, reason, status });
    });
  }

  it("the shared-budget 429 is its own reason, so the panel can say to wait", async () => {
    const found = await lookup({ id: PAGE.id }, fakeFetch(429, { error: "rate_limited", retryAfterSeconds: 412 }));
    assert.equal(!found.ok && found.reason, "rate_limited");
  });

  it("a 200 that isn't a page is read_failed", async () => {
    const found = await lookup({ url: "crqln.com/x" }, fakeFetch(200, { id: "not-a-uuid", slug: "x", title: "X" }));
    assert.deepEqual(found, { ok: false, reason: "read_failed", status: 200 });
  });

  it("a network failure or timeout is read_failed, never a throw", async () => {
    const throwing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    assert.deepEqual(await lookup({ url: "crqln.com/x" }, throwing), { ok: false, reason: "read_failed" });
  });

  it("no secret configured: unauthorized, and CIRQLIN is never called", async () => {
    const calls: Call[] = [];
    const found = await lookupCirqlinPage({ url: "crqln.com/x" }, { fetchImpl: fakeFetch(200, PAGE, calls), secret: " ", base: BASE });
    assert.deepEqual(found, { ok: false, reason: "unauthorized" });
    assert.equal(calls.length, 0);
  });
});

describe("lookupCirqlinPage: the secret is never logged", () => {
  const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
  let originals: Partial<Record<(typeof methods)[number], (...a: unknown[]) => void>> = {};
  const printed: string[] = [];

  beforeEach(() => {
    printed.length = 0;
    originals = {};
    for (const m of methods) {
      originals[m] = console[m];
      console[m] = (...args: unknown[]) => {
        printed.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? String(a))).join(" "));
      };
    }
  });
  afterEach(() => {
    for (const m of methods) console[m] = originals[m]!;
  });

  it("logs nothing on success or on any failure, and no result carries the Authorization header", async () => {
    const results = [
      await lookup({ url: "crqln.com/x" }, fakeFetch(200, PAGE)),
      await lookup({ url: "crqln.com/x" }, fakeFetch(404, { error: "no_page" })),
      await lookup({ url: "crqln.com/x" }, fakeFetch(401, { error: "unauthorized" })),
      await lookup({ url: "crqln.com/x" }, fakeFetch(429, { error: "rate_limited" })),
      await lookup({ url: "crqln.com/x" }, fakeFetch(500, { error: "read_failed" })),
      await lookup({ url: "crqln.com/x" }, (async () => {
        throw new Error(`boom Bearer ${SECRET}`);
      }) as typeof fetch),
    ];
    assert.deepEqual(printed, []);
    for (const r of results) assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET));
  });
});

describe("no dashboard path calls CIRQLIN's page endpoint", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".") || name === "__tests__") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) files.push(path);
    }
  };
  for (const dir of ["app", "lib", "components", "scripts"]) walk(join(root, dir));
  const rel = (p: string) => relative(root, p);
  /** Source without comments, so a doc comment naming the endpoint isn't a call. */
  const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const users = (pattern: RegExp) => files.filter((f) => pattern.test(code(f))).map(rel).sort();

  it("only the client itself builds a /api/partner/page request", () => {
    assert.deepEqual(users(/["'`][^"'`\n]*\/api\/partner\/page/), ["lib/cirqlin/page.ts"]);
  });

  it("only the save action and the edit page import the lookup", () => {
    assert.deepEqual(users(/from\s+["'][^"']*cirqlin\/page(\.ts)?["']/).filter((f) => !/^lib\/(event-config\/(cirqlin|cirqlin-refresh|form)\.ts)$/.test(f)), [
      "app/(dashboard)/events/[id]/edit/page.tsx",
      "lib/actions/event-config.ts",
    ]);
    // The pure modules above import its types only.
    for (const f of ["lib/event-config/cirqlin.ts", "lib/event-config/cirqlin-refresh.ts", "lib/event-config/form.ts"]) {
      const src = readFileSync(join(root, f), "utf8");
      assert.match(src, /import type \{[^}]*\} from "\.\.\/cirqlin\/page\.ts"/, f);
    }
  });

  it("only the edit page refreshes the cache", () => {
    assert.deepEqual(users(/from\s+["'][^"']*cirqlin-refresh["']/), ["app/(dashboard)/events/[id]/edit/page.tsx"]);
  });
});
