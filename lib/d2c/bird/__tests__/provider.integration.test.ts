import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import type { D2CConnection, D2CMessage } from "../../types.ts";
import { BirdProvider, BIRD_RUNTIME_SEND_VERIFIED } from "../provider.ts";
import { resolveBirdTemplateVariables } from "../template-variables.ts";

/**
 * lib/d2c/bird/__tests__/provider.integration.test.ts
 *
 * Exercises the Bird provider's LIVE WhatsApp codepath end-to-end against a
 * mocked HTTP layer — the class of test the 2026-07-01 incident proved the
 * dry-run-only suite could not catch (layers 6 & 9 shipped a 422 shape because
 * no test ever asserted the request body that actually leaves the process).
 *
 * STATUS (2026-07-02 follow-up): reconciled against
 * `.scratch/bird-runtime-send-capture.txt` — sourced from Bird's public API
 * docs after a real DevTools capture proved unobtainable (see that file's
 * "CAPTURE PROVENANCE" section). `BIRD_RUNTIME_SEND_VERIFIED` is now `true`
 * and the shape assertions below are filled in and active.
 *
 * STATUS (2026-07-14): the `list_id` receiver shape (`{ contacts: [{ listId }] }`)
 * was live-rejected — Bird 422 "property listId is unsupported". Bird's
 * channels /messages endpoint has NO list-targeting field; list-targeted sends
 * now preflight GET /lists/{id}/contacts and fan out one `{ identifierValue }`
 * message per member. The old best-guess assertion is replaced by the fan-out
 * test below. The `recipients[]` and template-body fixtures remain byte-diffed
 * against the capture's own "COMPLETE EXAMPLE".
 */

const CAPTURE_WORKSPACE_ID = "9c308f77-c5ed-44d3-9714-9da017c7536c";
const CAPTURE_CHANNEL_ID = "322236d8-c182-4d32-bcdc-2e96f833ccfc";
const CAPTURE_PROJECT_ID = "53b26928-1df2-4d7a-a40a-8a92abc44429";
const CAPTURE_VERSION_ID = "7f913243-a9ca-4485-b0bd-0e4c13302375";
const CAPTURE_PROOF_PHONE = "+447780672270";

const captureConnection = (): D2CConnection => ({
  id: "c1",
  user_id: "u1",
  client_id: "cl1",
  provider: "bird",
  credentials: {
    api_key: "ak-live",
    workspace_id: CAPTURE_WORKSPACE_ID,
    channel_id: CAPTURE_CHANNEL_ID,
  },
  external_account_id: CAPTURE_WORKSPACE_ID,
  status: "active",
  last_synced_at: null,
  last_error: null,
  live_enabled: true,
  approved_by_matas: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

let origFetch: typeof fetch;
let origLive: string | undefined;
let capturedUrl: string | null;
let capturedBody: Record<string, unknown> | null;

beforeEach(() => {
  origFetch = globalThis.fetch;
  origLive = process.env.FEATURE_D2C_LIVE;
  process.env.FEATURE_D2C_LIVE = "true";
  capturedUrl = null;
  capturedBody = null;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response(JSON.stringify({ id: "msg-uuid-1" }), { status: 200 });
  };
});
afterEach(() => {
  globalThis.fetch = origFetch;
  if (origLive === undefined) delete process.env.FEATURE_D2C_LIVE;
  else process.env.FEATURE_D2C_LIVE = origLive;
});

test("BIRD_RUNTIME_SEND_VERIFIED is flipped on (shape reconciled with capture)", () => {
  assert.equal(BIRD_RUNTIME_SEND_VERIFIED, true);
});

// ── list_id → fan-out to individual identifiers (2026-07-14) ────────────────
//
// Bird's channels /messages endpoint has no list-targeting: a listId receiver
// 422s ("property listId is unsupported"). A list-targeted send now preflights
// GET /lists/{id}/contacts, resolves phone identifiers, and sends one message
// per member with a `{ identifierValue }` receiver. No outgoing body may carry
// `listId`.

test("list_id → preflights list contacts then fans out one identifierValue message each", async () => {
  const LIST_ID = "9386300f-2c97-4d75-ad41-2c87aeedcb2c";
  const getUrls: string[] = [];
  const postBodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.includes(`/lists/${LIST_ID}/contacts`)) {
      getUrls.push(url);
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "c1",
              featuredIdentifiers: [{ key: "phonenumber", value: "+447700900001" }],
            },
            { id: "c2", attributes: { phonenumber: ["+447700900002"] } },
          ],
        }),
        { status: 200 },
      );
    }
    postBodies.push(init?.body ? JSON.parse(String(init.body)) : {});
    return new Response(JSON.stringify({ id: "msg-uuid-1" }), { status: 200 });
  }) as unknown as typeof fetch;

  const message: D2CMessage = {
    channel: "whatsapp",
    subject: null,
    bodyMarkdown: "n/a",
    audience: { list_id: LIST_ID },
    variables: {},
    correlationId: "send-list",
  };
  const r = await new BirdProvider().send(captureConnection(), message);

  assert.equal(r.ok, true, r.error);
  // Preflighted the list-contacts endpoint exactly once.
  assert.equal(getUrls.length, 1);
  assert.match(
    getUrls[0],
    /\/lists\/9386300f-2c97-4d75-ad41-2c87aeedcb2c\/contacts\?/,
  );
  // One message per resolved member, each a phone-identifier receiver.
  assert.equal(postBodies.length, 2);
  assert.deepEqual(postBodies[0].receiver, {
    contacts: [{ identifierValue: "+447700900001" }],
  });
  assert.deepEqual(postBodies[1].receiver, {
    contacts: [{ identifierValue: "+447700900002" }],
  });
  // Never the unsupported list-targeted shape (the 2026-07-14 422 cause).
  for (const b of postBodies) {
    assert.ok(
      !JSON.stringify(b).includes("listId"),
      "no outgoing body may carry listId",
    );
  }
  const details = r.details as Record<string, unknown>;
  assert.equal(details.mode, "list_fanout");
  assert.equal(details.sent, 2);
  assert.equal(details.failed, 0);
});

