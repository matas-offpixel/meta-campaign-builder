import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { LONG_RUNNER_DAYS, mergeSeen, parseIngestFile, parseResponse, quoteNumericIds } from "../connector.ts";
import { parseSeed, planIngest, planPages, type StoredAd, type WatchedPage } from "../ingest.ts";

// Cut from two real ads_library_search responses (23 Nov 2026, GB, ACTIVE): page and ad fields only.
const FIXTURE = readFileSync(new URL("./fixtures/connector-2026-11-23.json", import.meta.url), "utf8");
const SEED = readFileSync(new URL("../../../scripts/ad-library-seed.json", import.meta.url), "utf8");

const BROADWICK = "314321628698217";
const MORALES = "443532440172";
const JULIAN = "29407418555548522"; // "Julian Fijma | Electric Brixton", delivery started 5 Nov 2026

const watchlist = new Map<string, WatchedPage>(
  parseSeed(SEED).pages.map((p) => [p.page_id, { pageId: p.page_id, name: p.name, kind: p.kind, active: p.active }]),
);

function refetched(at: string): string {
  return FIXTURE.replace('"fetched_at": "2026-11-23T23:30:00Z"', `"fetched_at": "${at}"`);
}

function apply(stored: Map<string, StoredAd>, fileText: string) {
  const file = parseIngestFile(fileText);
  const plan = planIngest({ seen: mergeSeen(file.calls), seenOn: file.seenOn, stored, watchlist });
  const next = new Map(stored);
  for (const row of [...plan.inserts, ...plan.updates.map((u) => u.row)]) next.set(row.ad_archive_id, structuredClone(row));
  return { plan, next };
}

describe("the connector file: the shape the probe recorded", () => {
  it("reads both calls, seven ads, ids as strings and starts as London dates", () => {
    const file = parseIngestFile(FIXTURE);
    assert.equal(file.seenOn, "2026-11-23");
    assert.deepEqual(file.skipped, []);
    assert.deepEqual(file.calls.map((c) => [c.pageIds, c.countries, c.ads.length, c.estimatedTotal]), [
      [[BROADWICK], ["GB"], 4, 25],
      [[MORALES], ["GB"], 3, 9],
    ]);
    const julian = file.calls[0]!.ads.find((a) => a.adArchiveId === JULIAN)!;
    assert.equal(julian.pageId, BROADWICK);
    assert.equal(julian.startDate, "2026-11-05");
    assert.equal(julian.linkTitle, "Julian Fijma | Electric Brixton");
    assert.equal(julian.snapshotUrl, `https://www.facebook.com/ads/library/?id=${JULIAN}`);
    assert.equal(julian.raw.page_id, BROADWICK);
  });

  it("keeps a page id longer than 2^53 exact", () => {
    const results = '{"estimated_total_count":1,"ads":[{"id":"1548227870106888","page_id":122094947192016633,"page_name":"Novels Lover"}]}';
    const parsed = parseResponse({ results }, ["GB"]);
    assert.ok(!("error" in parsed));
    assert.equal(parsed.ads[0]!.pageId, "122094947192016633");
    assert.equal(quoteNumericIds('{\\"page_id\\":122094947192016633}'), '{\\"page_id\\":\\"122094947192016633\\"}');
  });

  it("takes results already parsed into an object", () => {
    const parsed = parseResponse({ results: { estimated_total_count: 1, ads: [{ id: "1", page_id: "2", ad_delivery_start_time: 1795201832 }] } }, ["US", "GB"]);
    assert.ok(!("error" in parsed));
    assert.deepEqual(parsed.ads[0]!.countries, ["GB", "US"]);
  });

  it("skips a call that isn't ACTIVE-only, and says why", () => {
    const file = parseIngestFile(FIXTURE.replace('"ad_active_status": "ACTIVE",\n        "limit": 3', '"ad_active_status": "ALL",\n        "limit": 3'));
    assert.equal(file.calls.length, 1);
    assert.equal(file.skipped.length, 1);
    assert.match(file.skipped[0]!.reason, /not "ACTIVE"/);
  });

  it("unions countries when two calls return the same ad", () => {
    const file = parseIngestFile(FIXTURE);
    const us = { ...file.calls[0]!, countries: ["US"], ads: file.calls[0]!.ads.map((a) => ({ ...a, countries: ["US"] })) };
    const merged = mergeSeen([file.calls[0]!, us]);
    assert.equal(merged.length, 4);
    assert.ok(merged.every((a) => a.countries.join() === "GB,US"));
  });
});

