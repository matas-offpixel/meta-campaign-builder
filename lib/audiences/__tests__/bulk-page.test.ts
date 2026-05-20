import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_PAGE_ENGAGEMENT_SOURCES } from "../../meta/audience-payload.ts";
import {
  BULK_PAGE_SUBTYPES,
  DEFAULT_PAGE_RETENTIONS,
  buildPagePreview,
  clampRetentionDays,
  funnelStageForCell,
  isBulkPageSubtype,
  isFollowersSubtype,
  isIgSubtype,
  pagePreviewToInserts,
  type BulkPagePreview,
  type BulkPageSubtype,
} from "../bulk-page-types.ts";

// ── 1. Type predicates + constants ────────────────────────────────────────────

describe("isBulkPageSubtype", () => {
  it("accepts the 4 page-sourced subtypes", () => {
    for (const s of BULK_PAGE_SUBTYPES) assert.ok(isBulkPageSubtype(s));
  });

  it("rejects video / pixel / arbitrary strings", () => {
    assert.ok(!isBulkPageSubtype("video_views"));
    assert.ok(!isBulkPageSubtype("website_pixel"));
    assert.ok(!isBulkPageSubtype("foo"));
    assert.ok(!isBulkPageSubtype(undefined));
    assert.ok(!isBulkPageSubtype(123));
  });
});

describe("isIgSubtype / isFollowersSubtype", () => {
  it("isIgSubtype marks both IG subtypes", () => {
    assert.ok(isIgSubtype("page_engagement_ig"));
    assert.ok(isIgSubtype("page_followers_ig"));
    assert.ok(!isIgSubtype("page_engagement_fb"));
    assert.ok(!isIgSubtype("page_followers_fb"));
  });

  it("isFollowersSubtype marks both followers subtypes", () => {
    assert.ok(isFollowersSubtype("page_followers_fb"));
    assert.ok(isFollowersSubtype("page_followers_ig"));
    assert.ok(!isFollowersSubtype("page_engagement_fb"));
    assert.ok(!isFollowersSubtype("page_engagement_ig"));
  });
});

describe("DEFAULT_PAGE_RETENTIONS", () => {
  it("exposes 30 / 60 / 180 / 365", () => {
    assert.deepEqual([...DEFAULT_PAGE_RETENTIONS], [30, 60, 180, 365]);
  });
});

// ── 2. Retention clamp + funnel mapping ───────────────────────────────────────

describe("clampRetentionDays", () => {
  it("clamps below 1", () => {
    assert.equal(clampRetentionDays(0), 1);
    assert.equal(clampRetentionDays(-5), 1);
  });
  it("clamps above 365", () => {
    assert.equal(clampRetentionDays(400), 365);
    assert.equal(clampRetentionDays(1000), 365);
  });
  it("preserves valid values + truncates fractions", () => {
    assert.equal(clampRetentionDays(60), 60);
    assert.equal(clampRetentionDays(180.7), 180);
  });
  it("returns 1 for non-finite input", () => {
    assert.equal(clampRetentionDays(Number.NaN), 1);
    assert.equal(clampRetentionDays(Infinity), 1);
  });
});

describe("funnelStageForCell", () => {
  it("followers (any retention) → top_of_funnel", () => {
    assert.equal(funnelStageForCell("page_followers_fb", 30), "top_of_funnel");
    assert.equal(funnelStageForCell("page_followers_fb", 365), "top_of_funnel");
    assert.equal(funnelStageForCell("page_followers_ig", 60), "top_of_funnel");
  });

  it("engagement ≥180 → top_of_funnel (matches FUNNEL_STAGE_PRESETS)", () => {
    assert.equal(funnelStageForCell("page_engagement_fb", 180), "top_of_funnel");
    assert.equal(funnelStageForCell("page_engagement_fb", 365), "top_of_funnel");
    assert.equal(funnelStageForCell("page_engagement_ig", 365), "top_of_funnel");
  });

  it("engagement 60–179 → mid_funnel", () => {
    assert.equal(funnelStageForCell("page_engagement_fb", 60), "mid_funnel");
    assert.equal(funnelStageForCell("page_engagement_ig", 90), "mid_funnel");
    assert.equal(funnelStageForCell("page_engagement_fb", 179), "mid_funnel");
  });

  it("engagement <60 → bottom_funnel", () => {
    assert.equal(funnelStageForCell("page_engagement_fb", 30), "bottom_funnel");
    assert.equal(funnelStageForCell("page_engagement_ig", 14), "bottom_funnel");
  });
});

