import { test } from "node:test";
import assert from "node:assert/strict";
import { MCP_PROTOCOL_VERSION } from "../config.ts";
import { createActionLogger } from "../action-log.ts";
import { handleMcpRequest, type McpHandlerDeps } from "../server.ts";
import {
  authorizationServerResponse,
  protectedResourceResponse,
  registerResponse,
  revokeResponse,
  tokenResponse,
} from "../oauth/http.ts";
import { resetMemoryRateLimit } from "../rate-limit.ts";
import { DRAFT_TOOLS, READ_TOOLS } from "../tools/index.ts";
import { D_DRAFT, UPDATED, draftTables, fakeDraftDeps, newSpies } from "./draft-fixtures.ts";
import { migrateDraft } from "../../autosave.ts";
import { fakeDb } from "./fake-db.ts";
import { NOW, fakeReaders, tables } from "./fixtures.ts";
import { OPERATOR, ORIGIN, STAFF, connect, makeDeps } from "./helpers.ts";

const ON = { ENABLE_MCP: "1" };
const MCP_URL = `${ORIGIN}/api/mcp`;

function setup(env: Record<string, string | undefined> = ON) {
  const flow = makeDeps(new Set([OPERATOR, STAFF]));
  const db = fakeDb({ ...tables(), mcp_actions: [] });
  const lines: string[] = [];
  const deps: McpHandlerDeps = {
    ...flow,
    env,
    now: () => NOW,
    db,
    logDb: db,
    logger: createActionLogger(db, (l) => lines.push(l)),
    readers: fakeReaders,
    isMatas: (id) => id === OPERATOR,
  };
  return { flow, db, deps, lines };
}

