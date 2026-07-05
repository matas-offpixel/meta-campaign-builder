import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  copyLabel,
  DEFAULT_PAGES_FILTERS,
  fanPath,
  fanUrl,
  filterAndSortPages,
  type PagesListItem,
} from "../pages-list.ts";

const NOW = Date.parse("2026-07-05T00:00:00Z");

function item(over: Partial<PagesListItem>): PagesListItem {
  return {
    pageEventId: over.pageEventId ?? "pe",
    eventName: over.eventName ?? "Event",
    eventSlug: over.eventSlug ?? "event",
    status: over.status ?? "live",
    artworkUrl: over.artworkUrl ?? null,
    presaleAt: over.presaleAt ?? null,
    createdAt: over.createdAt ?? null,
    updatedAt: over.updatedAt ?? null,
    signupCount: over.signupCount ?? 0,
  };
}

describe("filterAndSortPages — search", () => {
  const items = [
    item({ pageEventId: "a", eventName: "Jackies Mallorca", eventSlug: "jackies-mallorca" }),
    item({ pageEventId: "b", eventName: "Junction 2", eventSlug: "junction-2" }),
  ];

  it("matches name case-insensitively", () => {
    const out = filterAndSortPages(items, { ...DEFAULT_PAGES_FILTERS, search: "JACKIES" }, NOW);
    assert.deepEqual(out.map((i) => i.pageEventId), ["a"]);
  });

  it("matches slug", () => {
    const out = filterAndSortPages(items, { ...DEFAULT_PAGES_FILTERS, search: "junction-2" }, NOW);
    assert.deepEqual(out.map((i) => i.pageEventId), ["b"]);
  });

  it("empty search returns all", () => {
    const out = filterAndSortPages(items, DEFAULT_PAGES_FILTERS, NOW);
    assert.equal(out.length, 2);
  });
});

describe("filterAndSortPages — hide past", () => {
  const items = [
    item({ pageEventId: "past", presaleAt: "2026-06-01T00:00:00Z" }),
    item({ pageEventId: "future", presaleAt: "2026-08-01T00:00:00Z" }),
    item({ pageEventId: "undated", presaleAt: null }),
  ];

  it("hides only strictly-past presale dates; keeps undated", () => {
    const out = filterAndSortPages(items, { ...DEFAULT_PAGES_FILTERS, hidePast: true }, NOW);
    assert.deepEqual(
      out.map((i) => i.pageEventId).sort(),
      ["future", "undated"],
    );
  });

  it("hide-past off keeps everything", () => {
    const out = filterAndSortPages(items, DEFAULT_PAGES_FILTERS, NOW);
    assert.equal(out.length, 3);
  });
});

describe("filterAndSortPages — sort", () => {
  const items = [
    item({ pageEventId: "a", presaleAt: "2026-08-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z", signupCount: 5 }),
    item({ pageEventId: "b", presaleAt: "2026-09-01T00:00:00Z", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z", signupCount: 50 }),
  ];

  it("presale desc", () => {
    const out = filterAndSortPages(items, { ...DEFAULT_PAGES_FILTERS, sort: "presale" }, NOW);
    assert.deepEqual(out.map((i) => i.pageEventId), ["b", "a"]);
  });
  it("created desc", () => {
    const out = filterAndSortPages(items, { ...DEFAULT_PAGES_FILTERS, sort: "created" }, NOW);
    assert.deepEqual(out.map((i) => i.pageEventId), ["b", "a"]);
  });
  it("edited desc", () => {
    const out = filterAndSortPages(items, { ...DEFAULT_PAGES_FILTERS, sort: "edited" }, NOW);
    assert.deepEqual(out.map((i) => i.pageEventId), ["a", "b"]);
  });
  it("signups desc", () => {
    const out = filterAndSortPages(items, { ...DEFAULT_PAGES_FILTERS, sort: "signups" }, NOW);
    assert.deepEqual(out.map((i) => i.pageEventId), ["b", "a"]);
  });

  it("null dates sink to the bottom", () => {
    const withNull = [item({ pageEventId: "n", presaleAt: null }), ...items];
    const out = filterAndSortPages(withNull, { ...DEFAULT_PAGES_FILTERS, sort: "presale" }, NOW);
    assert.equal(out[out.length - 1].pageEventId, "n");
  });

  it("does not mutate input", () => {
    const input = [...items];
    filterAndSortPages(input, { ...DEFAULT_PAGES_FILTERS, sort: "signups" }, NOW);
    assert.deepEqual(input.map((i) => i.pageEventId), ["a", "b"]);
  });
});

describe("copy helpers", () => {
  it("fanPath is origin-relative", () => {
    assert.equal(fanPath("gmc", "mallorca"), "/l/gmc/mallorca");
  });
  it("fanUrl joins origin without double slash", () => {
    assert.equal(fanUrl("https://app.offpixel.co.uk/", "gmc", "mallorca"), "https://app.offpixel.co.uk/l/gmc/mallorca");
    assert.equal(fanUrl("https://op909.com", "gmc", "mallorca"), "https://op909.com/l/gmc/mallorca");
  });
  it("copyLabel swaps to Copied then back to the path", () => {
    assert.equal(copyLabel("idle", "/l/gmc/mallorca"), "/l/gmc/mallorca");
    assert.equal(copyLabel("copied", "/l/gmc/mallorca"), "Copied");
  });
});