// ── 3. buildPagePreview — matrix shape ────────────────────────────────────────

describe("buildPagePreview matrix shape", () => {
  it("1 engagement + 1 followers × 4 retentions = 5 cells (engagement×4 + followers×1)", () => {
    const preview = buildPagePreview({
      clientSlug: "innervisions",
      clientName: "Innervisions",
      subtypes: ["page_engagement_fb", "page_followers_fb"],
      retentions: [...DEFAULT_PAGE_RETENTIONS],
      fbPageIds: ["100"],
      fbSummaries: [{ id: "100", name: "Innervisions" }],
      igAccountIds: [],
      igSummaries: [],
    });
    // engagement×4 retentions + followers×1 = 5
    assert.equal(preview.cells.length, 5);
    // Subtype grouping: engagement cells come first, then the single followers cell.
    assert.equal(preview.cells[0]!.subtype, "page_engagement_fb");
    assert.equal(preview.cells[3]!.subtype, "page_engagement_fb");
    assert.equal(preview.cells[4]!.subtype, "page_followers_fb");
  });

  it("followers always produce exactly 1 cell regardless of retention count", () => {
    for (const subtype of ["page_followers_fb", "page_followers_ig"] as const) {
      const ids = isIgSubtype(subtype) ? [] : ["100"];
      const igIds = isIgSubtype(subtype) ? ["200"] : [];
      const preview = buildPagePreview({
        clientSlug: "x",
        clientName: "X",
        subtypes: [subtype],
        retentions: [30, 60, 180, 365],
        fbPageIds: ids,
        fbSummaries: [],
        igAccountIds: igIds,
        igSummaries: [],
      });
      assert.equal(preview.cells.length, 1, `${subtype} should produce 1 cell`);
    }
  });

  it("4 subtypes × 4 retentions → 2 engagement×4 + 2 followers×1 = 10 cells", () => {
    const preview = buildPagePreview({
      clientSlug: "innervisions",
      clientName: "Innervisions",
      subtypes: [...BULK_PAGE_SUBTYPES],
      retentions: [...DEFAULT_PAGE_RETENTIONS],
      fbPageIds: ["100"],
      fbSummaries: [{ id: "100", name: "Innervisions" }],
      igAccountIds: ["200"],
      igSummaries: [{ id: "200", name: "@innervisions" }],
    });
    // 2 engagement subtypes × 4 retentions + 2 followers subtypes × 1 = 10
    assert.equal(preview.cells.length, 10);
  });

  it("only engagement subtypes still produce the full N×M matrix", () => {
    const preview = buildPagePreview({
      clientSlug: "x",
      clientName: "X",
      subtypes: ["page_engagement_fb", "page_engagement_ig"],
      retentions: [30, 60, 180, 365],
      fbPageIds: ["100"],
      fbSummaries: [],
      igAccountIds: ["200"],
      igSummaries: [],
    });
    // 2 engagement × 4 retentions = 8
    assert.equal(preview.cells.length, 8);
  });
});

// ── 4. buildPagePreview — naming + label override ─────────────────────────────

