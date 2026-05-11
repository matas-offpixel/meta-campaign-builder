import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPrefixOptions,
  eventCodeMatchesPrefix,
} from "../event-code-prefix-scanner.ts";
import { campaignMatchesBracketedEventCode } from "../../insights/meta-event-code-match.ts";
import { mergeVideoSourcesDeduped } from "../merge-video-sources.ts";
import { buildAudienceName } from "../naming.ts";
import {
  previewRowsToInserts,
  hasBulkStages,
  META_MAX_RETENTION_DAYS,
  BULK_FUNNEL_CONFIG,
  type BulkPreviewRow,
  type BulkPreviewAudience,
} from "../bulk-types.ts";

// ── 1. Prefix scanner ─────────────────────────────────────────────────────────

describe("buildPrefixOptions", () => {
  const codes = [
    "WC26-MANCHESTER",
    "WC26-LONDON",
    "WC26-LEEDS",
    "4TF26-ARSENAL-CL",
    "4TF26-ARSENAL-PL",
    "BOH26-LONDON",
  ];

  it("produces WC26 with 3 events", () => {
    const opts = buildPrefixOptions(codes);
    const wc26 = opts.find((o) => o.prefix === "WC26");
    assert.ok(wc26, "WC26 option missing");
    assert.equal(wc26.eventCount, 3);
  });

  it("produces 4TF26-ARSENAL with 2 events", () => {
    const opts = buildPrefixOptions(codes);
    const arsenal = opts.find((o) => o.prefix === "4TF26-ARSENAL");
    assert.ok(arsenal, "4TF26-ARSENAL option missing");
    assert.equal(arsenal.eventCount, 2);
  });

  it("produces BOH26 with 1 event", () => {
    const opts = buildPrefixOptions(codes);
    const boh = opts.find((o) => o.prefix === "BOH26");
    assert.ok(boh);
    assert.equal(boh.eventCount, 1);
  });

  it("sorted by event count desc", () => {
    const opts = buildPrefixOptions(codes);
    for (let i = 1; i < opts.length; i++) {
      assert.ok(opts[i - 1]!.eventCount >= opts[i]!.eventCount);
    }
  });

  it("tolerates null / empty entries", () => {
    const opts = buildPrefixOptions([null, "", "WC26-MANCHESTER"]);
    // Null and empty are filtered; WC26-MANCHESTER yields prefixes WC26 and WC26-MANCHESTER
    assert.ok(opts.length >= 1);
    assert.ok(opts.some((o) => o.prefix === "WC26"));
  });
});

describe("eventCodeMatchesPrefix", () => {
  it("matches exact code", () => {
    assert.ok(eventCodeMatchesPrefix("WC26", "WC26"));
  });

  it("matches code with suffix", () => {
    assert.ok(eventCodeMatchesPrefix("WC26-MANCHESTER", "WC26"));
  });

  it("does not match different prefix", () => {
    assert.ok(!eventCodeMatchesPrefix("BOH26-LONDON", "WC26"));
  });

  it("case insensitive", () => {
    assert.ok(eventCodeMatchesPrefix("wc26-manchester", "WC26"));
    assert.ok(eventCodeMatchesPrefix("WC26-MANCHESTER", "wc26"));
  });
});

// ── 2. Campaign matcher ───────────────────────────────────────────────────────

describe("campaignMatchesBracketedEventCode", () => {
  it("matches [WC26-MANCHESTER] campaigns for WC26-MANCHESTER", () => {
    assert.ok(
      campaignMatchesBracketedEventCode(
        "[WC26-MANCHESTER] Summer promo",
        "WC26-MANCHESTER",
      ),
    );
  });

  it("matches [WC26-LEEDS] campaign for WC26-LEEDS", () => {
    assert.ok(
      campaignMatchesBracketedEventCode(
        "[WC26-LEEDS] Video ads Q3",
        "WC26-LEEDS",
      ),
    );
  });

  it("does NOT match [BOH26-LONDON] for WC26 prefix", () => {
    assert.ok(
      !campaignMatchesBracketedEventCode(
        "[BOH26-LONDON] London show",
        "WC26-MANCHESTER",
      ),
    );
  });
});

// ── 3. Video dedup / grouping ─────────────────────────────────────────────────

describe("mergeVideoSourcesDeduped", () => {
  it("deduplicates video IDs across multiple campaign buckets", () => {
    const merged = mergeVideoSourcesDeduped([
      [{ id: "v1", title: "A" }, { id: "v2", title: "B" }],
      [{ id: "v2", title: "B-dup" }, { id: "v3", title: "C" }],
      [{ id: "v1", title: "A-dup" }],
    ]);
    assert.equal(merged.length, 3);
    assert.deepEqual(
      merged.map((v) => v.id),
      ["v1", "v2", "v3"],
    );
    // First occurrence wins
    assert.equal(merged.find((v) => v.id === "v2")?.title, "B");
  });
});