test("list_id → ok:false when the list resolves to 0 phone-reachable members", async () => {
  const LIST_ID = "empty-list-0000";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.includes(`/lists/${LIST_ID}/contacts`)) {
      return new Response(
        JSON.stringify({
          results: [{ id: "c1", featuredIdentifiers: [{ key: "emailaddress", value: "a@b.com" }] }],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ id: "should-not-send" }), { status: 200 });
  }) as unknown as typeof fetch;

  const r = await new BirdProvider().send(captureConnection(), {
    channel: "whatsapp",
    subject: null,
    bodyMarkdown: "n/a",
    audience: { list_id: LIST_ID },
    variables: {},
    correlationId: "send-empty-list",
  });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /0 phone-reachable/);
});

// ── recipients[] → correct receiver shape sent ─────────────────────────────

test("recipients[] → correct receiver shape sent (verbatim vs capture example)", async () => {
  const message: D2CMessage = {
    channel: "whatsapp",
    subject: null,
    bodyMarkdown: "n/a",
    audience: { recipients: [CAPTURE_PROOF_PHONE] },
    variables: {},
    correlationId: "send-recipients",
  };
  const r = await new BirdProvider().send(captureConnection(), message);
  assert.equal(r.ok, true, r.error);
  const receiver = (capturedBody as Record<string, unknown>).receiver;
  // Byte-verbatim vs the capture's "COMPLETE EXAMPLE" receiver block.
  assert.deepEqual(receiver, {
    contacts: [{ identifierValue: CAPTURE_PROOF_PHONE }],
  });
});

// ── template body byte-diff against the capture's complete example ────────

test("template body matches captured shape verbatim (excluding volatile values)", async () => {
  // Variable insertion order matches the capture's own "parameters" array
  // order exactly, so the resulting array is byte-comparable without a sort.
  const message: D2CMessage = {
    channel: "whatsapp",
    subject: null,
    bodyMarkdown: "n/a",
    audience: {
      recipients: [CAPTURE_PROOF_PHONE],
      project_id: CAPTURE_PROJECT_ID,
      template_id: CAPTURE_VERSION_ID,
      locale: "es-ES",
    },
    variables: {
      event_artwork_url: "https://media.nest.messagebird.com/media/PLACEHOLDER",
      event_name: "Jackies - Open Air House Music Festival - MALLORCA",
      event_date: "domingo 16 de agosto",
      presale_day: "miércoles 8 de julio",
      presale_time: "12:00",
      wa_community_invite: "IPCpHTE8JMu9JT5DenZglv",
    },
    correlationId: "send-template",
  };
  const r = await new BirdProvider().send(captureConnection(), message);
  assert.equal(r.ok, true, r.error);

  const body = capturedBody as Record<string, unknown>;

  // Endpoint verbatim vs capture.
  assert.equal(
    capturedUrl,
    `https://api.bird.com/workspaces/${CAPTURE_WORKSPACE_ID}/channels/${CAPTURE_CHANNEL_ID}/messages`,
  );

  // `template` must be TOP-LEVEL (layer 9 fix) — no `body` field alongside it.
  assert.equal(body.body, undefined);
  assert.ok(body.template, "expected a top-level template field");

  const template = body.template as Record<string, unknown>;
  assert.equal(template.projectId, CAPTURE_PROJECT_ID);
  assert.equal(template.version, CAPTURE_VERSION_ID);
  assert.equal(template.locale, "es-ES");
  // Flat `{type,key,value}` array — NOT Meta's nested components[] wrapper.
  assert.deepEqual(template.parameters, [
    {
      type: "string",
      key: "event_artwork_url",
      value: "https://media.nest.messagebird.com/media/PLACEHOLDER",
    },
    {
      type: "string",
      key: "event_name",
      value: "Jackies - Open Air House Music Festival - MALLORCA",
    },
    { type: "string", key: "event_date", value: "domingo 16 de agosto" },
    { type: "string", key: "presale_day", value: "miércoles 8 de julio" },
    { type: "string", key: "presale_time", value: "12:00" },
    {
      type: "string",
      key: "wa_community_invite",
      value: "IPCpHTE8JMu9JT5DenZglv",
    },
  ]);
});

