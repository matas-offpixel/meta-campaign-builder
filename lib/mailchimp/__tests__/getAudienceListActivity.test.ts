/**
 * Unit tests for lib/mailchimp/client.ts#getAudienceListActivity
 *
 * Verifies URL construction, auth header format, query params, and the
 * shape of the returned MailchimpActivityRow array.
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeActivityRow(
  day: string,
  subs: number,
  unsubs = 0,
  other_adds = 0,
  other_removes = 0,
) {
  return {
    day,
    emails_sent: 0,
    unique_opens: 0,
    recipient_clicks: 0,
    hard_bounce: 0,
    soft_bounce: 0,
    subs,
    unsubs,
    other_adds,
    other_removes,
  };
}

function makeActivityResponse(rows: ReturnType<typeof makeActivityRow>[]) {
  return {
    activity: rows,
    list_id: "abc123",
    total_items: rows.length,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getAudienceListActivity", () => {
  it("calls correct URL with dc, listId, count", async () => {
    const captured: { url: string; headers: Record<string, string> }[] = [];
    const rows = [makeActivityRow("2026-06-01", 10), makeActivityRow("2026-06-02", 5)];

    // Intercept fetch at module level via mock.method
    const originalFetch = globalThis.fetch;
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      captured.push({ url, headers: init?.headers as Record<string, string> ?? {} });
      return {
        ok: true,
        json: async () => makeActivityResponse(rows),
      } as Response;
    });

    try {
      const { getAudienceListActivity } = await import("../client.ts");
      const result = await getAudienceListActivity("testkey-us21", "us21", "abc123", 30);

      // URL contains dc, list path, and count param
      assert.ok(captured.length >= 1, "fetch should be called at least once");
      const calledUrl = captured[captured.length - 1]!.url;
      assert.ok(calledUrl.includes("us21.api.mailchimp.com"), `URL should use dc: ${calledUrl}`);
      assert.ok(calledUrl.includes("/lists/abc123/activity"), `URL should contain list activity path: ${calledUrl}`);
      assert.ok(calledUrl.includes("count=30"), `URL should include count param: ${calledUrl}`);

      // Auth header is Basic base64
      const authHeader = captured[captured.length - 1]!.headers["Authorization"];
      assert.ok(authHeader?.startsWith("Basic "), `Authorization should be Basic: ${authHeader}`);
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
      assert.ok(decoded.includes("testkey-us21"), `Decoded auth should contain apiKey: ${decoded}`);

      // Returns activity rows as-is
      assert.equal(result.length, 2);
      assert.equal(result[0]!.day, "2026-06-01");
      assert.equal(result[0]!.subs, 10);
      assert.equal(result[1]!.day, "2026-06-02");
      assert.equal(result[1]!.subs, 5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("caps count at 180", async () => {
    const captured: string[] = [];
    const originalFetch = globalThis.fetch;
    mock.method(globalThis, "fetch", async (url: string) => {
      captured.push(url);
      return {
        ok: true,
        json: async () => makeActivityResponse([]),
      } as Response;
    });

    try {
      const { getAudienceListActivity } = await import("../client.ts");
      await getAudienceListActivity("key-us21", "us21", "list1", 999);
      const calledUrl = captured[captured.length - 1]!;
      assert.ok(calledUrl.includes("count=180"), `count should be capped at 180: ${calledUrl}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns empty array when activity field is missing from response", async () => {
    const originalFetch = globalThis.fetch;
    mock.method(globalThis, "fetch", async () => {
      return {
        ok: true,
        json: async () => ({ list_id: "x", total_items: 0 }),
      } as Response;
    });

    try {
      const { getAudienceListActivity } = await import("../client.ts");
      const result = await getAudienceListActivity("key-us21", "us21", "list1", 10);
      assert.deepEqual(result, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