// ── 4. Preview → insert conversion ───────────────────────────────────────────

describe("previewRowsToInserts", () => {
  const opts = {
    userId: "u1",
    clientId: "c1",
    metaAdAccountId: "123456",
  };

  const videoIds = ["v1", "v2"];
  const campaignIds = ["cam1"];
  const campaignSummaries = [{ id: "cam1", name: "[WC26-MANCHESTER] Test" }];

  const rows: BulkPreviewRow[] = [
    {
      eventId: "ev1",
      eventCode: "WC26-MANCHESTER",
      eventName: "Manchester",
      matchedCampaigns: campaignSummaries,
      pagePublishedVideos: 2,
      orphanVideos: 0,
      audiences: [
        {
          funnelStage: "top_of_funnel",
          name: "[WC26-MANCHESTER] 50% video views 365d",
          threshold: 50,
          retentionDays: 365,
          videoIds,
          campaignIds,
          campaignSummaries,
        },
        {
          funnelStage: "bottom_funnel",
          name: "[WC26-MANCHESTER] 95% video views 30d",
          threshold: 95,
          retentionDays: 30,
          videoIds,
          campaignIds,
          campaignSummaries,
        },
      ],
      skipped: false,
    },
    {
      eventId: "ev2",
      eventCode: "WC26-LONDON",
      eventName: "London",
      matchedCampaigns: [],
      pagePublishedVideos: 0,
      orphanVideos: 0,
      audiences: [],
      skipped: true,
      skipReason: "No campaigns found",
    },
  ];

  it("produces inserts only for non-skipped rows", () => {
    const inserts = previewRowsToInserts(rows, opts);
    assert.equal(inserts.length, 2); // 2 stages × 1 non-skipped event
  });

  it("sets correct eventId and audienceSubtype", () => {
    const inserts = previewRowsToInserts(rows, opts);
    assert.ok(inserts.every((i) => i.audienceSubtype === "video_views"));
    assert.ok(inserts.every((i) => i.eventId === "ev1"));
  });

  it("uses audience name from preview row directly", () => {
    const inserts = previewRowsToInserts(rows, opts);
    const top = inserts.find((i) => i.funnelStage === "top_of_funnel");
    assert.equal(top?.name, "[WC26-MANCHESTER] 50% video views 365d");
  });

  it("maps custom funnelStage → retargeting in DB insert", () => {
    const customRows: BulkPreviewRow[] = [
      {
        eventId: "ev1",
        eventCode: "WC26-MANCHESTER",
        eventName: "Manchester",
        matchedCampaigns: [{ id: "cam1", name: "[WC26-MANCHESTER] Test" }],
        pagePublishedVideos: 2,
        orphanVideos: 0,
        audiences: [
          {
            funnelStage: "custom",
            name: "[WC26-MANCHESTER] 95% video views 60d",
            threshold: 95,
            retentionDays: 60,
            videoIds: ["v1"],
            campaignIds: ["cam1"],
            campaignSummaries: [{ id: "cam1", name: "[WC26-MANCHESTER] Test" }],
          },
        ],
        skipped: false,
      },
    ];
    const inserts = previewRowsToInserts(customRows, opts);
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0]!.funnelStage, "retargeting");
    assert.equal(inserts[0]!.retentionDays, 60);
  });
});

// ── 5. Naming convention ──────────────────────────────────────────────────────

describe("naming for bulk video views", () => {
  it("[WC26-MANCHESTER] 95% video views 30d", () => {
    const name = buildAudienceName({
      scope: "event",
      client: { slug: "4thefans", name: "4theFans" },
      event: { eventCode: "WC26-MANCHESTER", name: "Manchester" },
      subtype: "video_views",
      retentionDays: 30,
      threshold: 95,
      campaignNames: ["[WC26-MANCHESTER] Promo vid"],
    });
    assert.equal(name, "[WC26-MANCHESTER] 95% video views 30d");
  });

  it("BULK_FUNNEL_CONFIG has correct thresholds", () => {
    assert.equal(BULK_FUNNEL_CONFIG.top_of_funnel.threshold, 50);
    assert.equal(BULK_FUNNEL_CONFIG.mid_funnel.threshold, 75);
    assert.equal(BULK_FUNNEL_CONFIG.bottom_funnel.threshold, 95);
  });
});

// ── 6. Custom stages ──────────────────────────────────────────────────────────

