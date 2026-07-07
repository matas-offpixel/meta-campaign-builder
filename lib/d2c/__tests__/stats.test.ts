/**
 * Unit tests for lib/d2c/stats.ts#countMailchimpMembersByTag
 *
 * Verifies the Tags-API-first lookup: tag-search (id + name only) → a
 * follow-up getSegmentById(tagId) for the live member_count → segments
 * fallback → graceful error. Also byte-diffs the tag-search request (URL
 * encoding + auth header).
 *
 * NOTE: the real Mailchimp tag-search endpoint does NOT return member_count
 * (verified live against a real Throwback tag — see PR notes), so a
 * tag-search hit always requires the getSegmentById follow-up; it is never
 * "done" on tag-search alone.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import type { D2CConnection } from "../types.ts";

const baseConnection = (): D2CConnection => ({
  id: "conn-1",
  user_id: "u1",
  client_id: "cl1",
  provider: "mailchimp",
  credentials: {},
  external_account_id: "us7",
  status: "active",
  last_synced_at: null,
  last_error: null,
  live_enabled: true,
  approved_by_matas: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

/** Fake service-role client — only `.rpc()` is exercised by getD2CConnectionCredentials. */
function fakeSupabase() {
  return {
    rpc: async (_fn: string, _args: unknown) => ({
      data: { api_key: "testkey-us7", server_prefix: "us7" },
      error: null,
    }),
  };
}

let origFetch: typeof fetch;
let origKey: string | undefined;

beforeEach(() => {
  origFetch = globalThis.fetch;
  origKey = process.env.D2C_TOKEN_KEY;
  process.env.D2C_TOKEN_KEY = "test-d2c-token-key-0000";
});

afterEach(() => {
  globalThis.fetch = origFetch;
  if (origKey === undefined) delete process.env.D2C_TOKEN_KEY;
  else process.env.D2C_TOKEN_KEY = origKey;
});

describe("countMailchimpMembersByTag", () => {
  it("happy path: tag-search match + segment-by-id follow-up returns member_count", async () => {
    const calledUrls: string[] = [];
    mock.method(globalThis, "fetch", async (url: string) => {
      calledUrls.push(url);
      if (url.includes("/tag-search")) {
        return {
          ok: true,
          // Real tag-search responses carry NO member_count — id + name only.
          json: async () => ({ tags: [{ id: 8800269, name: "T26-ALGARVE" }], total_items: 1 }),
        } as Response;
      }
      assert.ok(
        url.includes("/segments/8800269"),
        `expected a getSegmentById follow-up by the tag's id, got: ${url}`,
      );
      return {
        ok: true,
        json: async () => ({
          id: 8800269,
          name: "T26-ALGARVE",
          type: "static",
          member_count: 342,
          created_at: "",
          updated_at: "",
        }),
      } as Response;
    });

    const { countMailchimpMembersByTag } = await import("../stats.ts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await countMailchimpMembersByTag(
      fakeSupabase() as any,
      baseConnection(),
      "c2b4d77acb",
      "T26-ALGARVE",
    );

    assert.equal(calledUrls.length, 2, "tag-search then a single segment-by-id follow-up");
    assert.ok(calledUrls[0]!.includes("/tag-search"));
    assert.ok(calledUrls[1]!.includes("/segments/8800269"));
    assert.ok("count" in result, `expected a count result, got: ${JSON.stringify(result)}`);
    if ("count" in result) {
      assert.equal(result.count, 342);
      assert.ok(result.asOf, "asOf timestamp should be set");
    }
  });

  it("falls back to the bulk segments listing when tag-search returns an empty tags array", async () => {
    const calledUrls: string[] = [];
    mock.method(globalThis, "fetch", async (url: string) => {
      calledUrls.push(url);
      if (url.includes("/tag-search")) {
        return { ok: true, json: async () => ({ tags: [], total_items: 0 }) } as Response;
      }
      assert.ok(url.includes("/segments") && !url.includes("/segments/"), `expected bulk segments fallback, got: ${url}`);
      return {
        ok: true,
        json: async () => ({
          segments: [{ id: 9, name: "T26-ALGARVE", type: "static", member_count: 88, created_at: "", updated_at: "" }],
          list_id: "c2b4d77acb",
          total_items: 1,
        }),
      } as Response;
    });

    const { countMailchimpMembersByTag } = await import("../stats.ts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await countMailchimpMembersByTag(
      fakeSupabase() as any,
      baseConnection(),
      "c2b4d77acb",
      "T26-ALGARVE",
    );

    assert.equal(calledUrls.length, 2, "should call tag-search then the bulk segments listing");
    assert.ok(calledUrls[0]!.includes("/tag-search"));
    assert.ok(!calledUrls[1]!.includes("/tag-search"));
    assert.ok("count" in result, `expected a count result, got: ${JSON.stringify(result)}`);
    if ("count" in result) assert.equal(result.count, 88);
  });

  it("returns a graceful error when both tag-search and the segments fallback are empty", async () => {
    mock.method(globalThis, "fetch", async (url: string) => {
      if (url.includes("/tag-search")) {
        return { ok: true, json: async () => ({ tags: [], total_items: 0 }) } as Response;
      }
      return { ok: true, json: async () => ({ segments: [], list_id: "x", total_items: 0 }) } as Response;
    });

    const { countMailchimpMembersByTag } = await import("../stats.ts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await countMailchimpMembersByTag(
      fakeSupabase() as any,
      baseConnection(),
      "c2b4d77acb",
      "T26-NONEXISTENT",
    );

    assert.ok("error" in result, `expected an error result, got: ${JSON.stringify(result)}`);
    if ("error" in result) {
      assert.match(result.error, /not found/i);
    }
  });

  it("byte-diffs the tag-search request: URL encoding + Basic auth header", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      if (String(url).includes("/tag-search")) {
        capturedUrl = url;
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        return { ok: true, json: async () => ({ tags: [], total_items: 0 }) } as Response;
      }
      // Segments fallback (unreached tag-search match means this fires next).
      return { ok: true, json: async () => ({ segments: [], list_id: "x", total_items: 0 }) } as Response;
    });

    const { countMailchimpMembersByTag } = await import("../stats.ts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await countMailchimpMembersByTag(
      fakeSupabase() as any,
      baseConnection(),
      "c2b4d77acb",
      "T26 ALGARVE & CO",
    );

    assert.ok(
      capturedUrl.startsWith("https://us7.api.mailchimp.com/3.0/lists/c2b4d77acb/tag-search"),
      `unexpected base/path: ${capturedUrl}`,
    );
    const parsed = new URL(capturedUrl);
    assert.equal(
      parsed.searchParams.get("name"),
      "T26 ALGARVE & CO",
      "URLSearchParams should decode back to the exact tag name regardless of encoding",
    );
    assert.ok(
      capturedUrl.includes(encodeURIComponent("T26 ALGARVE & CO").replace(/%20/g, "+")) ||
        capturedUrl.includes(encodeURIComponent("T26 ALGARVE & CO")),
      `expected the raw name to be percent-encoded in the URL: ${capturedUrl}`,
    );

    const authHeader = capturedHeaders["Authorization"];
    assert.ok(authHeader?.startsWith("Basic "), `Authorization should be Basic: ${authHeader}`);
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
    assert.ok(decoded.includes("testkey-us7"), `decoded auth should contain the api key: ${decoded}`);
  });
});