describe("buildPagePreview naming", () => {
  it("defaults to client slug as the bracketed prefix", () => {
    const preview = buildPagePreview({
      clientSlug: "innervisions",
      clientName: "Innervisions",
      subtypes: ["page_engagement_fb"],
      retentions: [180],
      fbPageIds: ["100"],
      fbSummaries: [{ id: "100", name: "Innervisions" }],
      igAccountIds: [],
      igSummaries: [],
    });
    assert.equal(preview.labelPrefix, "innervisions");
    assert.equal(preview.cells[0]!.name, "[innervisions] FB page engagement 180d");
  });

  it("followers cell has NO retention suffix (always-live naming)", () => {
    const preview = buildPagePreview({
      clientSlug: "innervisions",
      clientName: "Innervisions",
      subtypes: ["page_followers_fb", "page_followers_ig"],
      retentions: [30, 60, 180, 365],
      fbPageIds: ["100"],
      fbSummaries: [],
      igAccountIds: ["200"],
      igSummaries: [],
    });
    // Two followers subtypes → exactly 2 cells
    assert.equal(preview.cells.length, 2);
    assert.equal(preview.cells[0]!.name, "[innervisions] FB page followers");
    assert.equal(preview.cells[1]!.name, "[innervisions] IG page followers");
    // Retention sentinel is 365 (always-live convention)
    assert.equal(preview.cells[0]!.retentionDays, 365);
    assert.equal(preview.cells[1]!.retentionDays, 365);
    // Funnel stage for followers is always top_of_funnel
    assert.equal(preview.cells[0]!.funnelStage, "top_of_funnel");
  });

  it("labelOverride applied to followers cell name", () => {
    const preview = buildPagePreview({
      clientSlug: "innervisions",
      clientName: "Innervisions",
      labelOverride: "Spring Tour",
      subtypes: ["page_followers_fb"],
      retentions: [30, 60, 180],
      fbPageIds: ["100"],
      fbSummaries: [],
      igAccountIds: [],
      igSummaries: [],
    });
    assert.equal(preview.cells.length, 1);
    assert.equal(preview.cells[0]!.name, "[Spring Tour] FB page followers");
  });

  it("falls back to client name when slug is null", () => {
    const preview = buildPagePreview({
      clientSlug: null,
      clientName: "Off/Pixel",
      subtypes: ["page_engagement_fb"],
      retentions: [60],
      fbPageIds: ["100"],
      fbSummaries: [],
      igAccountIds: [],
      igSummaries: [],
    });
    assert.equal(preview.labelPrefix, "Off/Pixel");
  });

  it("labelOverride takes precedence over slug", () => {
    const preview = buildPagePreview({
      clientSlug: "innervisions",
      clientName: "Innervisions",
      labelOverride: "Custom Tour",
      subtypes: ["page_engagement_ig"],
      retentions: [365],
      fbPageIds: [],
      fbSummaries: [],
      igAccountIds: ["200"],
      igSummaries: [],
    });
    assert.equal(preview.labelPrefix, "Custom Tour");
    assert.equal(
      preview.cells[0]!.name,
      "[Custom Tour] IG page engagement 365d",
    );
  });

  it("retention is clamped before naming", () => {
    const preview = buildPagePreview({
      clientSlug: "x",
      clientName: "X",
      subtypes: ["page_engagement_fb"],
      retentions: [400],
      fbPageIds: ["1"],
      fbSummaries: [],
      igAccountIds: [],
      igSummaries: [],
    });
    assert.equal(preview.cells[0]!.retentionDays, 365);
    assert.equal(preview.cells[0]!.name, "[x] FB page engagement 365d");
  });
});

// ── 5. buildPagePreview — split detection ─────────────────────────────────────

describe("buildPagePreview split detection (Meta 5-source cap)", () => {
  it("≤5 sources → willSplit false, partCount 1", () => {
    const preview = buildPagePreview({
      clientSlug: "x",
      clientName: "X",
      subtypes: ["page_engagement_fb"],
      retentions: [180],
      fbPageIds: ["1", "2", "3", "4", "5"],
      fbSummaries: [],
      igAccountIds: [],
      igSummaries: [],
    });
    assert.equal(preview.anySplit, false);
    assert.equal(preview.cells[0]!.willSplit, false);
    assert.equal(preview.cells[0]!.partCount, 1);
  });

  it("7 FB pages → willSplit true, partCount 2 for FB cells only", () => {
    const ids = ["1", "2", "3", "4", "5", "6", "7"];
    const preview = buildPagePreview({
      clientSlug: "x",
      clientName: "X",
      subtypes: ["page_engagement_fb", "page_engagement_ig"],
      retentions: [60],
      fbPageIds: ids,
      fbSummaries: [],
      igAccountIds: ["200"],
      igSummaries: [],
    });
    assert.equal(preview.anySplit, true);
    // FB cell splits into 2.
    const fb = preview.cells.find((c) => c.subtype === "page_engagement_fb");
    assert.ok(fb);
    assert.equal(fb.willSplit, true);
    assert.equal(fb.partCount, 2);
    // IG cell with 1 source does NOT split.
    const ig = preview.cells.find((c) => c.subtype === "page_engagement_ig");
    assert.ok(ig);
    assert.equal(ig.willSplit, false);
    assert.equal(ig.partCount, 1);
  });

  it("11 IG accounts → partCount 3 for IG cells (matches MAX cap)", () => {
    const igIds = Array.from({ length: 11 }, (_, i) => `ig${i + 1}`);
    const preview = buildPagePreview({
      clientSlug: "x",
      clientName: "X",
      subtypes: ["page_engagement_ig"],
      retentions: [365],
      fbPageIds: [],
      fbSummaries: [],
      igAccountIds: igIds,
      igSummaries: [],
    });
    // ceil(11 / 5) === 3
    assert.equal(preview.cells[0]!.partCount, 3);
    assert.equal(preview.cells[0]!.willSplit, true);
    assert.equal(MAX_PAGE_ENGAGEMENT_SOURCES, 5);
  });
});

