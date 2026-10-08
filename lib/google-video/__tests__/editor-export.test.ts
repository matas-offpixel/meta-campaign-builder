import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import { EDITOR_COLUMNS, buildEditorCsv } from "../editor-export.ts";
import { reviewGoogleVideoPlan, type VideoTreeLike } from "../validation.ts";

const GOLDEN = new URL("./fixtures/synthetic.editor.csv", import.meta.url);

function tree(): VideoTreeLike {
  return {
    plan: {
      event_id: null,
      google_ads_account_id: null,
      name: "Synthetic",
      status: "draft",
      daily_budget: null,
      total_budget: 100,
      start_date: "2026-11-01",
      end_date: "2026-11-10",
      cpv_bid: 0.04,
      include_video_partners: true,
      device_exclusions: [],
      frequency_cap_per_day: null,
      frequency_cap_per_week: null,
      language_codes: ["en", "fr"],
      geo_targets: [
        { name: "United Kingdom", bid_modifier_pct: null, negative: false },
        { name: "Manchester", bid_modifier_pct: -10, negative: false },
        { name: "Ireland", bid_modifier_pct: null, negative: true },
      ],
      final_url: "https://example.com/event?utm_source=youtube",
      display_url: "example.com",
      call_to_action: "Book now",
      settings_rows: [],
      targeting_rows: [],
      source_filename: null,
    },
    campaigns: [
      {
        name: "[IRW9999] Video, \"Quoted\"",
        tier: "V1",
        status: "enabled",
        daily_budget: 12.5,
        google_campaign_resource_name: null,
        sort_order: 0,
        ad_groups: [
          {
            name: "V1 In-stream",
            status: "enabled",
            cpv_bid: 0.05,
            sort_order: 0,
            placements: [
              { label: "Channel", value: "https://www.youtube.com/channel/UCbDgBFAketcO26wz-pR6OKA", kind: "channel", resolved_id: "UCbDgBFAketcO26wz-pR6OKA", status: "enabled", note: null, sort_order: 0 },
              { label: "Paused video", value: "https://youtu.be/Q-gTWjK62vw?si=x", kind: "video", resolved_id: "Q-gTWjK62vw", status: "paused", note: null, sort_order: 1 },
            ],
          },
        ],
      },
      {
        name: "[IRW9999] Reserve",
        tier: "V2",
        status: "paused",
        daily_budget: null,
        google_campaign_resource_name: null,
        sort_order: 1,
        ad_groups: [
          {
            name: "V2 In-stream",
            status: "paused",
            cpv_bid: null,
            sort_order: 0,
            placements: [
              { label: "Handle", value: "https://www.youtube.com/@Mixmag", kind: "handle", resolved_id: "@Mixmag", status: "paused", note: null, sort_order: 0 },
              { label: "Instruction", value: "Add 5–10 uploads", kind: null, resolved_id: null, status: "paused", note: null, sort_order: 1 },
            ],
          },
        ],
      },
    ],
    ads: [
      {
        name: "Lead",
        status: "enabled",
        video_value: "ozh-w-EBw58",
        video_id: "ozh-w-EBw58",
        final_url: null,
        call_to_action: null,
        headline: "Sat 24 Oct",
        long_headline: "Tickets from £44.50, \"final release\"",
        description: "Line one, line two",
        note: null,
        sort_order: 0,
      },
      {
        name: "Held, complete",
        status: "paused",
        video_value: "https://www.youtube.com/watch?v=Q-gTWjK62vw",
        video_id: "Q-gTWjK62vw",
        final_url: "https://example.com/other",
        call_to_action: "Go",
        headline: null,
        long_headline: null,
        description: null,
        note: null,
        sort_order: 1,
      },
      {
        name: "Held, no video",
        status: "paused",
        video_value: "6s cut",
        video_id: null,
        final_url: null,
        call_to_action: null,
        headline: null,
        long_headline: null,
        description: null,
        note: null,
        sort_order: 2,
      },
    ],
  };
}

describe("buildEditorCsv", () => {
  it("matches the golden file", () => {
    const csv = buildEditorCsv(tree());
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, csv);
    assert.equal(csv, readFileSync(GOLDEN, "utf8"));
  });

  it("is UTF-8 with a BOM, CRLF lines, and one header row", () => {
    const csv = buildEditorCsv(tree());
    assert.ok(csv.startsWith(`\uFEFF${EDITOR_COLUMNS.join(",")}\r\n`));
    assert.ok(csv.endsWith("\r\n"));
    assert.ok(csv.includes("£44.50"));
  });

  it("derives a daily budget from total ÷ inclusive days when the plan has none", () => {
    const lines = buildEditorCsv(tree()).split("\r\n");
    const reserve = lines.find((l) => l.startsWith("[IRW9999] Reserve,Video,"));
    assert.ok(reserve?.includes(",10.00,"), reserve);
  });

  it("is deterministic", () => {
    assert.equal(buildEditorCsv(tree()), buildEditorCsv(tree()));
  });
});

