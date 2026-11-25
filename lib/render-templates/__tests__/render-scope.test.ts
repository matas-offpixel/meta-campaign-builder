/**
 * render_package through the whole request path (M4a): mcp:render is
 * Matas's only; a grant without it gets 403 insufficient_scope, logged,
 * nothing rendered; a call with the yes is one mcp_actions row, kind
 * render, the yes in args.approval with approval_source claude_prompt.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { MCP_PROTOCOL_VERSION } from "../../mcp/config.ts";
import { createActionLogger } from "../../mcp/action-log.ts";
import { scopeForUser } from "../../mcp/oauth/flow.ts";
import { resetMemoryRateLimit } from "../../mcp/rate-limit.ts";
import { handleMcpRequest, type McpHandlerDeps } from "../../mcp/server.ts";
import { fakeReaders } from "../../mcp/__tests__/fixtures.ts";
import { OPERATOR, ORIGIN, STAFF, connect, makeDeps } from "../../mcp/__tests__/helpers.ts";
import { fakeDb } from "../../mcp/__tests__/fake-db.ts";
import { fakeStartDeps, fixtureTables, NOW } from "./fixtures.ts";

let id = 5000;
const rpc = (name: string, args: Record<string, unknown>, token: string) =>
  new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_PROTOCOL_VERSION, authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
  });

function setup() {
  const flow = { ...makeDeps(new Set([OPERATOR, STAFF])), isMatas: (u: string) => u === OPERATOR };
  const tables = fixtureTables();
  // The fixture show belongs to the test operator (who is Matas here).
  for (const e of tables.events!) e.user_id = OPERATOR;
  const db = fakeDb(tables);
  const deps: McpHandlerDeps = { ...flow, env: { ENABLE_MCP: "1" }, now: () => NOW, db, logDb: db, logger: createActionLogger(db, () => undefined), readers: fakeReaders as never, isMatas: (u) => u === OPERATOR, render: fakeStartDeps() };
  return { flow, db, deps };
}

const YES = { asked: "Render the P26-BDAY montage: 9 files (no text, teaser, announcement × 9:16, 4:5, 1:1). OK?", answer: "yes" };

test("mcp:render is Matas's only: another operator asking for it is issued without it", async () => {
  const { flow } = setup();
  const staff = await connect(flow, STAFF, undefined, "mcp:read mcp:render");
  assert.equal(staff.tokens.scope, "mcp:read");
  assert.equal(scopeForUser("mcp:read mcp:draft mcp:meta mcp:render", STAFF, flow), "mcp:read mcp:draft");
  const matas = await connect(flow, OPERATOR, undefined, "mcp:read mcp:render");
  assert.equal(matas.tokens.scope, "mcp:read mcp:render");
});

test("a grant without mcp:render gets 403 on render_package, logged, nothing rendered", async () => {
  resetMemoryRateLimit();
  const { flow, db, deps } = setup();
  const { tokens } = await connect(flow, OPERATOR, undefined, "mcp:read mcp:draft mcp:meta");
  const res = await handleMcpRequest(rpc("render_package", { event: "P26-BDAY", approval: YES }, tokens.access_token), deps);
  assert.equal(res.status, 403);
  assert.match(res.headers.get("www-authenticate") ?? "", /scope="mcp:read mcp:draft mcp:meta mcp:render"/);
  assert.deepEqual([...new Set(db.writes.map((w) => w.table))], ["mcp_actions"]);
  const row = (db.writes[0]!.rows as Record<string, unknown>[])[0]!;
  assert.deepEqual([row.tool, row.kind, row.status, row.error], ["render_package", "render", "failed", "insufficient_scope"]);
});

test("with the yes: one row, kind render, the yes whole with approval_source claude_prompt; without it, refused and nothing rendered", async () => {
  resetMemoryRateLimit();
  const { flow, db, deps } = setup();
  const { tokens } = await connect(flow, OPERATOR, undefined, "mcp:read mcp:render");
  const no = await (await handleMcpRequest(rpc("render_package", { event: "P26-BDAY" }, tokens.access_token), deps)).json();
  assert.equal(no.result.isError, true);
  assert.equal(JSON.parse(no.result.content[0].text).error, "Refused: there’s no approval with this. Ask Matas in chat, then send his exact question and answer with it. Nothing was rendered.");
  assert.equal(db.writes.filter((w) => w.table !== "mcp_actions").length, 0);
  const ok = await (await handleMcpRequest(rpc("render_package", { event: "P26-BDAY", approval: YES }, tokens.access_token), deps)).json();
  assert.equal(ok.result.isError, false, ok.result.content[0].text);
  assert.equal(ok.result.content[0].text, "Rendering 9 files for P26-BDAY. Each is filed in Drive as it finishes.");
  const rows = db.writes.filter((w) => w.table === "mcp_actions").map((w) => (w.rows as Record<string, unknown>[])[0]!);
  assert.deepEqual(rows.map((r) => [r.tool, r.kind, r.status]), [["render_package", "render", "failed"], ["render_package", "render", "done"]]);
  assert.equal(rows[0]!.approval_source ?? null, null);
  assert.deepEqual((rows[1]!.args as { approval: unknown }).approval, YES);
  assert.equal(rows[1]!.approval_source, "claude_prompt");
  assert.equal(rows[1]!.approved_by, OPERATOR);
  assert.equal(db.writes.filter((w) => w.table === "creative_lab_renders").length, 1, "nine queued files in one insert");
});

test("consent: line 3 when the grant includes mcp:render; the render upgrade title and cancel note when a grant adds it", async () => {
  const { consentContent, isRenderUpgrade } = await import("../../mcp/oauth/consent-words.ts");
  const { CLAUDE_CALLBACK } = await import("../../mcp/config.ts");
  const base = { redirectUri: CLAUDE_CALLBACK, clientName: "Claude", email: null, returnHost: "claude.ai" };
  const plain = consentContent({ ...base, scope: "mcp:read mcp:draft mcp:meta" });
  assert.equal(plain.lines.length, 4);
  const render = consentContent({ ...base, scope: "mcp:read mcp:draft mcp:meta mcp:render" });
  assert.equal(render.lines[2], "It can render videos in the Creative Lab too, and file them in the show's Drive folder, each only after you say yes in Claude.");
  assert.equal(render.title, "Connect Claude to Off/Pixel");
  const live = [{ client_id: "c1", scope: "mcp:read mcp:draft mcp:meta", revoked_at: null }];
  assert.equal(isRenderUpgrade(live, "c1", "mcp:read mcp:draft mcp:meta mcp:render"), true);
  assert.equal(isRenderUpgrade(live, "c2", "mcp:read mcp:draft mcp:meta mcp:render"), false);
  const up = consentContent({ ...base, scope: "mcp:read mcp:draft mcp:meta mcp:render", addsRender: true });
  assert.equal(up.title, "Let Claude render videos in Off/Pixel");
  assert.equal(up.cancelNote, "If you cancel, it keeps the access it has now.");
  const loop = consentContent({ ...base, redirectUri: "http://127.0.0.1:5555/callback", scope: "mcp:read mcp:render", addsRender: true });
  assert.equal(loop.title, "Let an app on this computer render videos in Off/Pixel");
});
