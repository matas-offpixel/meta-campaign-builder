import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { fetchVenueDailyBudgetDetail } from "../venue-daily-budget-fetch.ts";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // `dispatchDailyBudgetUpdate` skips `window.dispatchEvent` when `window` is
  // undefined (Node test runtime), so no DOM stub is needed.
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchVenueDailyBudgetDetail defensive JSON", () => {
  it("HTML 504 body → reasonLabel 'Service temporarily unavailable', not a JSON parse exception", async () => {
    globalThis.fetch = (async () =>
      new Response(
        "<!DOCTYPE html><html><body>An error occurred</body></html>",
        { status: 504, headers: { "Content-Type": "text/html" } },
      )) as typeof fetch;

    await assert.rejects(
      () =>
        fetchVenueDailyBudgetDetail({
          clientId: "client-1",
          eventCode: "WC26-LON-FRA",
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        // The pre-fix bug would throw `Unexpected token '<', "<!DOCTYPE"... is not valid JSON`.
        // The defensive parse should swap that for a clean operator-facing message.
        assert.doesNotMatch(err.message, /Unexpected token/i);
        assert.equal(err.message, "Service temporarily unavailable");
        return true;
      },
    );
  });

  it("empty body → falls through to default reason, not a JSON parse exception", async () => {
    globalThis.fetch = (async () =>
      new Response("", { status: 502 })) as typeof fetch;

    await assert.rejects(
      () =>
        fetchVenueDailyBudgetDetail({
          clientId: "client-1",
          eventCode: "WC26-LON-FRA",
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.doesNotMatch(err.message, /Unexpected token/i);
        return true;
      },
    );
  });

  it("200 + valid JSON returns parsed detail", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          dailyBudget: 50,
          label: "daily",
          reason: null,
          reasonLabel: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const detail = await fetchVenueDailyBudgetDetail({
      clientId: "client-1",
      eventCode: "WC26-LON-FRA",
    });
    assert.equal(detail.dailyBudget, 50);
    assert.equal(detail.label, "daily");
    assert.equal(detail.reason, null);
  });

  it("200 + reason='no_active_adsets' surfaces the reason for downstream classification", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          dailyBudget: null,
          label: "daily",
          reason: "no_active_adsets",
          reasonLabel: "No active ad sets",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const detail = await fetchVenueDailyBudgetDetail({
      clientId: "client-1",
      eventCode: "WC26-LON-FRA",
    });
    assert.equal(detail.dailyBudget, null);
    assert.equal(detail.reason, "no_active_adsets");
    assert.equal(detail.reasonLabel, "No active ad sets");
  });
});