// ── 6. pagePreviewToInserts conversion ────────────────────────────────────────

describe("pagePreviewToInserts", () => {
  const baseOpts = {
    clientSlug: "innervisions",
    clientName: "Innervisions",
    subtypes: [
      "page_engagement_fb",
      "page_engagement_ig",
    ] as BulkPageSubtype[],
    retentions: [60, 180],
    fbPageIds: ["fb1", "fb2"],
    fbSummaries: [{ id: "fb1", name: "FB Page 1" }],
    igAccountIds: ["ig1"],
    igSummaries: [{ id: "ig1", name: "@iv", slug: "iv" }],
  };
  const insertOpts = {
    userId: "u1",
    clientId: "c1",
    metaAdAccountId: "act_999",
  };

  function build(): { preview: BulkPagePreview; opts: typeof baseOpts } {
    return { preview: buildPagePreview(baseOpts), opts: baseOpts };
  }

  it("produces one insert per cell", () => {
    const { preview, opts } = build();
    const inserts = pagePreviewToInserts(preview, opts, insertOpts);
    assert.equal(inserts.length, 4); // 2 subtypes × 2 retentions
  });

  it("FB cells get fbPageIds joined as sourceId", () => {
    const { preview, opts } = build();
    const inserts = pagePreviewToInserts(preview, opts, insertOpts);
    const fbCell = inserts.find((i) => i.audienceSubtype === "page_engagement_fb");
    assert.ok(fbCell);
    assert.equal(fbCell.sourceId, "fb1,fb2");
    const meta = fbCell.sourceMeta as { pageIds?: string[] };
    assert.deepEqual(meta.pageIds, ["fb1", "fb2"]);
  });

  it("IG cells get igAccountIds joined as sourceId", () => {
    const { preview, opts } = build();
    const inserts = pagePreviewToInserts(preview, opts, insertOpts);
    const igCell = inserts.find((i) => i.audienceSubtype === "page_engagement_ig");
    assert.ok(igCell);
    assert.equal(igCell.sourceId, "ig1");
    const meta = igCell.sourceMeta as {
      pageIds?: string[];
      pageName?: string;
      pageSlug?: string;
    };
    assert.deepEqual(meta.pageIds, ["ig1"]);
    assert.equal(meta.pageName, "@iv");
    assert.equal(meta.pageSlug, "iv");
  });

  it("propagates funnelStage from the cell (engagement 180 → top_of_funnel)", () => {
    const { preview, opts } = build();
    const inserts = pagePreviewToInserts(preview, opts, insertOpts);
    const top = inserts.find(
      (i) => i.retentionDays === 180 && i.audienceSubtype === "page_engagement_fb",
    );
    assert.ok(top);
    assert.equal(top.funnelStage, "top_of_funnel");
    const mid = inserts.find(
      (i) => i.retentionDays === 60 && i.audienceSubtype === "page_engagement_fb",
    );
    assert.ok(mid);
    assert.equal(mid.funnelStage, "mid_funnel");
  });

  it("eventId is null (matrix builder is client-wide)", () => {
    const { preview, opts } = build();
    const inserts = pagePreviewToInserts(preview, opts, insertOpts);
    for (const i of inserts) assert.equal(i.eventId, null);
  });

  it("metaAdAccountId / userId / clientId propagate from opts", () => {
    const { preview, opts } = build();
    const inserts = pagePreviewToInserts(preview, opts, insertOpts);
    for (const i of inserts) {
      assert.equal(i.userId, "u1");
      assert.equal(i.clientId, "c1");
      assert.equal(i.metaAdAccountId, "act_999");
    }
  });
});
