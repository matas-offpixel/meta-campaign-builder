// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";
import { NO_META_TOKEN_MESSAGE } from "@/lib/meta/agency-token";

/**
 * Routes that write to Meta with the agency token (no per-call token) refuse
 * a non-operator before any Meta call; an operator goes on exactly as before.
 * resolvePageIdentity never tries META_ACCESS_TOKEN when the caller may not.
 */

const OPERATOR = MATAS_USER_IDS[0]!;
const MEMBER = "7d0c3f52-1b6e-4a9d-8e21-5f4a3c2b1d0e"; // invented client_users member
const ENV_TOKEN = "EAAenvtokenfortests";

const state = vi.hoisted(() => ({ userId: null as string | null }));

const meta = vi.hoisted(() => ({
  createMetaCampaign: vi.fn(),
  createMetaAdSets: vi.fn(),
  createLookalikeAudience: vi.fn(),
  checkAudienceReadiness: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }) },
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) };
      return q;
    },
  }),
  createServiceRoleClient: () => {
    throw new Error("not expected");
  },
}));
vi.mock("@/lib/meta/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/meta/client")>()),
  ...meta,
}));

const createCampaign = await import("../create-campaign/route");
const createAdsets = await import("../create-adsets/route");
const lookalikes = await import("../lookalikes/retry/route");

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost/api/meta/${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  state.userId = null;
  for (const fn of Object.values(meta)) fn.mockReset();
});

const cases = [
  { name: "create-campaign", call: () => createCampaign.POST(post("create-campaign", {})) },
  { name: "create-adsets", call: () => createAdsets.POST(post("create-adsets", {})) },
  { name: "lookalikes/retry", call: () => lookalikes.POST(post("lookalikes/retry", {})) },
];

describe.each(cases)("$name", ({ call }) => {
  it("a non-operator gets 403 and no Meta call", async () => {
    state.userId = MEMBER;
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: NO_META_TOKEN_MESSAGE });
    for (const fn of Object.values(meta)) expect(fn).not.toHaveBeenCalled();
  });

  it("an operator is unchanged: past the guard to the route's own validation", async () => {
    state.userId = OPERATOR;
    const res = await call();
    expect(res.status).toBe(400); // empty body → the route's existing 400
  });

  it("no session is still 401", async () => {
    const res = await call();
    expect(res.status).toBe(401);
  });
});

describe("resolvePageIdentity", () => {
  const saved = process.env.META_ACCESS_TOKEN;
  const seen: string[] = [];

  beforeEach(() => {
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    seen.length = 0;
    vi.stubGlobal("fetch", async (input: string | URL) => {
      seen.push(new URL(String(input)).searchParams.get("access_token") ?? "");
      return new Response(JSON.stringify({ id: "123", name: "Harbour Page", access_token: "EAApage" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = saved;
  });

  it("never sends the agency token when the caller may not use it", async () => {
    const { resolvePageIdentity } = await import("@/lib/meta/page-token");
    await resolvePageIdentity("123", null, { allowSystemToken: false });
    expect(seen).not.toContain(ENV_TOKEN);
  });

  it("an operator (the default) still falls back to it", async () => {
    const { resolvePageIdentity } = await import("@/lib/meta/page-token");
    await resolvePageIdentity("123", null);
    expect(seen).toContain(ENV_TOKEN);
  });
});
