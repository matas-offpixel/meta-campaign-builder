/**
 * Audience routing resolution.
 *
 * The load-bearing property under test: these names are VERBATIM identifiers.
 * `T26-LISBOA-MONSTANTOS` is misspelled and that spelling is correct, because
 * it is what exists live. Any "helpful" normalisation here routes signups to a
 * list nothing reads, silently.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertRoutingSpellingsAgree,
  AudienceRoutingError,
  resolveBirdGroup,
  resolveMailchimpAudience,
} from "../brief-routing.ts";

const LIVE_NAME = "T26-LISBOA-MONSTANTOS"; // sic — misspelled live, therefore correct

function mockFetch(handler: (url: URL) => unknown) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) =>
    new Response(JSON.stringify(handler(new URL(String(url)))), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
  return () => { globalThis.fetch = original; };
}

// ── spelling agreement ──────────────────────────────────────────────────────

test("agreeing tag and bird_list pass", () => {
  assertRoutingSpellingsAgree({
    mailchimp_list: "Throwback",
    mailchimp_tag: LIVE_NAME,
    bird_list: LIVE_NAME,
  });
});

test("a divergent spelling is an ERROR, not a warning", () => {
  assert.throws(
    () =>
      assertRoutingSpellingsAgree({
        mailchimp_list: "Throwback",
        mailchimp_tag: "T26-LISBOA-MONSTANTOS",
        bird_list: "T26-LISBOA-MONSANTOS", // "corrected" spelling — must fail
      }),
    AudienceRoutingError,
  );
});

test("case differences count as divergence", () => {
  assert.throws(
    () =>
      assertRoutingSpellingsAgree({
        mailchimp_list: "Throwback",
        mailchimp_tag: LIVE_NAME,
        bird_list: LIVE_NAME.toLowerCase(),
      }),
    AudienceRoutingError,
  );
});

test("mailchimp_list is NOT compared — it names the parent audience", () => {
  assertRoutingSpellingsAgree({
    mailchimp_list: "Throwback",
    mailchimp_tag: LIVE_NAME,
    bird_list: LIVE_NAME,
  });
});

test("an empty identifier is rejected rather than defaulted", () => {
  for (const field of ["mailchimp_list", "mailchimp_tag", "bird_list"]) {
    const routing = { mailchimp_list: "Throwback", mailchimp_tag: LIVE_NAME, bird_list: LIVE_NAME };
    assert.throws(
      () => assertRoutingSpellingsAgree({ ...routing, [field]: "  " }),
      AudienceRoutingError,
      `accepted empty ${field}`,
    );
  }
});

// ── Bird resolution ─────────────────────────────────────────────────────────

test("bird_list resolves to the group id the journey trigger needs", async () => {
  const restore = mockFetch(() => ({
    results: [{ id: "grp-1", name: "other" }, { id: "grp-2", name: LIVE_NAME }],
  }));
  try {
    const g = await resolveBirdGroup({ apiKey: "k", workspaceId: "ws" }, LIVE_NAME);
    assert.equal(g.id, "grp-2");
    assert.equal(g.name, LIVE_NAME);
  } finally {
    restore();
  }
});

test("a case-different Bird list is NOT substituted — it fails and says so", async () => {
  const restore = mockFetch(() => ({ results: [{ id: "grp-2", name: LIVE_NAME }] }));
  try {
    await assert.rejects(
      () => resolveBirdGroup({ apiKey: "k", workspaceId: "ws" }, LIVE_NAME.toLowerCase()),
      (e: unknown) => {
        assert.ok(e instanceof AudienceRoutingError);
        // Surfaces the near miss as diagnosis...
        assert.match(e.problems.join(" "), /Did the brief mean/);
        // ...while explicitly refusing to use it.
        assert.match(e.problems.join(" "), /Not substituted/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("the corrected spelling does not resolve against the live misspelling", async () => {
  const restore = mockFetch(() => ({ results: [{ id: "grp-2", name: LIVE_NAME }] }));
  try {
    // "MONSANTOS" is the real venue spelling but NOT the list name.
    await assert.rejects(
      () => resolveBirdGroup({ apiKey: "k", workspaceId: "ws" }, "T26-LISBOA-MONSANTOS"),
      AudienceRoutingError,
    );
  } finally {
    restore();
  }
});

test("a missing Bird list fails loud and is never created", async () => {
  let mutated = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "GET") mutated = true;
    return new Response(JSON.stringify({ results: [{ id: "g", name: "unrelated" }] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  try {
    await assert.rejects(
      () => resolveBirdGroup({ apiKey: "k", workspaceId: "ws" }, LIVE_NAME),
      AudienceRoutingError,
    );
    assert.equal(mutated, false, "resolution must never issue a write");
  } finally {
    globalThis.fetch = original;
  }
});

test("duplicate Bird list names are ambiguous, not first-wins", async () => {
  const restore = mockFetch(() => ({
    results: [{ id: "a", name: LIVE_NAME }, { id: "b", name: LIVE_NAME }],
  }));
  try {
    await assert.rejects(
      () => resolveBirdGroup({ apiKey: "k", workspaceId: "ws" }, LIVE_NAME),
      (e: unknown) => {
        assert.ok(e instanceof AudienceRoutingError);
        assert.match(e.problems.join(" "), /ambiguous/i);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("Bird lists beyond page 1 still resolve", async () => {
  const restore = mockFetch((u) => {
    const token = u.searchParams.get("pageToken");
    return token === "p2"
      ? { results: [{ id: "grp-late", name: LIVE_NAME }] }
      : { results: [{ id: "grp-1", name: "other" }], nextPageToken: "p2" };
  });
  try {
    const g = await resolveBirdGroup({ apiKey: "k", workspaceId: "ws" }, LIVE_NAME);
    assert.equal(g.id, "grp-late");
  } finally {
    restore();
  }
});

// ── Mailchimp resolution ────────────────────────────────────────────────────

test("mailchimp_list resolves by exact name", async () => {
  const restore = mockFetch(() => ({
    lists: [{ id: "aud-1", name: "Throwback" }, { id: "aud-2", name: "Jackies" }],
  }));
  try {
    const a = await resolveMailchimpAudience("us1", "key", "Throwback");
    assert.equal(a.id, "aud-1");
  } finally {
    restore();
  }
});

test("a missing Mailchimp audience fails loud", async () => {
  const restore = mockFetch(() => ({ lists: [{ id: "aud-2", name: "Jackies" }] }));
  try {
    await assert.rejects(
      () => resolveMailchimpAudience("us1", "key", "Throwback"),
      AudienceRoutingError,
    );
  } finally {
    restore();
  }
});