let rpcId = 0;
function rpc(method: string, params: unknown, token: string | null, extra: Record<string, string> = {}) {
  return new Request(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
}

const INIT = { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test", version: "0" } };

test("kill switch: every MCP and OAuth endpoint is 404 unless ENABLE_MCP is exactly 1", async () => {
  for (const value of [undefined, "0", "true", "yes", " 1"]) {
    const env = { ENABLE_MCP: value };
    const { deps, flow } = setup(env);
    assert.equal((await handleMcpRequest(rpc("tools/list", {}, "x"), deps)).status, 404, String(value));
    assert.equal(protectedResourceResponse(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`), env).status, 404);
    assert.equal(authorizationServerResponse(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), env).status, 404);
    const post = (path: string) => new Request(`${ORIGIN}${path}`, { method: "POST", body: "{}" });
    assert.equal((await registerResponse(post("/api/oauth/register"), flow, env)).status, 404);
    assert.equal((await tokenResponse(post("/api/oauth/token"), flow, env)).status, 404);
    assert.equal((await revokeResponse(post("/api/oauth/revoke"), flow, env)).status, 404);
  }
});

test("metadata: protected resource points at the issuer; S256 and public clients only", async () => {
  const pr = await protectedResourceResponse(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`), ON).json();
  assert.equal(pr.resource, MCP_URL);
  assert.deepEqual(pr.authorization_servers, [ORIGIN]);
  const as = await authorizationServerResponse(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), ON).json();
  assert.equal(as.issuer, ORIGIN);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ["none"]);
  assert.equal(as.registration_endpoint, `${ORIGIN}/api/oauth/register`);
});

test("auth: no token → 401 with the resource_metadata challenge; wrong / revoked → 401; non-operator → 403", async () => {
  const { deps, flow } = setup();
  const none = await handleMcpRequest(rpc("initialize", INIT, null), deps);
  assert.equal(none.status, 401);
  assert.match(none.headers.get("www-authenticate") ?? "", /resource_metadata="https:\/\/app\.offpixel\.co\.uk\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
  assert.equal((await handleMcpRequest(rpc("initialize", INIT, "opx_at_wrong"), deps)).status, 401);

  const { tokens } = await connect(flow);
  assert.equal((await handleMcpRequest(rpc("initialize", INIT, tokens.access_token), deps)).status, 200);

  // Removed from the operator list → 403 on the very next call.
  flow.operators.delete(OPERATOR);
  assert.equal((await handleMcpRequest(rpc("initialize", INIT, tokens.access_token), deps)).status, 403);
  flow.operators.add(OPERATOR);

  // Revoked → 401.
  await revokeResponse(
    new Request(`${ORIGIN}/api/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `token=${tokens.access_token}` }),
    flow,
    ON,
  );
  assert.equal((await handleMcpRequest(rpc("initialize", INIT, tokens.access_token), deps)).status, 401);
});

test("only POST; a foreign Origin is refused", async () => {
  const { deps, flow } = setup();
  const { tokens } = await connect(flow);
  assert.equal((await handleMcpRequest(new Request(MCP_URL, { method: "GET" }), deps)).status, 405);
  assert.equal((await handleMcpRequest(new Request(MCP_URL, { method: "DELETE" }), deps)).status, 405);
  assert.equal((await handleMcpRequest(rpc("initialize", INIT, tokens.access_token, { origin: "https://evil.example" }), deps)).status, 403);
  assert.equal((await handleMcpRequest(rpc("initialize", INIT, tokens.access_token, { origin: "https://claude.ai" }), deps)).status, 200);
});

test("full path: initialize → tools/list (all readOnlyHint) → tools/call, logged without the token", async () => {
  resetMemoryRateLimit();
  const { deps, flow, db, lines } = setup();
  const { tokens } = await connect(flow);
  const init = await handleMcpRequest(rpc("initialize", INIT, tokens.access_token), deps);
  assert.equal(init.status, 200);
  assert.equal(init.headers.get("mcp-session-id"), null, "stateless: no session id");
  const initBody = await init.json();
  assert.equal(initBody.result.serverInfo.name, "off-pixel");

  const list = await (await handleMcpRequest(rpc("tools/list", {}, tokens.access_token), deps)).json();
  const tools = list.result.tools as Array<{ name: string; annotations: Record<string, boolean>; description: string }>;
  assert.equal(tools.length, 56, "a read-only grant still lists the draft, meta and render tools (calling one asks for the step-up)");
  const readNames = new Set(READ_TOOLS.map((t) => t.name));
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, readNames.has(t.name) || ["list_drive_creatives", "get_releases", "list_clips", "get_live", "list_scheduled", "plan_retargeting"].includes(t.name), t.name);
    assert.equal(t.annotations.destructiveHint, false, t.name);
  }

  const call = await (await handleMcpRequest(rpc("tools/call", { name: "get_event", arguments: { code: "NX26-DOD" } }, tokens.access_token), deps)).json();
  assert.equal(call.result.isError, false);
  const data = JSON.parse(call.result.content[0].text);
  assert.equal(data.tickets.latest, 431);

  const bad = await (await handleMcpRequest(rpc("tools/call", { name: "get_event", arguments: { code: "NOPE-1" } }, tokens.access_token), deps)).json();
  assert.equal(bad.result.isError, true);

  const logged = db.writes.filter((w) => w.table === "mcp_actions").map((w) => (w.rows as Array<Record<string, unknown>>)[0]!);
  assert.equal(logged.length, 2);
  assert.deepEqual(
    logged.map((r) => [r.tool, r.kind, r.status]),
    [
      ["get_event", "read", "done"],
      ["get_event", "read", "failed"],
    ],
  );
  assert.equal(logged[0]!.user_id, OPERATOR);
  // M1 records no approval: approval_source ('claude_prompt' | 'today') means nothing until M3's record.
  for (const r of logged) for (const k of ["approved_by", "approved_at", "approval_source"]) assert.equal(k in r, false, k);
  assert.ok(Number(logged[0]!.result_bytes) > 0);
  assert.ok(Number(logged[0]!.duration_ms) >= 0);

  // No token, refresh token or code in any write or log line.
  const everything = JSON.stringify(db.writes) + lines.join("\n");
  for (const secret of [tokens.access_token, tokens.refresh_token]) assert.equal(everything.includes(secret), false);
  assert.equal(/opx_(at|rt|code)_/.test(everything), false);
  // Only mcp_actions is written by a tool call.
  assert.deepEqual([...new Set(db.writes.map((w) => w.table))], ["mcp_actions"]);
});

test("missing mcp_actions table: the call still answers and the log goes to stdout, counts only", async () => {
  resetMemoryRateLimit();
  const { deps, flow } = setup();
  const db = fakeDb(tables()); // no mcp_actions table
  const lines: string[] = [];
  const d2 = { ...deps, db, logDb: db, logger: createActionLogger(db, (l) => lines.push(l)) };
  const { tokens } = await connect(flow);
  const call = await (await handleMcpRequest(rpc("tools/call", { name: "list_events", arguments: {} }, tokens.access_token), d2)).json();
  assert.equal(call.result.isError, false);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^\[mcp_actions:stdout\] tool=list_events kind=read status=done duration_ms=\d+ result_bytes=\d+$/);
});

test("rate limit: 60 calls a minute per grant, then 429", async () => {
  resetMemoryRateLimit();
  const { deps, flow } = setup();
  const { tokens } = await connect(flow);
  let last = 0;
  for (let i = 0; i < 61; i++) last = (await handleMcpRequest(rpc("tools/list", {}, tokens.access_token), deps)).status;
  assert.equal(last, 429);
});

function draftSetup() {
  const flow = makeDeps(new Set([OPERATOR, STAFF]));
  const db = fakeDb(draftTables());
  const lines: string[] = [];
  const deps: McpHandlerDeps = {
    ...flow,
    env: ON,
    now: () => NOW,
    db,
    logDb: db,
    logger: createActionLogger(db, (l) => lines.push(l)),
    readers: { ...fakeReaders, migrateDraft: (raw) => migrateDraft(raw) as unknown as Record<string, unknown> },
    isMatas: (id) => id === OPERATOR,
    draft: fakeDraftDeps(newSpies()),
  };
  return { flow, db, deps, lines };
}

test("scope: a read-only grant gets 403 insufficient_scope with the step-up challenge on every M2 tool; its reads keep working", async () => {
  resetMemoryRateLimit();
  const { deps, flow, db } = draftSetup();
  const { tokens } = await connect(flow);
  assert.equal(tokens.scope, "mcp:read");
  for (const tool of DRAFT_TOOLS) {
    const res = await handleMcpRequest(rpc("tools/call", { name: tool.name, arguments: { draft_id: D_DRAFT, updated_at: UPDATED } }, tokens.access_token), deps);
    assert.equal(res.status, 403, tool.name);
    assert.deepEqual(await res.json(), { error: "insufficient_scope" });
    const challenge = res.headers.get("www-authenticate") ?? "";
    assert.match(challenge, /error="insufficient_scope"/);
    assert.match(challenge, /scope="mcp:read mcp:draft mcp:meta mcp:render"/);
    assert.match(challenge, /resource_metadata="/);
  }
  // Nothing written but the refusals in the log, one per call.
  assert.deepEqual([...new Set(db.writes.map((w) => w.table))], ["mcp_actions"]);
  const refusals = db.writes.map((w) => (w.rows as Array<Record<string, unknown>>)[0]!);
  assert.equal(refusals.length, DRAFT_TOOLS.length);
  for (const r of refusals) assert.deepEqual([r.kind, r.status, r.error], ["draft", "failed", "insufficient_scope"]);
  // Reads still work on the same token.
  const read = await handleMcpRequest(rpc("tools/call", { name: "get_draft", arguments: { id: D_DRAFT } }, tokens.access_token), deps);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).result.isError, false);
});

test("a draft grant (mcp:read mcp:draft) runs a draft tool: one mcp_actions row, kind draft, done, before → after, no token", async () => {
  resetMemoryRateLimit();
  const { deps, flow, db, lines } = draftSetup();
  const { tokens } = await connect(flow, OPERATOR, undefined, "mcp:read mcp:draft");
  assert.equal(tokens.scope, "mcp:read mcp:draft");
  const call = await (
    await handleMcpRequest(
      rpc("tools/call", { name: "set_draft_budget", arguments: { draft_id: D_DRAFT, updated_at: UPDATED, type: "daily", amount_gbp: 20, start: "2026-12-01" } }, tokens.access_token),
      deps,
    )
  ).json();
  assert.equal(call.result.isError, false);
  const data = JSON.parse(call.result.content[0].text);
  assert.equal(data.perDayGbp, 20);
  assert.equal(typeof data.launchChecks.ran, "boolean");
  // A stale updated_at is a failed row with the reason.
  const stale = await (
    await handleMcpRequest(
      rpc("tools/call", { name: "set_draft_budget", arguments: { draft_id: D_DRAFT, updated_at: UPDATED, type: "daily", amount_gbp: 30, start: "2026-12-01" } }, tokens.access_token),
      deps,
    )
  ).json();
  assert.equal(stale.result.isError, true);
  assert.match(JSON.parse(stale.result.content[0].text).error, /changed since you read it/);
  const logged = db.writes.filter((w) => w.table === "mcp_actions").map((w) => (w.rows as Array<Record<string, unknown>>)[0]!);
  assert.deepEqual(logged.map((r) => [r.tool, r.kind, r.status]), [
    ["set_draft_budget", "draft", "done"],
    ["set_draft_budget", "draft", "failed"],
  ]);
  const result = logged[0]!.result as Record<string, unknown>;
  assert.equal(result.draftId, D_DRAFT);
  assert.deepEqual((result.after as Record<string, unknown>).amount, 20);
  assert.equal((logged[1]!.result as Record<string, unknown>).refused, "changed_since_read");
  const everything = JSON.stringify(db.writes) + lines.join("\n");
  for (const secret of [tokens.access_token, tokens.refresh_token]) assert.equal(everything.includes(secret), false);
  // Only campaign_drafts and the log were written.
  assert.deepEqual([...new Set(db.writes.map((w) => w.table))].sort(), ["campaign_drafts", "mcp_actions"]);
});

test("set_draft_ad_sets under the £8 floor: refused without override; with it, the reason is in the mcp_actions row and the answer", async () => {
  resetMemoryRateLimit();
  const { deps, flow, db } = draftSetup();
  const { tokens } = await connect(flow, OPERATOR, undefined, "mcp:read mcp:draft");
  const call = async (args: Record<string, unknown>) =>
    (await (await handleMcpRequest(rpc("tools/call", { name: "set_draft_ad_sets", arguments: { draft_id: D_DRAFT, ...args } }, tokens.access_token), deps)).json()).result;
  const no = await call({ updated_at: UPDATED, changes: [{ ad_set_id: "as-1", budget_per_day: 6 }] });
  assert.equal(no.isError, true);
  assert.match(JSON.parse(no.content[0].text).error, /under £8 a day/);
  const reason = "Pool of 900 retargeting people; £6 spends it.";
  const yes = await call({ updated_at: UPDATED, changes: [{ ad_set_id: "as-1", budget_per_day: 6 }], override: true, override_reason: reason });
  assert.equal(yes.isError, false);
  assert.equal(JSON.parse(yes.content[0].text).floorOverride.reason, reason);
  const rows = db.writes.filter((w) => w.table === "mcp_actions").map((w) => (w.rows as Array<Record<string, unknown>>)[0]!);
  assert.deepEqual(rows.map((r) => r.status), ["failed", "done"]);
  assert.equal((rows[0]!.result as Record<string, unknown>).refused, "under_floor");
  const logged = (rows[1]!.result as { floorOverride: { reason: string; adSets: Array<{ id: string; perDay: number }> } }).floorOverride;
  assert.equal(logged.reason, reason);
  assert.deepEqual(logged.adSets.map((a) => [a.id, a.perDay]), [["as-1", 6]]);
});
