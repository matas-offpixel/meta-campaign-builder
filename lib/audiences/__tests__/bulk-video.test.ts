import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPrefixOptions,
  eventCodeMatchesPrefix,
} from "../event-code-prefix-scanner.ts";
import { campaignMatchesBracketedEventCode } from "../../insights/meta-event-code-match.ts";
import { mergeVideoSourcesDeduped } from "../merge-video-sources.ts";
import { buildAudienceName } from "../naming.ts";
import { previewRowsToInserts, BULK_FUNNEL_CONFIG, type BulkPreviewRow } from "../bulk-types.ts";

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
    funnelStages: ["top_of_funnel", "bottom_funnel"] as const,
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
    const inserts = previewRowsToInserts(rows, opts as typeof opts & { funnelStages: ("top_of_funnel" | "bottom_funnel")[] });
    assert.equal(inserts.length, 2); // 2 stages × 1 non-skipped event
  });

  it("sets correct eventId and audienceSubtype", () => {
    const inserts = previewRowsToInserts(rows, opts as typeof opts & { funnelStages: ("top_of_funnel" | "bottom_funnel")[] });
    assert.ok(inserts.every((i) => i.audienceSubtype === "video_views"));
    assert.ok(inserts.every((i) => i.eventId === "ev1"));
  });

  it("uses audience name from preview row directly", () => {
    const inserts = previewRowsToInserts(rows, opts as typeof opts & { funnelStages: ("top_of_funnel" | "bottom_funnel")[] });
    const top = inserts.find((i) => i.funnelStage === "top_of_funnel");
    assert.equal(top?.name, "[WC26-MANCHESTER] 50% video views 365d");
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
