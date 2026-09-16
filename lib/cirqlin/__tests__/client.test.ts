import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchCirqlinSignupsByTag,
  isCirqlinSignupsPayload,
} from "../client.ts";
import { CIRQLIN_LIVE_BODY, withSingularPage } from "./live-partner-body.ts";

const DOD = CIRQLIN_LIVE_BODY;

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

  it("rejects counted: NaN and a malformed daily row", () => {
    assert.equal(
      isCirqlinSignupsPayload({
        ...DOD,
        totals: { ...DOD.totals, counted: Number.NaN },
      }),
      false,
    );
    assert.equal(
      isCirqlinSignupsPayload({
        ...DOD,
        daily: [{ day: "not-a-day", signups: 12 }],
      }),
      false,
    );
    assert.equal(
      isCirqlinSignupsPayload({
        ...DOD,
        daily: [{ day: "2026-08-18", signups: Number.NaN }],
      }),
      false,
    );
    assert.equal(isCirqlinSignupsPayload(DOD), true);
  });

  it("accepts the live body's pages[] and rejects the singular page we used to expect", () => {
    assert.equal(isCirqlinSignupsPayload(CIRQLIN_LIVE_BODY), true);
    assert.equal(isCirqlinSignupsPayload(withSingularPage()), false);
    assert.equal(
      isCirqlinSignupsPayload({ ...CIRQLIN_LIVE_BODY, pages: "one" }),
      false,
    );
  });

  it("says a 200 failed the shape, not that its status was unexpected", async () => {
    const result = await fetchCirqlinSignupsByTag("CQ-dod-newcastle", {
      secret: "s",
      fetchImpl: async () =>
        new Response(JSON.stringify(withSingularPage()), { status: 200 }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "error");
      assert.equal(
        result.message,
        "response did not match the partner payload shape",
      );
    }
  });

  it("times out a fetch that never resolves", async () => {
    const result = await fetchCirqlinSignupsByTag("CQ-dod-newcastle", {
      secret: "s",
      timeoutMs: 20,
      fetchImpl: async (_url, init) =>
        new Promise((_, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error("expected AbortSignal");
          const onAbort = () =>
            reject(
              Object.assign(new Error("The operation was aborted"), {
                name: "TimeoutError",
              }),
            );
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "error");
      assert.equal(result.message, "Cirqlin fetch timed out");
    }
  });

  it("times out a fetch that ignores AbortSignal", async () => {
    const result = await fetchCirqlinSignupsByTag("CQ-dod-newcastle", {
      secret: "s",
      timeoutMs: 20,
      fetchImpl: () => new Promise(() => {}),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "error");
      assert.match(result.message ?? "", /timed out/i);
    }
  });

  it("times out a 200 whose body never settles", async () => {
    const result = await fetchCirqlinSignupsByTag("CQ-dod-newcastle", {
      secret: "s",
      timeoutMs: 20,
      fetchImpl: async () =>
        ({
          status: 200,
          ok: true,
          json: () => new Promise(() => {}),
        }) as Response,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "error");
      assert.match(result.message ?? "", /timed out/i);
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
      assert.equal(result.payload.pages.length, 1);
      assert.equal(result.payload.multiple, false);
      assert.equal(result.payload.daily_timezone, "Europe/London");
      const dailySum = result.payload.daily.reduce((n, d) => n + d.signups, 0);
      assert.equal(dailySum, 84);
    }
  });
});
