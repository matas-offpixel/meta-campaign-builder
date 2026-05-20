import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BULK_WEBSITE_PIXEL_EVENTS,
  DEFAULT_WEBSITE_RETENTIONS,
  META_MAX_WEBSITE_RETENTION_DAYS,
  buildWebsitePreview,
  clampWebsiteRetentionDays,
  funnelStageForWebsiteCell,
  isBulkWebsitePixelEvent,
  websitePreviewToInserts,
} from "../bulk-website-types.ts";

// ── 1. Type predicates + constants ────────────────────────────────────────────

describe("isBulkWebsitePixelEvent", () => {
  it("accepts declared pixel events", () => {
    for (const ev of BULK_WEBSITE_PIXEL_EVENTS) {
      assert.ok(isBulkWebsitePixelEvent(ev));
    }
  });

  it("rejects arbitrary strings and non-strings", () => {
    assert.ok(!isBulkWebsitePixelEvent("page_engagement_fb"));
    assert.ok(!isBulkWebsitePixelEvent("Purchase"));
    assert.ok(!isBulkWebsitePixelEvent(""));
    assert.ok(!isBulkWebsitePixelEvent(undefined));
    assert.ok(!isBulkWebsitePixelEvent(42));
  });
});

// ── 2. Retention clamping ─────────────────────────────────────────────────────

describe("clampWebsiteRetentionDays", () => {
  it("passes through valid values", () => {
    assert.equal(clampWebsiteRetentionDays(30), 30);
    assert.equal(clampWebsiteRetentionDays(1), 1);
    assert.equal(clampWebsiteRetentionDays(META_MAX_WEBSITE_RETENTION_DAYS), META_MAX_WEBSITE_RETENTION_DAYS);
  });

  it("clamps above cap to META_MAX_WEBSITE_RETENTION_DAYS", () => {
    assert.equal(clampWebsiteRetentionDays(365), META_MAX_WEBSITE_RETENTION_DAYS);
    assert.equal(clampWebsiteRetentionDays(999), META_MAX_WEBSITE_RETENTION_DAYS);
  });

  it("clamps below 1 to 1", () => {
    assert.equal(clampWebsiteRetentionDays(0), 1);
    assert.equal(clampWebsiteRetentionDays(-10), 1);
  });

  it("handles non-finite values (NaN, Infinity) by returning 1", () => {
    // Number.isFinite(NaN) = false and Number.isFinite(Infinity) = false → early return 1
    assert.equal(clampWebsiteRetentionDays(NaN), 1);
    assert.equal(clampWebsiteRetentionDays(Infinity), 1);
  });
});

// ── 3. Funnel stage mapping ───────────────────────────────────────────────────

describe("funnelStageForWebsiteCell", () => {
  it("maps ≥180 → top_of_funnel", () => {
    assert.equal(funnelStageForWebsiteCell(180), "top_of_funnel");
    assert.equal(funnelStageForWebsiteCell(365), "top_of_funnel");
  });

  it("maps 60–179 → mid_funnel", () => {
    assert.equal(funnelStageForWebsiteCell(60), "mid_funnel");
    assert.equal(funnelStageForWebsiteCell(90), "mid_funnel");
    assert.equal(funnelStageForWebsiteCell(179), "mid_funnel");
  });

  it("maps <60 → bottom_funnel", () => {
    assert.equal(funnelStageForWebsiteCell(30), "bottom_funnel");
    assert.equal(funnelStageForWebsiteCell(1), "bottom_funnel");
    assert.equal(funnelStageForWebsiteCell(59), "bottom_funnel");
  });
});

// ── 4. buildWebsitePreview — cell count ──────────────────────────────────────

const BASE_OPTS = {
  clientSlug: "junction2",
  clientName: "Junction 2",
  pixelId: "123456789012345",
  pixelEvents: ["PageView"] as const,
  urlKeywords: [] as string[],
  retentions: [30, 60, 180],
};

describe("buildWebsitePreview — cell count", () => {
  it("produces events × retentions cells", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS });
    assert.equal(preview.cells.length, 1 * 3); // 1 event × 3 retentions
  });

  it("cell order: event first, retention in input order (routes pre-sort before calling)", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [30, 60, 180] });
    assert.equal(preview.cells[0]?.retentionDays, 30);
    assert.equal(preview.cells[1]?.retentionDays, 60);
    assert.equal(preview.cells[2]?.retentionDays, 180);
  });

  it("returns empty cells when no events", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, pixelEvents: [] });
    assert.equal(preview.cells.length, 0);
  });

  it("returns empty cells when no retentions", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [] });
    assert.equal(preview.cells.length, 0);
  });
});

