import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BIRD_WORKSPACE_CHECK_FAILED,
  BIRD_WORKSPACE_ID_REQUIRED,
  BIRD_WORKSPACE_ID_SHAPE,
  birdWorkspaceTaken,
  checkBirdWorkspaceId,
  saveD2CConnection,
  type SaveConnectionDeps,
  type WorkspaceOwner,
} from "../save.ts";
import type { D2CConnection, D2CProviderName } from "../../types.ts";

const PROVIDERS: D2CProviderName[] = ["mailchimp", "klaviyo", "bird", "firetext"];
const KEY = "bird-secret-key-do-not-echo";
const WS = "4c1f2a9e-7b3d-4e58-9a61-0d2c8b7f5e13";
const CLIENT = "client-harbour";

function connection(over: Partial<D2CConnection> = {}): D2CConnection {
  return {
    id: "conn-1",
    user_id: "user-1",
    client_id: CLIENT,
    provider: "bird",
    credentials: { api_key: KEY, workspace_id: WS },
    external_account_id: WS,
    status: "active",
    last_synced_at: null,
    last_error: null,
    live_enabled: false,
    approved_by_matas: false,
    created_at: "2026-11-16T00:00:00Z",
    updated_at: "2026-11-16T00:00:00Z",
    ...over,
  };
}

function deps(owners: WorkspaceOwner[] = []) {
  const calls = { validate: 0, upsert: [] as Array<Record<string, unknown>>, owners: [] as string[] };
  const d: SaveConnectionDeps = {
    findClient: async (id) => (id === CLIENT || id === "client-pier" ? { id } : null),
    validate: async (_p, creds) => {
      calls.validate += 1;
      return creds.workspace_id ? { ok: true, externalAccountId: String(creds.workspace_id) } : { ok: false, error: "api_key and workspace_id are required." };
    },
    findBirdWorkspaceOwners: async (ws) => {
      calls.owners.push(ws);
      return owners;
    },
    upsert: async (input) => {
      calls.upsert.push(input as unknown as Record<string, unknown>);
      return connection({ client_id: input.clientId, external_account_id: input.externalAccountId });
    },
  };
  return { d, calls };
}

const body = (credentials: Record<string, unknown>, clientId = CLIENT) => ({ clientId, provider: "bird", credentials });

test("the workspace id must be a UUID; blank says it's required", () => {
  assert.deepEqual(checkBirdWorkspaceId(undefined), { ok: false, error: BIRD_WORKSPACE_ID_REQUIRED });
  assert.deepEqual(checkBirdWorkspaceId("   "), { ok: false, error: BIRD_WORKSPACE_ID_REQUIRED });
  assert.deepEqual(checkBirdWorkspaceId("ws-1"), { ok: false, error: BIRD_WORKSPACE_ID_SHAPE });
  assert.deepEqual(checkBirdWorkspaceId(`${WS}x`), { ok: false, error: BIRD_WORKSPACE_ID_SHAPE });
  assert.deepEqual(checkBirdWorkspaceId(` ${WS.toUpperCase()} `), { ok: true, workspaceId: WS });
});

test("a Bird save with a workspace id stores it and returns no credentials", async () => {
  const { d, calls } = deps();
  const r = await saveD2CConnection(d, { body: body({ api_key: KEY, workspace_id: WS.toUpperCase(), channel_id: "chan-1" }), allowedProviders: PROVIDERS, callerIsOperator: true });
  assert.equal(r.status, 201);
  assert.equal(calls.upsert.length, 1);
  const saved = calls.upsert[0]!;
  assert.equal((saved.credentials as Record<string, unknown>).workspace_id, WS);
  assert.equal(saved.externalAccountId, WS);
  assert.deepEqual(calls.owners, [WS]);
  assert.ok(r.body.ok && r.body.connection.credentials === null);
  assert.equal(JSON.stringify(r.body).includes(KEY), false);
});

test("a Bird save without a workspace id is refused before Bird is called", async () => {
  const { d, calls } = deps();
  const r = await saveD2CConnection(d, { body: body({ api_key: KEY, channel_id: "chan-1" }), allowedProviders: PROVIDERS, callerIsOperator: true });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { ok: false, error: BIRD_WORKSPACE_ID_REQUIRED });
  assert.equal(calls.validate, 0);
  assert.equal(calls.upsert.length, 0);
  assert.equal(JSON.stringify(r.body).includes(KEY), false);
});

test("a malformed workspace id is refused with the shape message", async () => {
  const { d, calls } = deps();
  const r = await saveD2CConnection(d, { body: body({ api_key: KEY, workspace_id: "not-a-uuid" }), allowedProviders: PROVIDERS, callerIsOperator: true });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { ok: false, error: BIRD_WORKSPACE_ID_SHAPE });
  assert.equal(calls.validate, 0);
});

