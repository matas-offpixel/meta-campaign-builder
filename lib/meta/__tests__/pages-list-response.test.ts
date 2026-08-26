/**
 * Tests for GET /api/meta/pages payload assembly, cursor follow, and
 * useFetchPages cache policy. The Louder fixture reproduces the Parable
 * drop before the promote_pages merge is applied.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyPagesErrorToCache,
  applyPagesResponseToCache,
  buildPagesListPayload,
  bypassPagesCache,
  followCursors,
  pagesListIsDegraded,
  PAGES_ERROR_TTL_MS,
  PAGES_LIST_MAX_PAGES,
  PAGES_LIST_PAGINATION_CAP,
  PAGES_LOAD_INCOMPLETE_MESSAGE,
  readPagesError,
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

const LOUDER = page("100915612616202", "Louder Events");
const PARABLE = page("2102645759972384", "Parable");
const LOUDER_PROMOTE: MetaApiPage[] = [
  LOUDER,
  PARABLE,
  ...Array.from({ length: 25 }, (_, i) => page(`promo_${i + 1}`, `Promoted ${i + 1}`)),
];

function ok(pages: MetaApiPage[], truncated = false): PagesSourceFetch {
  return { pages, failed: false, truncated };
}

describe("buildPagesListPayload — success path", () => {
  it("all three sources succeed → degraded flags false and data order unchanged", () => {
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
      promote: 0,
      total: 4,
    });
    assert.equal(payload.degraded.client, false);
    assert.equal(payload.degraded.personal, false);
    assert.equal(pagesListIsDegraded(payload), false);
  });
});

describe("Louder account fixture — Parable drop (source mismatch)", () => {
  it("owned + personal without promote_pages hides Parable while Louder Events stays", () => {
    const today = buildPagesListPayload({
      businessPages: [LOUDER],
      client: ok([]),
      personal: ok([LOUDER]),
      tokenSource: "db",
    });
    assert.ok(
      today.data.some((p) => p.id === LOUDER.id),
      "Louder Events is on BM-owned /me and appears",
    );
    assert.equal(
      today.data.some((p) => p.id === PARABLE.id),
      false,
      "Parable is on promote_pages only — today's three sources drop it",
    );
  });

  it("merging promote_pages surfaces Parable and dedupes Louder Events", () => {
    const payload = buildPagesListPayload({
      businessPages: [LOUDER],
      client: ok([]),
      personal: ok([LOUDER]),
      promote: ok(LOUDER_PROMOTE),
      tokenSource: "db",
    });
    const ids = payload.data.map((p) => p.id);
    assert.ok(ids.includes(LOUDER.id));
    assert.ok(ids.includes(PARABLE.id), "Parable must appear once promote_pages is merged");
    assert.equal(ids.filter((id) => id === LOUDER.id).length, 1, "Louder Events is not duplicated");
    assert.equal(ids.filter((id) => id === PARABLE.id).length, 1);
    assert.equal(payload.sources.promote, LOUDER_PROMOTE.length);
    assert.equal(payload.sources.total, payload.data.length);
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
    assert.equal(payload.warning, PAGES_LOAD_INCOMPLETE_MESSAGE);
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

  it("promote_pages throws → degraded.promote true, other sources survive", async () => {
    const promote = await settlePagesSource(
      "promote",
      async () => {
        throw new Error("promote_pages 403");
      },
      () => {},
    );
    const payload = buildPagesListPayload({
      businessPages: [LOUDER],
      client: ok([]),
      personal: ok([LOUDER]),
      promote,
      tokenSource: "db",
    });
    assert.equal(payload.degraded.promote, true);
    assert.equal(pagesListIsDegraded(payload), true);
    assert.ok(payload.data.some((p) => p.id === LOUDER.id));
    assert.equal(payload.data.some((p) => p.id === PARABLE.id), false);
  });
});

describe("followCursors — exhaustion beyond one page", () => {
  it("walks every cursor page and does not stop after the first", async () => {
    const pageSize = 200;
    const total = 250;
    const warnings: string[] = [];
    const result = await followCursors(
      async (after) => {
        const start = after ? Number(after) : 0;
        const data = Array.from({ length: Math.min(pageSize, total - start) }, (_, i) => start + i);
        const next = start + data.length;
        return {
          data,
          after: next < total ? String(next) : null,
          hasNext: next < total,
        };
      },
      { warn: (code) => warnings.push(code) },
    );
    assert.equal(result.items.length, total);
    assert.equal(result.truncated, false);
    assert.deepEqual(warnings, []);
    assert.equal(result.items[0], 0);
    assert.equal(result.items[total - 1], total - 1);
  });

  it("names the cap instead of silently stopping", async () => {
    const warnings: Array<{ code: string; pages: number }> = [];
    const result = await followCursors(
      async (after) => {
        const start = after ? Number(after) : 0;
        return {
          data: [start],
          after: String(start + 1),
          hasNext: true,
        };
      },
      {
        maxPages: 3,
        warn: (code, pages) => warnings.push({ code, pages }),
      },
    );
    assert.equal(result.items.length, 3);
    assert.equal(result.truncated, true);
    assert.deepEqual(warnings, [{ code: PAGES_LIST_PAGINATION_CAP, pages: 3 }]);
    assert.ok(PAGES_LIST_MAX_PAGES >= 2, "hard cap must allow more than one Graph page");
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

  it("degraded response is NOT cached as success", () => {
    const cache = new Map<string, MetaApiPage[]>();
    const incoming = OWNED;
    const result = applyPagesResponseToCache(cache, "act_1", incoming, true);
    assert.equal(result.wroteCache, false);
    assert.equal(result.degraded, true);
    assert.equal(cache.has("act_1"), false);
    assert.equal(result.data.length, 2);
  });

  it("failed fetch is cached as an error with a short TTL, not as a page list", () => {
    const pages = new Map<string, MetaApiPage[]>();
    const errors = new Map();
    applyPagesErrorToCache(errors, "act_1", "rate limited", 1_000);
    assert.equal(pages.has("act_1"), false);
    assert.equal(readPagesError(errors, "act_1", 1_000), "rate limited");
    assert.equal(readPagesError(errors, "act_1", 1_000 + PAGES_ERROR_TTL_MS - 1), "rate limited");
    assert.equal(
      readPagesError(errors, "act_1", 1_000 + PAGES_ERROR_TTL_MS),
      null,
      "expired error must not poison the next open",
    );
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

  it("refetch() bypasses the cache including a cached error", () => {
    const cache = new Map<string, MetaApiPage[]>();
    const errors = new Map();
    applyPagesResponseToCache(cache, "act_1", [...OWNED, ...CLIENT], false);
    applyPagesErrorToCache(errors, "act_1", "boom", 1_000);
    assert.equal(cache.has("act_1"), true);
    bypassPagesCache(cache, "act_1", errors);
    assert.equal(cache.has("act_1"), false);
    assert.equal(readPagesError(errors, "act_1", 1_000), null);
    const after = applyPagesResponseToCache(cache, "act_1", OWNED, true);
    assert.equal(after.wroteCache, false);
    assert.equal(after.data.length, 2);
  });
});

describe("source-guards — picker reads the launch-validated page list", () => {
  it("pages route merges promote_pages and follows cursors", () => {
    const route = readFileSync("app/api/meta/pages/route.ts", "utf8");
    assert.match(route, /fetchPromotePages/);
    assert.match(route, /fetchPagedPageEdge/);
    assert.match(route, /owned_pages/);
    assert.match(route, /client_pages/);
    assert.match(route, /\/me\/accounts/);
    const client = readFileSync("lib/meta/client.ts", "utf8");
    assert.match(client, /promote_pages/);
    assert.match(client, /object_story_spec\.page_id/);
    assert.match(client, /followCursors/);
  });

  it("launch still writes the operator-picked page_id, not a new identity", () => {
    const creative = readFileSync("lib/meta/creative.ts", "utf8");
    assert.match(creative, /page_id: creative\.identity\.pageId/);
    assert.doesNotMatch(creative, /promote_pages/);
  });

  it("wizard picker surfaces the incomplete-load retry copy", () => {
    const creatives = readFileSync("components/steps/creatives.tsx", "utf8");
    assert.match(creatives, /couldn't load all pages — retry/);
    assert.match(creatives, /pages\.refetch/);
  });
});
