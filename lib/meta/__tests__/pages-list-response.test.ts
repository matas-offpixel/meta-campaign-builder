/**
 * Tests for GET /api/meta/pages payload assembly and useFetchPages cache policy.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyPagesResponseToCache,
  buildPagesListPayload,
  bypassPagesCache,
  settlePagesSource,
  type PagesSourceFetch,
} from "../pages-list-response.ts";
import type { MetaApiPage } from "../../types.ts";

function page(id: string, name: string): MetaApiPage {
  return { id, name };
}

const OWNED = [page("1", "Owned A"), page("2", "Owned B")];
const CLIENT = [page("3", "Client A"), page("1", "Owned A dup")];
const PERSONAL = [page("4", "Personal A")];

function ok(pages: MetaApiPage[]): PagesSourceFetch {
  return { pages, failed: false };
}

describe("buildPagesListPayload — success path", () => {
  it("all three sources succeed → degraded both false and data order unchanged", () => {
    const payload = buildPagesListPayload({
      businessPages: OWNED,
      client: ok(CLIENT),
      personal: ok(PERSONAL),
      tokenSource: "db",
    });

    assert.deepEqual(
      payload.data.map((p) => p.id),
      ["1", "2", "3", "4"],
      "BM-owned first, then client, then personal; first-seen dedupe",
    );
    assert.equal(payload.count, 4);
    assert.equal(payload.tokenSource, "db");
    assert.deepEqual(payload.sources, {
      business: 2,
      client: 2,
      personal: 1,
      total: 4,
    });
    assert.deepEqual(payload.degraded, { client: false, personal: false });
  });
});

describe("buildPagesListPayload — source failure", () => {
  it("client_pages throws → degraded.client true, owned pages still returned", async () => {
    const logs: string[] = [];
    const client = await settlePagesSource(
      "client",
      async () => {
        throw new Error("(#17) User request limit reached");
      },
      (m) => logs.push(m),
    );
    const payload = buildPagesListPayload({
      businessPages: OWNED,
      client,
      personal: ok(PERSONAL),
      tokenSource: "db",
    });

    assert.equal(client.failed, true);
    assert.equal(payload.degraded.client, true);
    assert.equal(payload.degraded.personal, false);
    assert.deepEqual(
      payload.data.map((p) => p.id),
      ["1", "2", "4"],
    );
    assert.equal(payload.sources.business, 2);
    assert.equal(payload.sources.client, 0);
    assert.ok(logs.some((l) => l.includes("client") && l.includes("(#17)")));
    assert.ok(logs.every((l) => !/access_token|EAA/i.test(l)));
  });

  it("personal throws → degraded.personal true, HTTP-shape still a list payload", async () => {
    const personal = await settlePagesSource(
      "personal",
      async () => {
        throw new Error("rate limited");
      },
      () => {},
    );
    const payload = buildPagesListPayload({
      businessPages: OWNED,
      client: ok(CLIENT),
      personal,
      tokenSource: "env",
    });

    assert.equal(payload.degraded.personal, true);
    assert.equal(payload.degraded.client, false);
    assert.deepEqual(
      payload.data.map((p) => p.id),
      ["1", "2", "3"],
    );
    assert.equal(payload.sources.personal, 0);
  });
});

describe("useFetchPages cache policy", () => {
  it("successful response IS cached", () => {
    const cache = new Map<string, MetaApiPage[]>();
    const incoming = [...OWNED, ...CLIENT];
    const result = applyPagesResponseToCache(cache, "act_1", incoming, false);
    assert.equal(result.wroteCache, true);
    assert.equal(result.degraded, false);
    assert.equal(cache.get("act_1"), incoming);
    assert.equal(result.data.length, incoming.length);
  });

  it("degraded response is NOT cached", () => {
    const cache = new Map<string, MetaApiPage[]>();
    const incoming = OWNED;
    const result = applyPagesResponseToCache(cache, "act_1", incoming, true);
    assert.equal(result.wroteCache, false);
    assert.equal(result.degraded, true);
    assert.equal(cache.has("act_1"), false);
    assert.equal(result.data.length, 2);
  });

  it("degraded response does not overwrite a good longer cached array", () => {
    const cache = new Map<string, MetaApiPage[]>();
    const good = [...OWNED, ...CLIENT, ...PERSONAL];
    cache.set("act_1", good);
    const result = applyPagesResponseToCache(cache, "act_1", OWNED, true);
    assert.equal(result.wroteCache, false);
    assert.equal(result.data, good);
    assert.equal(cache.get("act_1"), good);
    assert.equal(result.degraded, true);
  });

  it("refetch() bypasses the cache", () => {
    const cache = new Map<string, MetaApiPage[]>();
    applyPagesResponseToCache(cache, "act_1", [...OWNED, ...CLIENT], false);
    assert.equal(cache.has("act_1"), true);
    bypassPagesCache(cache, "act_1");
    assert.equal(cache.has("act_1"), false);
    const after = applyPagesResponseToCache(cache, "act_1", OWNED, true);
    assert.equal(after.wroteCache, false);
    assert.equal(after.data.length, 2);
  });
});