describe("the ingest plan: upsert on ad_archive_id", () => {
  it("inserts every watched ad on the first read", () => {
    const { plan } = apply(new Map(), FIXTURE);
    assert.equal(plan.inserts.length, 7);
    assert.equal(plan.updates.length, 0);
    assert.ok(plan.inserts.every((r) => r.first_seen === "2026-11-23" && r.last_seen === "2026-11-23" && r.link_url === null && r.cta === null));
    assert.deepEqual(plan.longRunners, []);
  });

  it("re-ingesting the same file changes nothing", () => {
    const { next } = apply(new Map(), FIXTURE);
    const again = apply(next, FIXTURE).plan;
    assert.deepEqual([again.inserts.length, again.updates.length, again.unchanged], [0, 0, 7]);
  });

  it("a later read moves last_seen forward and nothing else", () => {
    const { next } = apply(new Map(), FIXTURE);
    const later = apply(next, refetched("2026-11-30T23:30:00Z")).plan;
    assert.equal(later.updates.length, 7);
    assert.ok(later.updates.every((u) => u.changed.join() === "last_seen" && u.row.last_seen === "2026-11-30" && u.row.first_seen === "2026-11-23"));
  });

  it("an older file moves first_seen back and never pulls last_seen back", () => {
    const { next } = apply(new Map(), FIXTURE);
    const older = apply(next, refetched("2026-11-16T10:00:00Z")).plan;
    assert.ok(older.updates.every((u) => u.changed.join() === "first_seen" && u.row.first_seen === "2026-11-16" && u.row.last_seen === "2026-11-23"));
  });

  it("keeps a stored link_url or cta the connector can't send", () => {
    const { next } = apply(new Map(), FIXTURE);
    next.set(JULIAN, { ...next.get(JULIAN)!, cta: "BOOK_TRAVEL", link_url: "https://example.com" });
    const again = apply(next, refetched("2026-11-30T12:00:00Z")).plan;
    const julian = again.updates.find((u) => u.row.ad_archive_id === JULIAN)!;
    assert.deepEqual([julian.row.cta, julian.row.link_url, julian.changed.join()], ["BOOK_TRAVEL", "https://example.com", "last_seen"]);
  });

  it(`flags long_runner at ${LONG_RUNNER_DAYS} days from Meta's start date, not from first_seen`, () => {
    const { next } = apply(new Map(), FIXTURE);
    const day29 = apply(next, refetched("2026-12-04T09:00:00Z")).plan;
    assert.deepEqual(day29.longRunners, []);
    const day30 = apply(next, refetched("2026-12-05T09:00:00Z")).plan;
    assert.deepEqual(day30.longRunners.map((l) => [l.adArchiveId, l.startDate, l.lastSeen, l.liveDays]), [[JULIAN, "2026-11-05", "2026-12-05", 30]]);
    // first_seen is 23 Nov: a first_seen rule would not flag it until 23 Dec.
    assert.equal(day30.updates.find((u) => u.row.ad_archive_id === JULIAN)!.row.first_seen, "2026-11-23");
  });

  it("skips ads from pages off the watchlist or inactive", () => {
    const off = new Map(watchlist);
    off.delete(MORALES);
    off.set(BROADWICK, { ...off.get(BROADWICK)!, active: false });
    const file = parseIngestFile(FIXTURE);
    const plan = planIngest({ seen: mergeSeen(file.calls), seenOn: file.seenOn, stored: new Map(), watchlist: off });
    assert.equal(plan.inserts.length, 0);
    assert.deepEqual(
      [...new Set(plan.offWatchlist.map((o) => `${o.ad.pageId}:${o.reason}`))].sort(),
      [`${BROADWICK}:page inactive`, `${MORALES}:not on the watchlist`],
    );
  });
});

describe("the seed: ad_library_pages", () => {
  it("lists the probe's six pages, unconfirmed, the artist derived from Broadwick", () => {
    const seed = parseSeed(SEED);
    assert.equal(seed.confirmed, false);
    assert.equal(seed.pages.length, 6);
    const morales = seed.pages.find((p) => p.page_id === MORALES)!;
    assert.deepEqual([morales.kind, morales.derived_from_page_id], ["artist", BROADWICK]);
    assert.equal(seed.pages.at(-1)!.page_id, MORALES, "parents first");
  });

  it("rejects an unknown kind, a duplicate and a missing parent", () => {
    const page = { page_id: "1", name: "X", kind: "promoter", derived_from_page_id: null };
    assert.throws(() => parseSeed(JSON.stringify({ pages: [{ ...page, kind: "venue" }] })), /kind must be one of/);
    assert.throws(() => parseSeed(JSON.stringify({ pages: [page, page] })), /listed twice/);
    assert.throws(() => parseSeed(JSON.stringify({ pages: [{ ...page, derived_from_page_id: "9" }] })), /not a page in the seed or the table/);
    assert.doesNotThrow(() => parseSeed(JSON.stringify({ pages: [{ ...page, derived_from_page_id: "9" }] }), new Set(["9"])));
  });

  it("plans pages against the table: a rerun changes nothing", () => {
    const seed = parseSeed(SEED);
    const first = planPages(seed.pages, new Map());
    assert.equal(first.inserts.length, 6);
    const stored = new Map(seed.pages.map((p) => [p.page_id, p]));
    assert.deepEqual(planPages(seed.pages, stored), { inserts: [], updates: [], unchanged: 6 });
  });
});