describe("reviewGoogleVideoPlan blockers", () => {
  const TODAY = "2026-10-08";

  it("the synthetic plan has no blockers and warns about connected TV", () => {
    const review = reviewGoogleVideoPlan(tree(), TODAY);
    assert.deepEqual(review.blockers, []);
    assert.ok(review.warnings.some((w) => w.code === "connected_tv_included"));
  });

  it("no daily budget", () => {
    const t = tree();
    t.plan.total_budget = null;
    t.campaigns[0].daily_budget = null;
    const codes = reviewGoogleVideoPlan(t, TODAY).blockers.map((b) => b.code);
    assert.deepEqual(codes, ["no_daily_budget", "no_daily_budget"]);
  });

  it("an ad over a character limit, named", () => {
    const t = tree();
    t.ads[0].call_to_action = "Get Tickets";
    const [blocker] = reviewGoogleVideoPlan(t, TODAY).blockers;
    assert.equal(blocker.code, "ad_over_limit");
    assert.equal(blocker.message, 'Lead: CTA "Get Tickets" is 11 characters (limit 10).');
  });

  it("an unparseable enabled placement", () => {
    const t = tree();
    t.campaigns[0].ad_groups[0].placements[0].value = "Search for sets";
    assert.deepEqual(reviewGoogleVideoPlan(t, TODAY).blockers.map((b) => b.code), ["placement_unparseable"]);
  });

  it("no enabled placement", () => {
    const t = tree();
    t.campaigns[0].ad_groups[0].placements[0].status = "paused";
    assert.deepEqual(reviewGoogleVideoPlan(t, TODAY).blockers.map((b) => b.code), ["no_enabled_placement"]);
  });

  it("an enabled ad without a video or a final URL", () => {
    const t = tree();
    t.plan.final_url = null;
    t.ads[0].video_value = null;
    t.ads[0].video_id = null;
    assert.deepEqual(reviewGoogleVideoPlan(t, TODAY).blockers.map((b) => b.code), ["ad_missing_video", "ad_missing_final_url"]);
  });

  it("connected TV excluded → no TV warning", () => {
    const t = tree();
    t.plan.device_exclusions = ["CONNECTED_TV"];
    assert.ok(!reviewGoogleVideoPlan(t, TODAY).warnings.some((w) => w.code === "connected_tv_included"));
  });

  it("a past start date is a warning", () => {
    assert.ok(reviewGoogleVideoPlan(tree(), "2026-11-02").warnings.some((w) => w.code === "start_date_past"));
  });
});

describe("import char-limit warnings", () => {
  it("'Get Tickets' and 'Buy Tickets' (11) warn, naming the ad", async () => {
    const XLSX = await import("xlsx");
    const { parseGoogleVideoPlanXlsx } = await import("../xlsx-import.ts");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Tier", "Campaign", "Placement", "Type", "URL / ID", "Status"],
        ["V1", "[IRW0004] CP | Video", "One", "YouTube video", "https://youtu.be/Q-gTWjK62vw", "Enabled"],
      ]),
      "4 Placements",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Ad", "Field", "Text"],
        ["Ad A", "CTA", "Get Tickets"],
        ["Ad B", "CTA", "Buy Tickets"],
        ["Ad B", "Headline", "CamelPhat Sat 24 Oct"],
      ]),
      "5 Ad Copy & Creative",
    );
    const draft = parseGoogleVideoPlanXlsx(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));
    assert.deepEqual(
      draft.warnings.filter((w) => w.code === "ad_over_limit").map((w) => w.message),
      [
        'Ad A: CTA "Get Tickets" is 11 characters; the limit is 10.',
        'Ad B: CTA "Buy Tickets" is 11 characters; the limit is 10.',
        'Ad B: Headline "CamelPhat Sat 24 Oct" is 20 characters; the limit is 15.',
      ],
    );
    assert.equal(draft.campaigns[0].name, "[IRW0004] CP | Video");
  });

  it("no placements → 'Parsed 0 placements' with the tabs found", async () => {
    const { describeEmptyGoogleVideoImport } = await import("../xlsx-import.ts");
    assert.equal(
      describeEmptyGoogleVideoImport(["2 Campaign Settings", "4 Placements"]),
      "Parsed 0 placements. Tabs found: 2 Campaign Settings, 4 Placements. A video plan needs a Placements tab with Campaign and Placement columns.",
    );
  });
});
