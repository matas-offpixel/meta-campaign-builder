import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, it } from "node:test";

import {
  apiAccessForSignedInUser,
  NON_OPERATOR_API_ALLOWLIST,
  nonOperatorApiEntry,
} from "../api-access.ts";
import { MATAS_USER_IDS } from "../operator-allowlist.ts";
import { isPublicPath } from "../public-routes.ts";

const OPERATOR = MATAS_USER_IDS[0]!;
const MEMBER = "7d0c3f52-1b6e-4a9d-8e21-5f4a3c2b1d0e"; // invented client_users member
const ID = "a1b2c3d4-0000-4000-8000-000000000001";

const WORST = [
  "/api/meta/launch-campaign",
  "/api/internal-counts/upload",
  "/api/meta/upload-asset",
  "/api/venues/enrich",
  `/api/plan/${ID}/resume`,
  "/api/meta/bulk-attach-ads",
  "/api/meta/customer-audience-upload",
  `/api/internal-counts/items/${ID}`,
  `/api/clients/${ID}/asset-queue/${ID}/upload-to-meta`,
  "/api/admin/smooth-historical-tier-channel-sales",
  "/api/admin/remotion/render-caption",
  "/api/track/meta-click",
  "/api/d2c/connections",
];

describe("signed-in client_users member on /api", () => {
  for (const path of WORST) {
    it(`is refused on ${path}`, () => {
      assert.equal(apiAccessForSignedInUser(path, MEMBER), "operator_required");
    });
  }

  it("is refused on CRON-or-session routes the proxy treats as public", () => {
    // These skip the login redirect so a bearer-only cron call reaches the
    // handler. A member's session must not ride that carve-out.
    for (const path of [
      "/api/internal/refresh-active-creatives",
      "/api/internal/scan-enhancement-flags",
      `/api/events/${ID}/rollup/sync`,
      `/api/events/${ID}/mailchimp/refresh`,
      `/api/events/${ID}/meta/resolve-campaign-id`,
      `/api/clients/${ID}/venues/LDN-1/daily-budget`,
      "/api/admin/event-rollup-backfill",
    ]) {
      assert.equal(isPublicPath(path), true, path);
      assert.equal(apiAccessForSignedInUser(path, MEMBER), "operator_required", path);
    }
  });

  it("passes the allowlisted public and token-guarded routes", () => {
    for (const path of [
      "/api/cron/d2c-send",
      "/api/share/report/tok123",
      "/api/share/client/tok123/tickets",
      "/api/events/by-share-token/tok123/additional-spend",
      "/api/venues/by-share-token/tok123/additional-spend",
      "/api/ticketing/rollup-sync/by-share-token/tok123",
      "/api/l/client/event/signup",
      "/api/community-aliases/NXLOVES",
      `/api/webhooks/mailchimp/${ID}/abc123`,
      "/api/webhooks/ticketing/fourthefans",
      "/api/proxy/creative-thumbnail",
      "/api/meta/thumbnail-proxy",
    ]) {
      assert.equal(apiAccessForSignedInUser(path, MEMBER), "pass", path);
    }
  });

  it("near-misses of allowlisted shapes are still refused", () => {
    for (const path of [
      "/api/sharex",
      "/api/webhooks/ticketing/fourthefans/extra",
      "/api/meta/thumbnail-proxy/other",
      "/api/ticketing/rollup-sync",
      "/api/l",
    ]) {
      assert.equal(apiAccessForSignedInUser(path, MEMBER), "operator_required", path);
    }
  });

  it("a new route is operator-only by default", () => {
    assert.equal(apiAccessForSignedInUser("/api/brand-new-feature/do-something", MEMBER), "operator_required");
    assert.equal(nonOperatorApiEntry("/api/brand-new-feature"), null);
  });

  it("non-/api paths are not decided here", () => {
    assert.equal(apiAccessForSignedInUser("/clients/abc", MEMBER), "pass");
    assert.equal(apiAccessForSignedInUser("/admin/some-client", MEMBER), "pass");
  });
});

