// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";

/**
 * Every D2C connection route is operator only. A client_users member signs
 * in through /admin/login and holds an ordinary Supabase session, which the
 * proxy lets through outside /admin, so the routes must refuse it
 * themselves: no session → 401, member → 403, nothing read or written.
 */

const OPERATOR = MATAS_USER_IDS[0]!;
const MEMBER = "7d0c3f52-1b6e-4a9d-8e21-5f4a3c2b1d0e"; // invented client_users member
const CONN = "c0ffee00-1111-4222-8333-944445555666";
const CLIENT = "a1b2c3d4-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  tables: [] as string[],
}));

const db = vi.hoisted(() => ({
  listD2CConnectionsForUser: vi.fn(),
  upsertD2CConnection: vi.fn(),
  getD2CConnectionById: vi.fn(),
  setD2CConnectionLiveFlag: vi.fn(),
  setD2CConnectionStatus: vi.fn(),
  deleteD2CConnection: vi.fn(),
}));

const validateCredentials = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/d2c", () => db);
vi.mock("@/lib/d2c/secrets", () => ({ MissingD2CTokenKeyError: class extends Error {} }));
vi.mock("@/lib/d2c/registry", () => ({
  getD2CProvider: () => ({ validateCredentials }),
  listD2CProviderNames: () => ["mailchimp", "klaviyo", "bird", "firetext"],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }),
    },
    from: (table: string) => {
      state.tables.push(table);
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { id: CLIENT, user_id: OPERATOR }, error: null }),
      };
      return q;
    },
  }),
}));

const connection = {
  id: CONN,
  user_id: OPERATOR,
  client_id: CLIENT,
  provider: "mailchimp",
  credentials: { api_key: "secret-key-us1" },
  external_account_id: "us1",
  status: "active",
  last_synced_at: null,
  last_error: null,
  live_enabled: false,
  approved_by_matas: false,
  created_at: "2026-11-16T00:00:00Z",
  updated_at: "2026-11-16T00:00:00Z",
};

const collection = await import("../route");
const item = await import("../[id]/route");
const live = await import("../[id]/live/route");

const params = { params: Promise.resolve({ id: CONN }) };
const url = (path: string) => `http://localhost/api/d2c/connections${path}`;
const json = (method: string, path: string, body: unknown) =>
  new NextRequest(url(path), { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

type Case = { name: string; call: () => Promise<Response>; okStatus: number };

const cases: Case[] = [
  { name: "GET /api/d2c/connections", call: () => collection.GET(new NextRequest(url(`?clientId=${CLIENT}`))), okStatus: 200 },
  {
    name: "POST /api/d2c/connections (save)",
    call: () => collection.POST(json("POST", "", { clientId: CLIENT, provider: "mailchimp", credentials: { api_key: "secret-key-us1", server_prefix: "us1" } })),
    okStatus: 201,
  },
  { name: "PATCH /api/d2c/connections/[id] (status)", call: () => item.PATCH(json("PATCH", `/${CONN}`, { status: "paused" }), params), okStatus: 200 },
  { name: "DELETE /api/d2c/connections/[id]", call: () => item.DELETE(new NextRequest(url(`/${CONN}?hard=1`), { method: "DELETE" }), params), okStatus: 200 },
  {
    name: "PATCH /api/d2c/connections/[id]/live",
    call: () => live.PATCH(json("PATCH", `/${CONN}/live`, { live_enabled: true, approved_by_matas: true }), params),
    okStatus: 200,
  },
];

const writers = [db.upsertD2CConnection, db.setD2CConnectionLiveFlag, db.setD2CConnectionStatus, db.deleteD2CConnection];

beforeEach(() => {
  state.userId = null;
  state.tables = [];
  for (const fn of Object.values(db)) fn.mockReset();
  validateCredentials.mockReset();
  db.listD2CConnectionsForUser.mockResolvedValue([connection]);
  db.upsertD2CConnection.mockResolvedValue(connection);
  db.getD2CConnectionById.mockResolvedValue(connection);
  db.setD2CConnectionLiveFlag.mockResolvedValue(connection);
  db.setD2CConnectionStatus.mockResolvedValue(undefined);
  db.deleteD2CConnection.mockResolvedValue(undefined);
  validateCredentials.mockResolvedValue({ ok: true, externalAccountId: "us1" });
});

describe.each(cases)("$name", ({ call, okStatus }) => {
  it("lets the operator through", async () => {
    state.userId = OPERATOR;
    const res = await call();
    expect(res.status).toBe(okStatus);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(JSON.stringify(body)).not.toContain("secret-key-us1");
  });

  it("refuses a signed-in client_users member with 403 and touches nothing", async () => {
    state.userId = MEMBER;
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "Operator access required" });
    expect(state.tables).toEqual([]);
    for (const fn of Object.values(db)) expect(fn).not.toHaveBeenCalled();
  });

  it("refuses no session with 401", async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Not signed in" });
    for (const fn of writers) expect(fn).not.toHaveBeenCalled();
  });
});

it("a member's save writes nothing and never reaches the provider", async () => {
  state.userId = MEMBER;
  const res = await collection.POST(
    json("POST", "", { clientId: CLIENT, provider: "bird", credentials: { api_key: "member-key", workspace_id: "299d31b1-0000-4000-8000-000000000000" } }),
  );
  expect(res.status).toBe(403);
  expect(db.upsertD2CConnection).not.toHaveBeenCalled();
  expect(validateCredentials).not.toHaveBeenCalled();
  expect(state.tables).toEqual([]);
});
