import assert from "node:assert/strict";
import { test } from "node:test";

import { parseBirdContacts, contactsCreatedAfter } from "../bird-contacts.ts";

/**
 * The Bird list-contacts response shape is UNVERIFIED for this PR (poll-only
 * MVP, no live capture). These tests pin the DEFENSIVE parser's behaviour across
 * the plausible field names so a future live capture can tighten it without
 * silently changing extraction.
 */

test("parses flat phoneNumber + createdAt from results[]", () => {
  const env = {
    results: [
      { phoneNumber: "+447700900000", createdAt: "2026-07-08T10:00:00Z" },
      { phone: "+447700900001", created_at: "2026-07-08T11:00:00Z" },
    ],
  };
  const parsed = parseBirdContacts(env);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]!.phone, "+447700900000");
  assert.equal(parsed[1]!.phone, "+447700900001");
  assert.ok(parsed[0]!.createdAtMs && parsed[0]!.createdAtMs > 0);
});

test("parses identifiers[] phonenumber entries", () => {
  const env = {
    data: [
      {
        identifiers: [
          { type: "emailaddress", value: "x@y.com" },
          { type: "phonenumber", value: "+34600000000" },
        ],
        createdAt: "2026-07-08T10:00:00Z",
      },
    ],
  };
  const parsed = parseBirdContacts(env);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.phone, "+34600000000");
});

test("parses attributes.phonenumber and contacts[] envelope", () => {
  const env = { contacts: [{ attributes: { phonenumber: "+4915112345678" } }] };
  const parsed = parseBirdContacts(env);
  assert.equal(parsed[0]!.phone, "+4915112345678");
});

test("drops unparseable / phoneless rows (safe no-op)", () => {
  const env = { results: [{ id: "no-phone" }, { phone: "12" /* too short */ }, null, "junk"] };
  assert.deepEqual(parseBirdContacts(env), []);
  assert.deepEqual(parseBirdContacts(null), []);
  assert.deepEqual(parseBirdContacts({}), []);
});

test("contactsCreatedAfter filters by cursor; includes unknown createdAt", () => {
  const contacts = [
    { phone: "+1", createdAtMs: 1000 },
    { phone: "+2", createdAtMs: 3000 },
    { phone: "+3", createdAtMs: null },
  ];
  const fresh = contactsCreatedAfter(contacts, 2000);
  assert.deepEqual(
    fresh.map((c) => c.phone),
    ["+2", "+3"],
  );
  // Null cursor → everything.
  assert.equal(contactsCreatedAfter(contacts, null).length, 3);
});