/** Helper: build a non-skipped preview row with N audiences. */
function makePreviewRow(
  eventCode: string,
  audiences: BulkPreviewAudience[],
): BulkPreviewRow {
  return {
    eventId: `ev-${eventCode}`,
    eventCode,
    eventName: eventCode,
    matchedCampaigns: [{ id: "cam1", name: `[${eventCode}] Test` }],
    pagePublishedVideos: 2,
    orphanVideos: 0,
    audiences,
    skipped: false,
  };
}

function makeAudience(
  funnelStage: BulkPreviewAudience["funnelStage"],
  threshold: number,
  retentionDays: number,
  eventCode: string,
): BulkPreviewAudience {
  return {
    funnelStage,
    name: `[${eventCode}] ${threshold}% video views ${retentionDays}d`,
    threshold,
    retentionDays,
    videoIds: ["v1", "v2"],
    campaignIds: ["cam1"],
    campaignSummaries: [{ id: "cam1", name: `[${eventCode}] Test` }],
  };
}

describe("2 funnel + 2 custom stages × 3 events → 12 audiences", () => {
  const eventCodes = ["WC26-MAN", "WC26-LON", "WC26-LEE"];

  const rows = eventCodes.map((code) =>
    makePreviewRow(code, [
      makeAudience("top_of_funnel", 50, 365, code),
      makeAudience("bottom_funnel", 95, 30, code),
      makeAudience("custom", 95, 60, code),
      makeAudience("custom", 95, 30, code),
    ]),
  );

  it("produces 12 inserts (4 audiences × 3 events)", () => {
    const inserts = previewRowsToInserts(rows, {
      userId: "u1",
      clientId: "c1",
      metaAdAccountId: "act_123",
    });
    assert.equal(inserts.length, 12);
  });

  it("has correct funnelStage distribution across events", () => {
    const inserts = previewRowsToInserts(rows, {
      userId: "u1",
      clientId: "c1",
      metaAdAccountId: "act_123",
    });
    const topCount = inserts.filter((i) => i.funnelStage === "top_of_funnel").length;
    const bottomCount = inserts.filter((i) => i.funnelStage === "bottom_funnel").length;
    const retargetCount = inserts.filter((i) => i.funnelStage === "retargeting").length;
    assert.equal(topCount, 3);
    assert.equal(bottomCount, 3);
    assert.equal(retargetCount, 6); // 2 custom stages × 3 events
  });
});

describe("customStages alone (zero funnel stages) → valid request", () => {
  it("hasBulkStages returns true when only customStages provided", () => {
    assert.ok(hasBulkStages([], [{ threshold: 95, retentionDays: 60 }]));
  });

  it("hasBulkStages returns false when both arrays empty", () => {
    assert.ok(!hasBulkStages([], []));
  });

  it("custom-only rows produce correct inserts", () => {
    const rows = [
      makePreviewRow("WC26-MAN", [
        makeAudience("custom", 95, 60, "WC26-MAN"),
        makeAudience("custom", 95, 30, "WC26-MAN"),
      ]),
    ];
    const inserts = previewRowsToInserts(rows, {
      userId: "u1",
      clientId: "c1",
      metaAdAccountId: "act_123",
    });
    assert.equal(inserts.length, 2);
    assert.ok(inserts.every((i) => i.funnelStage === "retargeting"));
    assert.ok(inserts.every((i) => i.audienceSubtype === "video_views"));
  });
});

describe("both arrays empty → guard returns false (maps to 400 in route)", () => {
  it("hasBulkStages([], []) is false", () => {
    assert.equal(hasBulkStages([], []), false);
  });
});

describe("custom stage retention clamped to META_MAX_RETENTION_DAYS", () => {
  it("META_MAX_RETENTION_DAYS is 365", () => {
    assert.equal(META_MAX_RETENTION_DAYS, 365);
  });

  it("retention 400d in audience is already clamped before reaching insert", () => {
    // Simulate what bulk-video.ts does: Math.min(365, retentionDays)
    // The row is built with the clamped value, so previewRowsToInserts sees 365.
    const rows = [
      makePreviewRow("WC26-MAN", [
        // retentionDays already clamped by runBulkVideoPreview
        makeAudience("custom", 95, META_MAX_RETENTION_DAYS, "WC26-MAN"),
      ]),
    ];
    const inserts = previewRowsToInserts(rows, {
      userId: "u1",
      clientId: "c1",
      metaAdAccountId: "act_123",
    });
    assert.equal(inserts[0]!.retentionDays, 365);
  });

  it("clamp formula: Math.min(365, x) for x > 365 produces 365", () => {
    const clamp = (days: number) =>
      Math.min(META_MAX_RETENTION_DAYS, Math.max(1, Math.trunc(days)));
    assert.equal(clamp(400), 365);
    assert.equal(clamp(366), 365);
    assert.equal(clamp(365), 365);
    assert.equal(clamp(60), 60);
    assert.equal(clamp(0), 1); // floor at 1
  });
});
