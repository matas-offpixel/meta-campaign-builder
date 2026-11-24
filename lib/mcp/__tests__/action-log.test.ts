import { test } from "node:test";
import assert from "node:assert/strict";
import { createActionLogger, isMissingTable, stripSecrets } from "../action-log.ts";
import { CONSENT_WORDS, consentBody } from "../oauth/consent-words.ts";
import { fakeDb } from "./fake-db.ts";

test("stripSecrets drops secret keys and token-shaped values", () => {
  const out = stripSecrets({
    code: "NX26-DOD",
    access_token: "opx_at_abc",
    nested: { refresh_token: "x", note: "Bearer abc.def", jwt: "eyJhbGciOiJIUzI1NiJ9.e30.x" },
    list: ["opx_rt_zzz", "fine"],
    client: "Electric",
  }) as Record<string, unknown>;
  // Event codes stay; an OAuth code is caught by its opx_code_ prefix.
  assert.equal(out.code, "NX26-DOD");
  assert.equal(stripSecrets("opx_code_abc"), "[redacted]");
  assert.equal(out.access_token, "[redacted]");
  assert.deepEqual(out.nested, { refresh_token: "[redacted]", note: "[redacted]", jwt: "[redacted]" });
  assert.deepEqual(out.list, ["[redacted]", "fine"]);
  assert.equal(out.client, "Electric");
});

test("logger writes the cleaned row to mcp_actions", async () => {
  const db = fakeDb({ mcp_actions: [] });
  const lines: string[] = [];
  const where = await createActionLogger(db, (l) => lines.push(l)).log({
    user_id: "u",
    grant_id: "g",
    tool: "get_event",
    args: { code: "NX26-DOD", token: "opx_at_secret" },
    kind: "read",
    status: "done",
    result: { drafts: 1 },
    duration_ms: 12,
    result_bytes: 300,
  });
  assert.equal(where, "db");
  assert.equal(lines.length, 0);
  assert.equal(JSON.stringify(db.writes).includes("opx_at_secret"), false);
});

test("missing-table messages are recognised", () => {
  assert.equal(isMissingTable("Could not find the table 'public.mcp_actions' in the schema cache"), true);
  assert.equal(isMissingTable('relation "public.mcp_actions" does not exist'), true);
  assert.equal(isMissingTable("permission denied"), false);
});

test("consent words are pinned (design verdict before merge)", () => {
  assert.deepEqual(consentBody({ clientName: "Claude", email: "op@example.com", returnHost: "claude.ai" }), [
    "Claude is asking to read Off/Pixel as op@example.com.",
    "It can read events, spend, signups, tickets, drafts and learnings. It can't change anything.",
    "It stays connected until you disconnect it in Claude.",
    "After you allow it, you go back to claude.ai.",
  ]);
  assert.equal(CONSENT_WORDS.title, "Connect Claude to Off/Pixel");
  assert.equal(consentBody({ clientName: null, email: null, returnHost: "localhost:3118" })[0], "An app is asking to read Off/Pixel.");
});
