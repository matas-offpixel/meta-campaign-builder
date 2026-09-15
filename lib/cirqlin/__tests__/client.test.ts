import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchCirqlinSignupsByTag } from "../client.ts";
import type { CirqlinSignupsPayload } from "../types.ts";

const DOD: CirqlinSignupsPayload = {
  ok: true,
  tag: "CQ-dod-newcastle",
  page: {
    id: "e0b4a82d-a530-49a8-a04d-e5494b947d14",
    slug: "dod-newcastle",
    title: "D.O.D",
    onsale_at: "2026-09-09T13:00:00.000Z",
    presale_at: "2026-09-09T11:00:00.000Z",
  },
  totals: { signups: 1844, spam_flagged: 1, counted: 1843 },
  daily: [
    { day: "2026-08-18", signups: 12 },
    { day: "2026-08-26", signups: 64 },
    { day: "2026-09-09", signups: 8 },
  ],
  sync: {
    mailchimp: { synced: 1837, failed: 4, skipped: 1 },
    bird: { synced: 0, failed: 0, skipped: 0 },
  },
  capturedAt: "2026-09-15T12:00:00.000Z",
};

describe("fetchCirqlinSignupsByTag", () => {
  it("returns not_configured when the secret is missing", async () => {
    const result = await fetchCirqlinSignupsByTag("CQ-dod-newcastle", {
      secret: "",
      fetchImpl: async () => {
        throw new Error("must not fetch");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "not_configured");
  });

  it("treats 401 as unauthorized", async () => {
    const result = await fetchCirqlinSignupsByTag("CQ-dod-newcastle", {
      secret: "s",
      base: "https://app.cirqlin.com",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: false }), { status: 401 }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unauthorized");
  });

  it("treats 404 as no page for the tag", async () => {
    const result = await fetchCirqlinSignupsByTag("missing-tag", {
      secret: "s",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: false }), { status: 404 }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "no_page");
  });

  it("never throws when Cirqlin is down — Mailchimp can still write", async () => {
    const result = await fetchCirqlinSignupsByTag("CQ-dod-newcastle", {
      secret: "s",
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "error");
      assert.equal(result.message, "ECONNRESET");
    }
  });

  it("returns the D.O.D payload", async () => {
    const result = await fetchCirqlinSignupsByTag("CQ-dod-newcastle", {
      secret: "s",
      fetchImpl: async (url, init) => {
        assert.equal(
          String(url),
          "https://app.cirqlin.com/api/partner/signups?tag=CQ-dod-newcastle",
        );
        assert.equal(
          (init?.headers as Record<string, string>).Authorization,
          "Bearer s",
        );
        return new Response(JSON.stringify(DOD), { status: 200 });
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.totals.counted, 1843);
      assert.equal(result.payload.totals.spam_flagged, 1);
      assert.equal(result.payload.sync.mailchimp.failed, 4);
      const dailySum = result.payload.daily.reduce((n, d) => n + d.signups, 0);
      assert.equal(dailySum, 84);
    }
  });
});