// ── 5. Duplicate-cell prevention (dedup by pixelEvent + clampedRetention) ────

describe("buildWebsitePreview — dedup", () => {
  it("180 + 365 yields ONE 180d cell (365 clamps to 180)", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [180, 365] });
    assert.equal(preview.cells.length, 1);
    assert.equal(preview.cells[0]?.retentionDays, 180);
  });

  it("default retentions (no 365) produce no duplicates", () => {
    const preview = buildWebsitePreview({
      ...BASE_OPTS,
      retentions: Array.from(DEFAULT_WEBSITE_RETENTIONS),
    });
    assert.equal(preview.cells.length, DEFAULT_WEBSITE_RETENTIONS.length);
    const days = preview.cells.map((c) => c.retentionDays);
    assert.equal(new Set(days).size, days.length, "no duplicate retention days");
  });

  it("a single >180 value clamps to 180 and yields one cell", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [365] });
    assert.equal(preview.cells.length, 1);
    assert.equal(preview.cells[0]?.retentionDays, META_MAX_WEBSITE_RETENTION_DAYS);
  });

  it("duplicate raw inputs (e.g. 180, 180, 365) still yield one 180d cell", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [180, 180, 365] });
    assert.equal(preview.cells.length, 1);
  });
});

// ── 6. buildWebsitePreview — naming ──────────────────────────────────────────

describe("buildWebsitePreview — naming", () => {
  it("whole pixel (no URLs): [prefix] event retention", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [30] });
    assert.equal(preview.cells[0]?.name, "[junction2] PageView 30d");
  });

  it("single URL: [prefix] event url retention", () => {
    const preview = buildWebsitePreview({
      ...BASE_OPTS,
      urlKeywords: ["https://junction2.com/events/glasgow"],
      retentions: [30],
    });
    assert.equal(
      preview.cells[0]?.name,
      "[junction2] PageView https://junction2.com/events/glasgow 30d",
    );
  });

  it("two URLs: [prefix] event first-url +1 retention", () => {
    const preview = buildWebsitePreview({
      ...BASE_OPTS,
      urlKeywords: ["https://junction2.com/glasgow", "https://junction2.com/london"],
      retentions: [30],
    });
    assert.equal(
      preview.cells[0]?.name,
      "[junction2] PageView https://junction2.com/glasgow +1 30d",
    );
  });

  it("three URLs: [prefix] event first-url +2 retention", () => {
    const preview = buildWebsitePreview({
      ...BASE_OPTS,
      urlKeywords: ["https://a.com", "https://b.com", "https://c.com"],
      retentions: [30],
    });
    assert.equal(preview.cells[0]?.name, "[junction2] PageView https://a.com +2 30d");
  });

  it("uses labelOverride as prefix", () => {
    const preview = buildWebsitePreview({
      ...BASE_OPTS,
      labelOverride: "J2 Custom",
      retentions: [30],
    });
    assert.equal(preview.cells[0]?.name, "[J2 Custom] PageView 30d");
  });

  it("falls back to clientName when no slug", () => {
    const preview = buildWebsitePreview({
      ...BASE_OPTS,
      clientSlug: null,
      retentions: [30],
    });
    assert.equal(preview.cells[0]?.name, "[Junction 2] PageView 30d");
  });

  it("clamps retentions to META_MAX_WEBSITE_RETENTION_DAYS", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [365] });
    assert.equal(preview.cells[0]?.retentionDays, META_MAX_WEBSITE_RETENTION_DAYS);
    assert.ok(preview.cells[0]?.name.endsWith(`${META_MAX_WEBSITE_RETENTION_DAYS}d`));
  });
});

// ── 7. buildWebsitePreview — funnel stage mapping ────────────────────────────

describe("buildWebsitePreview — funnel stages", () => {
  it("assigns correct funnel stages to cells", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [30, 60, 180] });
    const stages = preview.cells.map((c) => c.funnelStage);
    assert.deepEqual(stages, ["bottom_funnel", "mid_funnel", "top_of_funnel"]);
  });
});

// ── 8. buildWebsitePreview — urlKeywords passthrough ─────────────────────────