test("a workspace on another client's active Bird connection is refused", async () => {
  const { d, calls } = deps([{ client_id: "client-pier", client_name: "Pier Nights" }]);
  const r = await saveD2CConnection(d, { body: body({ api_key: KEY, workspace_id: WS }), allowedProviders: PROVIDERS, callerIsOperator: true });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, {
    ok: false,
    error: "This Bird workspace is already saved on Pier Nights. A workspace can be saved on one client only, so each send is tied to one client.",
  });
  assert.equal(calls.validate, 0);
  assert.equal(calls.upsert.length, 0);
  assert.equal(JSON.stringify(r.body).includes(KEY), false);
});

test("re-saving the same client's workspace (a new key) is allowed", async () => {
  const { d, calls } = deps([{ client_id: CLIENT, client_name: "Harbour" }]);
  const r = await saveD2CConnection(d, { body: body({ api_key: KEY, workspace_id: WS }), allowedProviders: PROVIDERS, callerIsOperator: true });
  assert.equal(r.status, 201);
  assert.equal(calls.upsert.length, 1);
});

test("a non-operator gets the 'another client' line even when the name is known", async () => {
  const { d, calls } = deps([{ client_id: "client-pier", client_name: "Pier Nights" }]);
  const r = await saveD2CConnection(d, { body: body({ api_key: KEY, workspace_id: WS }), allowedProviders: PROVIDERS, callerIsOperator: false });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, {
    ok: false,
    error: "This Bird workspace is already saved on another client. A workspace can be saved on one client only, so each send is tied to one client.",
  });
  assert.equal(JSON.stringify(r.body).includes("Pier Nights"), false);
  assert.equal(calls.upsert.length, 0);
});

test("an operator with no name for the other client gets the 'another client' line", () => {
  assert.equal(
    birdWorkspaceTaken(null, true),
    "This Bird workspace is already saved on another client. A workspace can be saved on one client only, so each send is tied to one client.",
  );
  assert.equal(birdWorkspaceTaken("Pier Nights", false), birdWorkspaceTaken(null, true));
});

test("a provider rejection or a failed owner read never echoes the key", async () => {
  const { d } = deps();
  const rejecting: SaveConnectionDeps = { ...d, validate: async () => ({ ok: false, error: "Bird channel check failed." }) };
  const r1 = await saveD2CConnection(rejecting, { body: body({ api_key: KEY, workspace_id: WS }), allowedProviders: PROVIDERS, callerIsOperator: true });
  assert.equal(r1.status, 400);
  assert.equal(JSON.stringify(r1.body).includes(KEY), false);

  const broken: SaveConnectionDeps = { ...d, findBirdWorkspaceOwners: async () => { throw new Error(`boom ${KEY}`); } };
  const r2 = await saveD2CConnection(broken, { body: body({ api_key: KEY, workspace_id: WS }), allowedProviders: PROVIDERS, callerIsOperator: true });
  assert.equal(r2.status, 500);
  assert.deepEqual(r2.body, {
    ok: false,
    error: "Couldn't check whether this Bird workspace is saved on another client, so nothing was saved. Try again.",
  });
  assert.equal(BIRD_WORKSPACE_CHECK_FAILED, (r2.body as { error: string }).error);
  assert.equal(JSON.stringify(r2.body).includes(KEY), false);
});

test("other providers don't need a workspace id and skip the workspace check", async () => {
  const { d, calls } = deps();
  const mc: SaveConnectionDeps = { ...d, validate: async () => ({ ok: true, externalAccountId: "us1" }) };
  const r = await saveD2CConnection(mc, { body: { clientId: CLIENT, provider: "mailchimp", credentials: { api_key: "abc-us1", server_prefix: "us1" } }, allowedProviders: PROVIDERS, callerIsOperator: true });
  assert.equal(r.status, 201);
  assert.deepEqual(calls.owners, []);
  assert.equal(r.body.ok && r.body.connection.credentials, null);
});

test("unknown client → 404, missing clientId or provider → 400", async () => {
  const { d } = deps();
  assert.equal((await saveD2CConnection(d, { body: body({ api_key: KEY, workspace_id: WS }, "client-gone"), allowedProviders: PROVIDERS, callerIsOperator: true })).status, 404);
  assert.equal((await saveD2CConnection(d, { body: { provider: "bird", credentials: {} }, allowedProviders: PROVIDERS, callerIsOperator: true })).status, 400);
  assert.equal((await saveD2CConnection(d, { body: { clientId: CLIENT, provider: "sendgrid", credentials: {} }, allowedProviders: PROVIDERS, callerIsOperator: true })).status, 400);
});
