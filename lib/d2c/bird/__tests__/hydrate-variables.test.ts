import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hydrateSendVariables,
  extractWhatsappInviteCode,
  MissingTemplateVariablesError,
  REQUIRED_BIRD_TEMPLATE_VARIABLES,
  type HydrateEvent,
  type HydrateEventCopy,
} from "../hydrate-variables.ts";

// A fully-populated fixture (Jackies Mallorca shape) — all 6 vars resolvable.
const EVENT: HydrateEvent = {
  name: "Jackies Mallorca",
  event_date: null,
  event_start_at: "2026-06-14T21:00:00.000Z",
  event_timezone: "Europe/Madrid",
  presale_at: "2026-06-10T10:00:00.000Z",
};
const COPY: HydrateEventCopy = {
  artwork_url: "https://cdn.example.com/jackies-mallorca.jpg",
  whatsapp_community_url: "https://chat.whatsapp.com/ABC123def456?ref=ig",
};

// ── extractWhatsappInviteCode ──────────────────────────────────────────────

test("invite code: strips protocol, domain, query string", () => {
  assert.equal(
    extractWhatsappInviteCode("https://chat.whatsapp.com/ABC123def456?ref=ig"),
    "ABC123def456",
  );
});

test("invite code: handles no-protocol + trailing slash", () => {
  assert.equal(
    extractWhatsappInviteCode("chat.whatsapp.com/ABC123def456/"),
    "ABC123def456",
  );
});

test("invite code: passes through a bare code", () => {
  assert.equal(extractWhatsappInviteCode("ABC123def456"), "ABC123def456");
});

test("invite code: strips fragment", () => {
  assert.equal(
    extractWhatsappInviteCode("https://chat.whatsapp.com/XYZ#section"),
    "XYZ",
  );
});

test("invite code: empty / null / domain-only → empty string", () => {
  assert.equal(extractWhatsappInviteCode(null), "");
  assert.equal(extractWhatsappInviteCode(undefined), "");
  assert.equal(extractWhatsappInviteCode("   "), "");
  assert.equal(extractWhatsappInviteCode("https://chat.whatsapp.com"), "");
});

// ── hydrateSendVariables: happy path ───────────────────────────────────────

test("hydrate: resolves all 6 required variables from a full fixture", () => {
  const { variables } = hydrateSendVariables({}, COPY, EVENT, {
    locale: "es-ES",
  });
  for (const key of REQUIRED_BIRD_TEMPLATE_VARIABLES) {
    assert.ok(
      variables[key] && variables[key].trim() !== "",
      `${key} must resolve non-empty (got "${variables[key]}")`,
    );
  }
  assert.equal(variables.event_name, "Jackies Mallorca");
  assert.equal(variables.event_artwork_url, COPY.artwork_url);
  assert.equal(variables.wa_community_invite, "ABC123def456");
  // Date parts are locale/tz formatted — assert they contain the expected day.
  assert.match(variables.event_date, /14/);
  assert.match(variables.presale_day, /10/);
  assert.match(variables.presale_time, /\d{1,2}[:.]\d{2}/);
});

// ── hydrateSendVariables: loud-fail on missing required vars ────────────────

test("hydrate: throws when artwork_url is null (event_artwork_url required)", () => {
  assert.throws(
    () => hydrateSendVariables({}, { ...COPY, artwork_url: null }, EVENT),
    (err: unknown) => {
      assert.ok(err instanceof MissingTemplateVariablesError);
      assert.deepEqual(err.missing, ["event_artwork_url"]);
      return true;
    },
  );
});

test("hydrate: throws when community url is missing (wa_community_invite required)", () => {
  assert.throws(
    () =>
      hydrateSendVariables(
        {},
        { ...COPY, whatsapp_community_url: null },
        EVENT,
      ),
    (err: unknown) => {
      assert.ok(err instanceof MissingTemplateVariablesError);
      assert.deepEqual(err.missing, ["wa_community_invite"]);
      return true;
    },
  );
});

test("hydrate: lists ALL missing variables, not just the first", () => {
  const emptyCopy: HydrateEventCopy = {
    artwork_url: null,
    whatsapp_community_url: null,
  };
  const emptyEvent: HydrateEvent = {
    name: "",
    event_date: null,
    event_start_at: null,
    event_timezone: null,
    presale_at: null,
  };
  assert.throws(
    () => hydrateSendVariables({}, emptyCopy, emptyEvent),
    (err: unknown) => {
      assert.ok(err instanceof MissingTemplateVariablesError);
      assert.deepEqual(
        [...err.missing].sort(),
        [...REQUIRED_BIRD_TEMPLATE_VARIABLES].sort(),
      );
      return true;
    },
  );
});

// ── hydrateSendVariables: explicit overrides win ───────────────────────────

test("hydrate: send-row variables override derived values", () => {
  const { variables } = hydrateSendVariables(
    { variables: { event_name: "OVERRIDDEN", wa_community_invite: "MANUAL" } },
    COPY,
    EVENT,
  );
  assert.equal(variables.event_name, "OVERRIDDEN");
  assert.equal(variables.wa_community_invite, "MANUAL");
  // Non-overridden derived values remain.
  assert.equal(variables.event_artwork_url, COPY.artwork_url);
});

test("hydrate: blank/whitespace override does NOT mask a good derived value", () => {
  const { variables } = hydrateSendVariables(
    { variables: { event_name: "   " } },
    COPY,
    EVENT,
  );
  assert.equal(variables.event_name, "Jackies Mallorca");
});