// ── resolveBirdTemplateVariables → provider byte-diff (2026-07-08 fix) ─────
//
// Closes the exact gap the live 422 exposed: `template.parameters` must
// carry the resolver's fresh values, and the resolver's values must WIN over
// whatever stale/partial variables already sat on the scheduled_send row
// (the documented "resolver wins" precedence — see template-variables.ts +
// fire.ts's wiring comment). Fixture mirrors the Throwback Algarve row from
// the bug report.

test("resolveBirdTemplateVariables output, merged last, reaches Bird byte-verbatim and wins over stale send-row variables", async () => {
  const staleSendRowVariables: Record<string, unknown> = {
    // What a real d2c_scheduled_sends.variables row carries today (locale +
    // artwork bookkeeping + Bug B's bird_template_* identity) — NONE of
    // these are template-declared variables, so they pass through
    // unchanged. `event_date` below simulates a STALE/wrong cached value
    // that a prior partial fix might have left behind — the resolver's
    // fresh value must clobber it.
    locale: "es-ES",
    artwork_source: "gdrive",
    artwork_gdrive_id: "1AbCdEfGhIjK",
    bird_template_name: "throwback_autoresp",
    bird_template_status: "active",
    bird_template_project_id: CAPTURE_PROJECT_ID,
    bird_template_version_id: CAPTURE_VERSION_ID,
    event_date: "STALE-DO-NOT-SEND",
  };

  const resolved = resolveBirdTemplateVariables({
    event: {
      name: "Throwback Algarve",
      event_start_at: "2026-08-08T21:00:00Z",
      presale_at: "2026-07-15T11:00:00Z",
      ticket_url: "https://ra.co/events/2123456",
    },
    copy: {
      artwork_url: "https://cdn.example.com/algarve.jpg",
      whatsapp_community_url: "https://chat.whatsapp.com/BEkbaKi9HUS3Tjl1ULBbe1",
    },
    timezone: "Europe/Lisbon",
  });

  // Mirrors fire.ts / test-send route's merge: resolver output applied LAST.
  const mergedVariables = { ...staleSendRowVariables, ...resolved };

  const message: D2CMessage = {
    channel: "whatsapp",
    subject: null,
    bodyMarkdown: "n/a",
    audience: {
      recipients: [CAPTURE_PROOF_PHONE],
      project_id: CAPTURE_PROJECT_ID,
      template_id: CAPTURE_VERSION_ID,
      locale: "es-ES",
    },
    variables: mergedVariables,
    correlationId: "send-resolved-template",
  };
  const r = await new BirdProvider().send(captureConnection(), message);
  assert.equal(r.ok, true, r.error);

  const template = (capturedBody as Record<string, unknown>).template as Record<
    string,
    unknown
  >;
  const parameters = template.parameters as { type: string; key: string; value: string }[];
  const byKey = new Map(parameters.map((p) => [p.key, p]));

  // The 7 resolver-owned keys reach Bird with the resolver's fresh values —
  // NOT the stale cached "STALE-DO-NOT-SEND" — byte-verbatim per key.
  assert.deepEqual(byKey.get("event_name"), {
    type: "string",
    key: "event_name",
    value: "Throwback Algarve",
  });
  assert.deepEqual(byKey.get("event_date"), {
    type: "string",
    key: "event_date",
    value: "Saturday 8th August",
  });
  assert.deepEqual(byKey.get("presale_day"), {
    type: "string",
    key: "presale_day",
    value: "Wednesday 15th July",
  });
  assert.deepEqual(byKey.get("presale_time"), {
    type: "string",
    key: "presale_time",
    value: "12:00",
  });
  assert.deepEqual(byKey.get("event_artwork_url"), {
    type: "string",
    key: "event_artwork_url",
    value: "https://cdn.example.com/algarve.jpg",
  });
  assert.deepEqual(byKey.get("wa_community_invite"), {
    type: "string",
    key: "wa_community_invite",
    value: "BEkbaKi9HUS3Tjl1ULBbe1",
  });
  assert.deepEqual(byKey.get("event_url_suffix"), {
    type: "string",
    key: "event_url_suffix",
    value: "2123456",
  });
  // Never the full WhatsApp community URL (would double the domain in the
  // button link) and never the stale cached value.
  assert.notEqual(byKey.get("wa_community_invite")?.value, "STALE-DO-NOT-SEND");
  for (const p of parameters) {
    assert.doesNotMatch(p.value, /chat\.whatsapp\.com/);
    assert.notEqual(p.value, "STALE-DO-NOT-SEND");
  }
});