describe("buildWebsitePreview — urlKeywords", () => {
  it("empty urlKeywords = whole pixel", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [30] });
    assert.deepEqual(preview.urlKeywords, []);
    assert.deepEqual(preview.cells[0]?.urlKeywords, []);
  });

  it("single URL passed through to cells", () => {
    const preview = buildWebsitePreview({
      ...BASE_OPTS,
      urlKeywords: ["https://example.com"],
      retentions: [30],
    });
    assert.deepEqual(preview.urlKeywords, ["https://example.com"]);
    assert.deepEqual(preview.cells[0]?.urlKeywords, ["https://example.com"]);
  });

  it("multiple URLs passed through to all cells unchanged", () => {
    const urls = ["https://a.com", "https://b.com"];
    const preview = buildWebsitePreview({
      ...BASE_OPTS,
      urlKeywords: urls,
      retentions: [30, 60],
    });
    assert.deepEqual(preview.urlKeywords, urls);
    for (const cell of preview.cells) {
      assert.deepEqual(cell.urlKeywords, urls);
    }
  });
});

// ── 9. websitePreviewToInserts ────────────────────────────────────────────────

describe("websitePreviewToInserts", () => {
  const insertOpts = { userId: "u1", clientId: "c1", metaAdAccountId: "act_999" };

  it("produces one insert per cell", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [30, 60] });
    const inserts = websitePreviewToInserts(preview, insertOpts);
    assert.equal(inserts.length, 2);
  });

  it("sourceId carries the pixel ID", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [30] });
    const [insert] = websitePreviewToInserts(preview, insertOpts);
    assert.equal(insert?.sourceId, "123456789012345");
  });

  it("audienceSubtype is website_pixel", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [30] });
    const [insert] = websitePreviewToInserts(preview, insertOpts);
    assert.equal(insert?.audienceSubtype, "website_pixel");
  });

  it("sourceMeta.subtype is website_pixel", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [30] });
    const [insert] = websitePreviewToInserts(preview, insertOpts);
    const sm = insert?.sourceMeta as Record<string, unknown> | undefined;
    assert.equal(sm?.subtype, "website_pixel");
  });

  it("sourceMeta.urlContains is [] for whole-pixel mode", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [30] });
    const [insert] = websitePreviewToInserts(preview, insertOpts);
    const sm = insert?.sourceMeta as Record<string, unknown> | undefined;
    assert.deepEqual(sm?.urlContains, []);
  });

  it("sourceMeta.urlContains has 1 entry for a single URL", () => {
    const preview = buildWebsitePreview({
      ...BASE_OPTS,
      urlKeywords: ["https://example.com/glasgow"],
      retentions: [30],
    });
    const [insert] = websitePreviewToInserts(preview, insertOpts);
    const sm = insert?.sourceMeta as Record<string, unknown> | undefined;
    assert.deepEqual(sm?.urlContains, ["https://example.com/glasgow"]);
  });

  it("sourceMeta.urlContains has 2 entries for two URLs (OR-group)", () => {
    const urls = ["https://example.com/glasgow", "https://example.com/london"];
    const preview = buildWebsitePreview({
      ...BASE_OPTS,
      urlKeywords: urls,
      retentions: [30],
    });
    const [insert] = websitePreviewToInserts(preview, insertOpts);
    const sm = insert?.sourceMeta as Record<string, unknown> | undefined;
    assert.deepEqual(sm?.urlContains, urls);
  });

  it("all cells in a matrix share the same urlKeywords", () => {
    const urls = ["https://a.com", "https://b.com"];
    const preview = buildWebsitePreview({
      ...BASE_OPTS,
      urlKeywords: urls,
      retentions: [30, 60, 180],
    });
    const inserts = websitePreviewToInserts(preview, insertOpts);
    for (const insert of inserts) {
      const sm = insert.sourceMeta as Record<string, unknown>;
      assert.deepEqual(sm.urlContains, urls);
    }
  });

  it("sourceMeta.pixelEvent is PageView", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [30] });
    const [insert] = websitePreviewToInserts(preview, insertOpts);
    const sm = insert?.sourceMeta as Record<string, unknown> | undefined;
    assert.equal(sm?.pixelEvent, "PageView");
  });

  it("eventId is null (client-level audience)", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [30] });
    const [insert] = websitePreviewToInserts(preview, insertOpts);
    assert.equal(insert?.eventId, null);
  });

  it("carries userId, clientId, metaAdAccountId", () => {
    const preview = buildWebsitePreview({ ...BASE_OPTS, retentions: [30] });
    const [insert] = websitePreviewToInserts(preview, insertOpts);
    assert.equal(insert?.userId, "u1");
    assert.equal(insert?.clientId, "c1");
    assert.equal(insert?.metaAdAccountId, "act_999");
  });
});
