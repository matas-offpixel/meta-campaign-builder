import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import type { D2CConnection, D2CMessage } from "../../types.ts";
import { BirdProvider, BIRD_RUNTIME_SEND_VERIFIED } from "../provider.ts";

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
 * and the three shape assertions below are filled in and active.
 *
 * The `recipients[]` and template-body fixtures below are byte-diffed against
 * the capture's own "COMPLETE EXAMPLE" (workspace/channel ids, phone number,
 * projectId/version, and parameter values are taken verbatim from that file).
 * The `list_id` fixture is the ONE item Bird's docs don't cover — it is
 * diffed against the capture's own documented best-guess recommendation
 * (`{ contacts: [{ listId }] }`), not a confirmed live shape. If Matas's
 * post-merge smoke test 422s specifically on a list-targeted send, iterate
 * per the fallback chain in docs/D2C_LIVE_FIRE_RUNBOOK.md and update this
 * fixture + provider.ts together.
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

// ── list_id → correct receiver shape sent ──────────────────────────────────

test("list_id → correct receiver shape sent (capture's documented best-guess fix)", async () => {
  const message: D2CMessage = {
    channel: "whatsapp",
    subject: null,
    bodyMarkdown: "n/a",
    audience: { list_id: "9386300f-2c97-4d75-ad41-2c87aeedcb2c" },
    variables: {},
    correlationId: "send-list",
  };
  const r = await new BirdProvider().send(captureConnection(), message);
  assert.equal(r.ok, true, r.error);
  assert.ok(capturedBody, "expected a JSON body");
  const receiver = (capturedBody as Record<string, unknown>).receiver;
  // Capture's fix recommendation: array of one object carrying listId — NOT
  // the layer-6 bug shape `{ contacts: { listId } }` (object, not array).
  assert.deepEqual(receiver, {
    contacts: [{ listId: "9386300f-2c97-4d75-ad41-2c87aeedcb2c" }],
  });
  // Guard against ever regressing to the exact 422-causing shape.
  assert.notDeepEqual(receiver, {
    contacts: { listId: "9386300f-2c97-4d75-ad41-2c87aeedcb2c" },
  });
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
