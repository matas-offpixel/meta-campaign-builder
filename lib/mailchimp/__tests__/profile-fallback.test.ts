/**
 * Unit tests for lib/mailchimp/profile-fallback.ts.
 *
 * Root cause originally under test (2026-07-08 fix): the Mailchimp webhook
 * route only routed `profile`/`upemail`/`cleaned` through the tag re-fetch +
 * diff fallback. Mailchimp fires `subscribe` — never `tag_added` — when a
 * member is created with a tag already applied via the API (e.g. Evntree
 * pushing a fresh signup), so `subscribe` (and `unsubscribe`) fell into the
 * route's catch-all "ignored" branch and never reached `handleProfileUpdate`.
 *
 * 2026-07-09 pivot (PR #704): the fallback is now tag-tracking ONLY — the
 * email autoresponder moved to a Mailchimp Customer Journey, so
 * `runProfileFallback` must NOT fire anything. These tests assert the
 * reconcile still runs and the response no longer carries an `autoresp` key.
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import {
  extractProfileFallbackEmail,
  isProfileFallbackEventType,
  runProfileFallback,
} from "../profile-fallback.ts";

describe("isProfileFallbackEventType", () => {
  it("returns true for subscribe and unsubscribe (2026-07-08 fix)", () => {
    assert.equal(isProfileFallbackEventType("subscribe"), true);
    assert.equal(isProfileFallbackEventType("unsubscribe"), true);
  });

  it("returns true for the original profile/upemail/cleaned set", () => {
    assert.equal(isProfileFallbackEventType("profile"), true);
    assert.equal(isProfileFallbackEventType("upemail"), true);
    assert.equal(isProfileFallbackEventType("cleaned"), true);
  });

  it("returns false for tag_added/tag_removed, other Mailchimp types, and null", () => {
    assert.equal(isProfileFallbackEventType("tag_added"), false);
    assert.equal(isProfileFallbackEventType("tag_removed"), false);
    assert.equal(isProfileFallbackEventType("campaign"), false);
    assert.equal(isProfileFallbackEventType(null), false);
  });
});

describe("extractProfileFallbackEmail", () => {
  it("prefers data[new_email] over data[email] (upemail shape)", () => {
    const params = new URLSearchParams({
      "data[new_email]": "new@example.com",
      "data[email]": "old@example.com",
    });
    assert.equal(
      extractProfileFallbackEmail((k) => params.get(k)),
      "new@example.com",
    );
  });

  it("falls back to data[email] for subscribe/unsubscribe (no new_email key)", () => {
    const params = new URLSearchParams({ "data[email]": "fan@example.com" });
    assert.equal(
      extractProfileFallbackEmail((k) => params.get(k)),
      "fan@example.com",
    );
  });

  it("returns empty string when neither key is present", () => {
    const params = new URLSearchParams();
    assert.equal(
      extractProfileFallbackEmail((k) => params.get(k)),
      "",
    );
  });
});

describe("runProfileFallback", () => {
  it("subscribe branch: reconciles tags but NEVER fires (Customer Journey owns the email autoresp)", async () => {
    const handleProfileUpdate = mock.fn(async () => ({
      ok: true,
      reconciled: 1,
      addedEventIds: ["event-algarve"],
    }));

    const supabase = { marker: "fake-supabase-client" };
    const payload = await runProfileFallback(
      supabase,
      "client-throwback",
      "c2b4d77acb",
      "hello+finalproof@offpixel.co.uk",
      { handleProfileUpdate },
    );

    // Simulates a Mailchimp `subscribe` event for a member that already has
    // the event's tag applied (Evntree's API-driven signup flow). The tag
    // re-fetch + diff still runs (keeps mailchimp_tag_event_log accurate)...
    assert.equal(handleProfileUpdate.mock.callCount(), 1);
    assert.deepEqual(handleProfileUpdate.mock.calls[0]!.arguments, [
      supabase,
      "client-throwback",
      "c2b4d77acb",
      "hello+finalproof@offpixel.co.uk",
    ]);

    // ...but the response carries NO `autoresp` key: the per-fire email send
    // was removed in the 2026-07-09 pivot (PR #704). A fresh tag-add now
    // enters the account's Customer Journey, which sends the email itself.
    assert.deepEqual(payload, {
      mode: "profile_update",
      ok: true,
      reconciled: 1,
      addedEventIds: ["event-algarve"],
    });
    assert.equal("autoresp" in payload, false);
  });

  it("unsubscribe branch: reconciles a tag removal, no fire, stable shape", async () => {
    const handleProfileUpdate = mock.fn(async () => ({
      ok: true,
      reconciled: 1,
      addedEventIds: [],
    }));

    const payload = await runProfileFallback(
      { marker: "fake-supabase-client" },
      "client-throwback",
      "c2b4d77acb",
      "fan@example.com",
      { handleProfileUpdate },
    );

    assert.equal(handleProfileUpdate.mock.callCount(), 1);
    assert.deepEqual(payload, {
      mode: "profile_update",
      ok: true,
      reconciled: 1,
      addedEventIds: [],
    });
  });

  it("propagates a no_credentials failure verbatim", async () => {
    const handleProfileUpdate = mock.fn(async () => ({
      ok: false,
      reconciled: 0,
      addedEventIds: [],
      error: "no_credentials",
    }));

    const payload = await runProfileFallback(
      { marker: "fake-supabase-client" },
      "client-orphan",
      "aud-1",
      "someone@example.com",
      { handleProfileUpdate },
    );

    assert.deepEqual(payload, {
      mode: "profile_update",
      ok: false,
      reconciled: 0,
      addedEventIds: [],
      error: "no_credentials",
    });
  });
});
