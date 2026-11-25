/**
 * M3a through the whole request path: the mcp:meta scope is Matas's only,
 * the read-only and draft grants get 403 insufficient_scope on every meta
 * tool (logged, nothing run), and a meta call's mcp_actions row carries
 * the chat yes it ran on with approval_source 'claude_prompt'.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MCP_PROTOCOL_VERSION } from "../config.ts";
import { createActionLogger } from "../action-log.ts";
import { handleMcpRequest, type McpHandlerDeps } from "../server.ts";
import { resetMemoryRateLimit } from "../rate-limit.ts";
import { META_TOOLS } from "../tools/index.ts";
import { consentContent } from "../oauth/consent-words.ts";
import { scopeForUser } from "../oauth/flow.ts";
import { CLAUDE_CALLBACK } from "../config.ts";
import { migrateDraft } from "../../autosave.ts";
import { D_DRAFT, draftTables, fakeDraftDeps, newSpies } from "./draft-fixtures.ts";
import { fakeDb } from "./fake-db.ts";
import { NOW, fakeReaders } from "./fixtures.ts";
import { OPERATOR, ORIGIN, STAFF, connect, makeDeps } from "./helpers.ts";
import type { McpMetaDeps } from "../tool-types.ts";

const MCP_URL = `${ORIGIN}/api/mcp`;
let rpcId = 1000;
function rpc(name: string, args: Record<string, unknown>, token: string) {
  return new Request(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_PROTOCOL_VERSION, authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
}

function setup() {
  const flow = { ...makeDeps(new Set([OPERATOR, STAFF])), isMatas: (id: string) => id === OPERATOR };
  const db = fakeDb(draftTables());
  const sent: string[] = [];
  const meta: McpMetaDeps = {
    async sendAssets({ draft }) {
      sent.push("sendAssets");
      return { draft, slots: [], results: [], uploaded: 0, calls: 0, failed: [], changed: false };
    },
    async waitVideos() {
      sent.push("waitVideos");
      return { ready: [], errored: [], timedOut: [] };
    },
    async launch() {
      sent.push("launch");
      return { status: 200, body: {} };
    },
  };
  const deps: McpHandlerDeps = {
    ...flow,
    env: { ENABLE_MCP: "1" },
    now: () => NOW,
    db,
    logDb: db,
    logger: createActionLogger(db, () => undefined),
    readers: { ...fakeReaders, migrateDraft: (raw) => migrateDraft(raw) as unknown as Record<string, unknown> },
    isMatas: (id) => id === OPERATOR,
    draft: fakeDraftDeps(newSpies()),
    meta,
  };
  return { flow, db, deps, sent };
}

const YES = { asked: "Send the files on [NX27-GLITTERBOX] SIGNUP to Meta now? No launch, no spend.", answer: "yes go" };

test("mcp:meta is Matas's only: another operator asking for it is issued read and drafts; the consent page says so", async () => {
  const { flow } = setup();
  const matas = await connect(flow, OPERATOR, undefined, "mcp:read mcp:draft mcp:meta");
  assert.equal(matas.tokens.scope, "mcp:read mcp:draft mcp:meta");
  const staff = await connect(flow, STAFF, undefined, "mcp:read mcp:draft mcp:meta");
  assert.equal(staff.tokens.scope, "mcp:read mcp:draft");
  assert.equal(scopeForUser("mcp:read mcp:draft mcp:meta", STAFF, flow), "mcp:read mcp:draft");
  // Without an isMatas check nobody gets it.
  assert.equal(scopeForUser("mcp:read mcp:draft mcp:meta", OPERATOR, {}), "mcp:read mcp:draft");
  const page = (scope: string) => consentContent({ redirectUri: CLAUDE_CALLBACK, clientName: "Claude", email: null, returnHost: "claude.ai", scope }).lines[1];
  assert.match(page("mcp:read mcp:draft mcp:meta"), /launch drafts paused or live/);
  assert.doesNotMatch(page("mcp:read mcp:draft"), /launch drafts/);
});

test("read-only and draft grants get 403 insufficient_scope on every meta tool, logged, nothing run", async () => {
  resetMemoryRateLimit();
  const { flow, db, deps, sent } = setup();
  for (const scope of ["mcp:read", "mcp:read mcp:draft"]) {
    const { tokens } = await connect(flow, OPERATOR, undefined, scope);
    assert.equal(tokens.scope, scope);
    for (const tool of META_TOOLS) {
      const res = await handleMcpRequest(rpc(tool.name, { draft_id: D_DRAFT, approval: YES }, tokens.access_token), deps);
      assert.equal(res.status, 403, `${scope} ${tool.name}`);
      assert.deepEqual(await res.json(), { error: "insufficient_scope" });
      assert.match(res.headers.get("www-authenticate") ?? "", /error="insufficient_scope".*scope="mcp:read mcp:draft mcp:meta"/);
    }
  }
  // A meta grant held by someone no longer in MATAS_USER_IDS is refused the same way.
  const { tokens } = await connect(flow, OPERATOR, undefined, "mcp:read mcp:draft mcp:meta");
  const demoted = { ...deps, isMatas: () => false };
  assert.equal((await handleMcpRequest(rpc("upload_draft_assets", { draft_id: D_DRAFT, approval: YES }, tokens.access_token), demoted)).status, 403);
  assert.deepEqual(sent, []);
  const rows = db.writes.filter((w) => w.table === "mcp_actions").map((w) => (w.rows as Array<Record<string, unknown>>)[0]!);
  assert.equal(rows.length, META_TOOLS.length * 2 + 1);
  for (const r of rows) assert.deepEqual([r.kind, r.status, r.error, r.approval_source ?? null], ["meta", "failed", "insufficient_scope", null]);
  assert.deepEqual([...new Set(db.writes.map((w) => w.table))], ["mcp_actions"]);
});

test("a meta call's row: kind meta, the chat yes in args.approval whole, approved_by Matas, approval_source claude_prompt; a call without one is refused and carries none", async () => {
  resetMemoryRateLimit();
  const { flow, db, deps, sent } = setup();
  const { tokens } = await connect(flow, OPERATOR, undefined, "mcp:read mcp:draft mcp:meta");
  const long = { asked: `${"Send the files on [NX27-GLITTERBOX] SIGNUP to Meta now? ".repeat(10)}`.trim(), answer: "yes" };
  const ok = await (await handleMcpRequest(rpc("upload_draft_assets", { draft_id: D_DRAFT, approval: long }, tokens.access_token), deps)).json();
  assert.equal(ok.result.isError, false, ok.result.content[0].text);
  const no = await (await handleMcpRequest(rpc("upload_draft_assets", { draft_id: D_DRAFT }, tokens.access_token), deps)).json();
  assert.equal(no.result.isError, true);
  assert.match(JSON.parse(no.result.content[0].text).error, /^Refused: there’s no approval with this\./);
  assert.deepEqual(sent, ["sendAssets"], "only the approved call ran");
  const rows = db.writes.filter((w) => w.table === "mcp_actions").map((w) => (w.rows as Array<Record<string, unknown>>)[0]!);
  assert.deepEqual(rows.map((r) => [r.tool, r.kind, r.status]), [["upload_draft_assets", "meta", "done"], ["upload_draft_assets", "meta", "failed"]]);
  const approved = rows[0]!;
  assert.deepEqual((approved.args as { approval: unknown }).approval, long, "kept whole, not cut at 200 characters");
  assert.ok(long.asked.length > 200);
  assert.deepEqual([approved.approved_by, approved.approval_source, typeof approved.approved_at], [OPERATOR, "claude_prompt", "string"]);
  assert.deepEqual([rows[1]!.approved_by ?? null, rows[1]!.approval_source ?? null], [null, null]);
  assert.equal((rows[1]!.result as Record<string, unknown>).refused, "no_approval");
});
