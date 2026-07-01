import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import type { D2CConnection, D2CMessage } from "../../types.ts";
import { BirdProvider } from "../provider.ts";

/**
 * lib/d2c/bird/__tests__/provider.integration.test.ts
 *
 * Exercises the Bird provider's LIVE WhatsApp codepath end-to-end against a
 * mocked HTTP layer — the class of test the 2026-07-01 incident proved the
 * dry-run-only suite could not catch (layers 6 & 9 shipped a 422 shape because
 * no test ever asserted the request body that actually leaves the process).
 *
 * STATUS: The request-shape assertions are SKIPPED pending the runtime-send
 * DevTools capture (.scratch/bird-runtime-send-capture.txt). They are written
 * as concrete `skip`ped tests so that, when the capture lands and
 * BIRD_RUNTIME_SEND_VERIFIED flips true, the fixtures below can be filled from
 * the capture and un-skipped in the same PR. Do NOT un-skip against guessed
 * shapes — that is exactly what caused the incident.
 */

const CAPTURE_SKIP =
  "pending .scratch/bird-runtime-send-capture.txt (layers 6 & 9)";

const baseConnection = (): D2CConnection => ({
  id: "c1",
  user_id: "u1",
  client_id: "cl1",
  provider: "bird",
  credentials: { api_key: "ak-live", workspace_id: "ws-1", channel_id: "ch-1" },
  external_account_id: "ws-1",
  status: "active",
  last_synced_at: null,
  last_error: null,
  live_enabled: true,
  approved_by_matas: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const templateMessageWithList = (): D2CMessage => ({
  channel: "whatsapp",
  subject: null,
  bodyMarkdown: "Gracias por registrarte a {{event_name}}",
  audience: {
    list_id: "list-uuid-123",
    template_name: "jackies_autoresp",
    locale: "es-ES",
  },
  variables: {
    event_name: "Jackies Mallorca",
    event_artwork_url: "https://cdn.example.com/a.jpg",
    wa_community_invite: "ABC123",
  },
  correlationId: "send-list",
});

let origFetch: typeof fetch;
let origLive: string | undefined;

beforeEach(() => {
  origFetch = globalThis.fetch;
  origLive = process.env.FEATURE_D2C_LIVE;
});
afterEach(() => {
  globalThis.fetch = origFetch;
  if (origLive === undefined) delete process.env.FEATURE_D2C_LIVE;
  else process.env.FEATURE_D2C_LIVE = origLive;
});

// ── ACTIVE: the current (correct) gated behaviour ──────────────────────────

test("live WhatsApp send is gated (no HTTP) while runtime shape is unverified", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}", { status: 200 });
  };
  const r = await new BirdProvider().send(
    baseConnection(),
    templateMessageWithList(),
  );
  assert.equal(r.ok, false);
  assert.equal(r.dryRun, false);
  assert.match(r.error ?? "", /BIRD_RUNTIME_UNVERIFIED/);
  assert.equal(calls, 0);
});

// ── SKIPPED pending capture: request-shape assertions (layers 6 & 9) ───────

test(
  "list_id → correct receiver shape sent (verbatim vs capture)",
  { skip: CAPTURE_SKIP },
  () => {
    // TODO(capture): flip BIRD_RUNTIME_SEND_VERIFIED, capture the outgoing
    // request body, and assert body.receiver deep-equals the captured shape
    // (array of contacts, or a preflight-expanded contact list — NOT
    // { contacts: { listId } }, which produced the 422).
    assert.fail("unreachable while skipped");
  },
);

test(
  "recipients[] → correct receiver shape sent (verbatim vs capture)",
  { skip: CAPTURE_SKIP },
  () => {
    assert.fail("unreachable while skipped");
  },
);

test(
  "template body matches captured shape (language.code vs locale, positional params)",
  { skip: CAPTURE_SKIP },
  () => {
    // TODO(capture): byte-diff body.body.template against the captured payload
    // minus dynamic fields (variable values, ids). Confirms locale-vs-
    // language.code and keyed-vs-positional parameter shape.
    assert.fail("unreachable while skipped");
  },
);