describe("operator on /api", () => {
  it("passes every route, allowlisted or not", () => {
    for (const path of [...WORST, "/api/brand-new-feature", "/api/share/report/tok"]) {
      assert.equal(apiAccessForSignedInUser(path, OPERATOR), "pass", path);
    }
  });
});

describe("public routes with no session", () => {
  it("cron, share and both webhooks skip the login redirect", () => {
    for (const path of [
      "/api/cron/d2c-send",
      "/api/share/report/tok123",
      `/api/webhooks/mailchimp/${ID}/abc123`,
      "/api/webhooks/ticketing/fourthefans",
    ]) {
      assert.equal(isPublicPath(path), true, path);
    }
  });

  it("an operator route is not public", () => {
    assert.equal(isPublicPath("/api/meta/launch-campaign"), false);
    assert.equal(isPublicPath("/api/internal-counts/upload"), false);
  });
});

// ── The allowlist against the real tree ────────────────────────────────────

const ROOT = process.cwd();

function routeUrls(dir = join(ROOT, "app/api")): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeUrls(full));
    else if (name === "route.ts") {
      const rel = dirname(full).slice(join(ROOT, "app").length);
      // [param] → a sample segment so patterns can be tested.
      out.push(rel.replace(/\[\.\.\.[^\]]+\]/g, "x/y").replace(/\[[^\]]+\]/g, "x"));
    }
  }
  return out;
}

describe("NON_OPERATOR_API_ALLOWLIST", () => {
  it("every entry says why", () => {
    for (const e of NON_OPERATOR_API_ALLOWLIST) {
      assert.ok(e.reason.length > 30, String(e.match));
    }
  });

  it("every entry matches at least one real route (no stale entries)", () => {
    const urls = routeUrls();
    assert.ok(urls.length > 100);
    for (const e of NON_OPERATOR_API_ALLOWLIST) {
      const hit = urls.some((u) => (typeof e.match === "string" ? u.startsWith(e.match) : e.match.test(u)));
      assert.ok(hit, `allowlist entry matches no route: ${String(e.match)}`);
    }
  });

  it("most real routes stay operator-only for a member", () => {
    const urls = routeUrls();
    const open = urls.filter((u) => apiAccessForSignedInUser(u, MEMBER) === "pass");
    const closed = urls.length - open.length;
    // Everything a member can reach is a cron, share, landing, webhook or
    // thumbnail route.
    for (const u of open) {
      assert.match(u, /^\/api\/(cron|share|l|community-aliases|webhooks|proxy|meta\/thumbnail-proxy|events\/by-share-token|venues\/by-share-token|ticketing\/rollup-sync\/by-share-token)(\/|$)/, u);
    }
    assert.ok(closed > open.length, `closed ${closed} open ${open.length}`);
  });
});

// ── The client dashboard calls nothing the allowlist doesn't allow ─────────

function resolveImport(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("client dashboard (/admin/[clientSlug])", () => {
  it("every /api path its page tree references is allowed for a member", () => {
    const stack = filesUnder(join(ROOT, "app/admin/[clientSlug]"));
    const seen = new Set<string>();
    const refs: Array<{ path: string; file: string }> = [];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/["'`](\/api\/[A-Za-z0-9_/.$\{\}\[\]-]*)/g)) refs.push({ path: m[1]!, file: f });
      for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const r = resolveImport(m[1]!, f);
        if (r && !seen.has(r)) stack.push(r);
      }
    }
    assert.ok(seen.size > 20, `walked ${seen.size} files`);
    for (const { path, file } of refs) {
      const sample = path.replace(/\$\{[^}]*\}/g, "x").replace(/\[[^\]]+\]/g, "x");
      assert.equal(apiAccessForSignedInUser(sample, MEMBER), "pass", `${file} calls ${path}, which a member can't reach`);
    }
  });
});
