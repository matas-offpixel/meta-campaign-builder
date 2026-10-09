import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import { EDITOR_COLUMNS, buildEditorCsv, buildEditorRows } from "../editor-export.ts";
import { addPlanLocation, editorLocation, editorLocationChoices, removePlanLocation } from "../locations.ts";
import { NO_LOCATIONS_MESSAGE } from "../../google-search/validation.ts";
import {
  pausedNoBudgetMessage,
  reviewGoogleVideoPlan,
  splitMoney,
  YOUTUBE_CHANNEL_MANUAL_STEP,
  YOUTUBE_VIDEO_MANUAL_STEP,
  type VideoTreeLike,
} from "../validation.ts";

const GOLDEN = new URL("./fixtures/synthetic.editor.csv", import.meta.url);
const TEMPLATE = new URL("./fixtures/editor-template-export.tsv", import.meta.url);

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
      business_name: "Example Venue",
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
        daily_budget: 4,
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
        extra_copy: { headline: ["Final release", "Doors 14:00"], call_to_action: ["Tickets"] },
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
        extra_copy: {},
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
        extra_copy: {},
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

  it("is deterministic", () => {
    assert.equal(buildEditorCsv(tree()), buildEditorCsv(tree()));
  });
});

/** Editor's own export of a campaign it accepted with 0 errors: UTF-16LE, tab-separated. */
function template(): { headers: string[]; rows: Record<string, string>[] } {
  const text = new TextDecoder("utf-16le").decode(readFileSync(TEMPLATE)).replace(/^\uFEFF/, "");
  const [head, ...lines] = text.split(/\r?\n/).filter((l) => l.length > 0);
  const cells = (line: string) => line.split("\t").map((v) => (/^".*"$/.test(v) ? v.slice(1, -1).replace(/""/g, '"') : v));
  const headers = cells(head);
  return {
    headers,
    rows: lines.map((l) => Object.fromEntries(cells(l).map((v, i) => [headers[i], v]))),
  };
}

describe("Editor template (editor-template-export.tsv)", () => {
  it("has 111 columns", () => {
    assert.equal(template().headers.length, 111);
  });

  it("every header we write is in the template, in the template's order", () => {
    const { headers } = template();
    const missing = EDITOR_COLUMNS.filter((c) => !headers.includes(c));
    assert.deepEqual(missing, []);
    const positions = EDITOR_COLUMNS.map((c) => headers.indexOf(c));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  });

  it("every fixed value we write is spelled as in the template", () => {
    const { rows } = template();
    const values = (column: string) => new Set(rows.map((r) => r[column]).filter(Boolean));
    const ours = buildEditorRows(tree());
    for (const column of ["Campaign Type", "Networks", "Budget type", "EU political ads", "Bid Strategy Type", "Ad Group Type", "Ad type", "Location type"]) {
      const theirs = values(column);
      for (const v of new Set(ours.map((r) => r[column]).filter(Boolean))) {
        if (column === "Networks" && v.includes("Video Partners")) continue;
        if (column === "Budget type" && v === "Daily") continue;
        assert.ok(theirs.has(v), `${column}: "${v}" is not in the template (${[...theirs].join(" | ")})`);
      }
    }
  });

  it("has Website and Video ID columns, and no YouTube video or channel placement column", () => {
    const { headers } = template();
    assert.ok(headers.includes("Website"));
    assert.ok(headers.includes("Video ID 1"));
    assert.equal(headers.includes("YouTube video"), false);
    assert.equal(headers.includes("YouTube channel"), false);
    assert.equal(
      headers.some((header) => /youtube (video|channel)/i.test(header)),
      false,
    );
  });

  it("does not write YouTube placements into Website, and Review says to add the video id by hand", () => {
    const rows = buildEditorRows(tree());
    assert.equal(rows.some((row) => row.Website), false);
    assert.equal(buildEditorCsv(tree()).includes("youtube.com"), false);
    assert.equal(rows.find((row) => row["Ad Name"] === "Lead")?.["Video ID 1"], "ozh-w-EBw58");
    const { editorOnly } = reviewGoogleVideoPlan(tree(), "2026-10-08");
    assert.ok(editorOnly.includes(YOUTUBE_VIDEO_MANUAL_STEP));
    assert.ok(editorOnly.includes(YOUTUBE_CHANNEL_MANUAL_STEP));
  });

  it("the template's location IDs match ours for the UK and London", () => {
    const { rows } = template();
    const byId = (id: string) => rows.find((r) => r.ID === id);
    assert.equal(byId("2826")?.Location, editorLocation("United Kingdom")?.location);
    assert.equal(byId("1006886")?.Location, editorLocation("London")?.location);
    assert.equal(byId("1006886")?.["Location type"], "City");
    assert.equal(byId("9049069")?.["Location type"], "Unknown");
    assert.equal(editorLocation("South East England"), null);
  });
});

describe("budget type", () => {
  const TODAY = "2026-10-08";
  const budgetRows = (t: VideoTreeLike) =>
    buildEditorRows(t)
      .filter((r) => r["Campaign Type"])
      .map((r) => [r.Campaign, r.Budget, r["Budget type"]]);

  it("with dates, a plan total is split across enabled campaigns; a paused campaign keeps its own daily × days", () => {
    assert.deepEqual(budgetRows(tree()), [
      ['[IRW9999] Video, "Quoted"', "100.00", "Campaign total"],
      ["[IRW9999] Reserve", "40.00", "Campaign total"],
    ]);
  });

  it("CamelPhat shape: two campaigns, one paused, neither with its own daily — the enabled campaign gets the whole total", () => {
    const t = tree();
    t.plan.total_budget = 150;
    t.campaigns[0].daily_budget = null;
    t.campaigns[1].daily_budget = null;
    assert.equal(t.campaigns[1].status, "paused");
    assert.deepEqual(budgetRows(t), [
      ['[IRW9999] Video, "Quoted"', "150.00", "Campaign total"],
    ]);
  });

  it("a paused campaign with no daily is left out of the file, and Review blocks, because the template has no blank campaign Budget", () => {
    const { rows } = template();
    const campaignRows = rows.filter((row) => row["Campaign Type"]);
    assert.ok(campaignRows.length > 0);
    assert.ok(campaignRows.every((row) => row.Budget.trim() !== ""));
    assert.equal(campaignRows[0].Budget, "150.00");

    const t = tree();
    t.campaigns[1].daily_budget = null;
    const review = reviewGoogleVideoPlan(t, TODAY);
    assert.deepEqual(
      review.blockers.map((b) => b.message),
      [pausedNoBudgetMessage("[IRW9999] Reserve")],
    );
    assert.equal(review.budgets.some((line) => line.startsWith("[IRW9999] Reserve")), false);
    const written = buildEditorRows(t);
    assert.equal(written.some((row) => row.Campaign === "[IRW9999] Reserve"), false);
    assert.equal(written.some((row) => row["Campaign Type"] && row.Budget === "0.00"), false);
    assert.equal(written.some((row) => row["Campaign Type"] && row.Budget === ""), false);
    assert.equal(written.find((row) => row["Campaign Type"])?.Budget, "100.00");
  });

  it("weights the split by each enabled campaign's daily budget, remainder on the largest, parts sum to the total", () => {
    const t = tree();
    t.plan.total_budget = 10;
    t.campaigns[0].daily_budget = 1;
    t.campaigns[1].status = "enabled";
    t.campaigns[1].daily_budget = 2;
    assert.deepEqual(budgetRows(t), [
      ['[IRW9999] Video, "Quoted"', "3.33", "Campaign total"],
      ["[IRW9999] Reserve", "6.67", "Campaign total"],
    ]);
    const pence = budgetRows(t).reduce((sum, row) => sum + Math.round(Number(row[1]) * 100), 0);
    assert.equal(pence, 1000);

    const equal = tree();
    equal.plan.total_budget = 10;
    equal.campaigns[0].daily_budget = null;
    equal.campaigns[1].status = "enabled";
    equal.campaigns[1].daily_budget = null;
    equal.campaigns.push({
      name: "Third",
      tier: null,
      status: "enabled",
      daily_budget: null,
      google_campaign_resource_name: null,
      sort_order: 2,
      ad_groups: [],
    });
    assert.deepEqual(
      budgetRows(equal).map((row) => row[1]),
      ["3.34", "3.33", "3.33"],
    );
    assert.deepEqual(splitMoney(10, [1, 1, 1]), [3.34, 3.33, 3.33]);
  });

  it("an enabled campaign without its own daily makes the split equal, not weighted", () => {
    const t = tree();
    t.plan.total_budget = 10;
    t.campaigns[0].daily_budget = 9;
    t.campaigns[1].status = "enabled";
    t.campaigns[1].daily_budget = null;
    assert.deepEqual(budgetRows(t), [
      ['[IRW9999] Video, "Quoted"', "5.00", "Campaign total"],
      ["[IRW9999] Reserve", "5.00", "Campaign total"],
    ]);
  });

  it("with dates and no total, the plan daily × inclusive days, to 2 dp", () => {
    const t = tree();
    t.plan.total_budget = null;
    t.plan.daily_budget = 3.33;
    t.plan.end_date = "2026-11-03";
    t.campaigns[0].daily_budget = null;
    t.campaigns[1].daily_budget = null;
    assert.deepEqual(budgetRows(t), [
      ['[IRW9999] Video, "Quoted"', "9.99", "Campaign total"],
      ["[IRW9999] Reserve", "9.99", "Campaign total"],
    ]);
  });

  it("Daily only without an end date", () => {
    const t = tree();
    t.plan.total_budget = null;
    t.plan.daily_budget = 8.8;
    t.plan.end_date = null;
    t.campaigns[0].daily_budget = null;
    t.campaigns[1].daily_budget = null;
    assert.deepEqual(budgetRows(t), [
      ['[IRW9999] Video, "Quoted"', "8.80", "Daily"],
      ["[IRW9999] Reserve", "8.80", "Daily"],
    ]);
    assert.deepEqual(reviewGoogleVideoPlan(t, TODAY).budgets[0], '[IRW9999] Video, "Quoted": £8.80 a day (no end date)');
  });

  it("a total wins over the plan daily budget, and the paused campaign does not receive it again", () => {
    const t = tree();
    t.plan.daily_budget = 8.8;
    assert.deepEqual(budgetRows(t), [
      ['[IRW9999] Video, "Quoted"', "100.00", "Campaign total"],
      ["[IRW9999] Reserve", "40.00", "Campaign total"],
    ]);
  });

  it("Review shows the campaign total with the daily rate and the days", () => {
    assert.deepEqual(reviewGoogleVideoPlan(tree(), TODAY).budgets, [
      '[IRW9999] Video, "Quoted": £100.00 campaign total (≈ £10.00/day over 10 days)',
      "[IRW9999] Reserve: £40.00 campaign total (≈ £4.00/day over 10 days)",
    ]);
  });

  it("a campaign total without an end date is a blocker", () => {
    const t = tree();
    t.plan.end_date = null;
    t.campaigns[1].daily_budget = null;
    assert.deepEqual(reviewGoogleVideoPlan(t, TODAY).blockers.map((b) => b.code), ["total_budget_no_end_date"]);
  });
});

describe("responsive video ad", () => {
  const leadRow = (t: VideoTreeLike) => buildEditorRows(t).find((r) => r["Ad Name"] === "Lead");

  it("sheet copy goes to slot 1, extra copy to slots 2..5, the plan CTA fills an empty slot 1", () => {
    const row = leadRow(tree());
    assert.ok(row);
    assert.equal(row["Ad type"], "Responsive video ad");
    assert.equal(row["Video ID 1"], "ozh-w-EBw58");
    assert.deepEqual(
      ["Headline 1", "Headline 2", "Headline 3", "Headline 4"].map((c) => row[c]),
      ["Sat 24 Oct", "Final release", "Doors 14:00", undefined],
    );
    assert.deepEqual([row["Call to action 1"], row["Call to action 2"]], ["Book now", "Tickets"]);
    assert.equal(row["Long headline 1"], 'Tickets from £44.50, "final release"');
    assert.equal(row["Description 1"], "Line one, line two");
    assert.equal(row["Business name"], "Example Venue");
  });

  it("blank slots close up, and no more than five are written", () => {
    const t = tree();
    t.ads[0].headline = null;
    t.ads[0].extra_copy = { headline: ["", "A", "B", "C", "D", "E"] };
    const row = leadRow(t);
    assert.deepEqual(
      ["Headline 1", "Headline 2", "Headline 3", "Headline 4", "Headline 5"].map((c) => row?.[c]),
      ["A", "B", "C", "D", "E"],
    );
  });

  it("a slot over its limit blocks, naming it", () => {
    const t = tree();
    t.ads[0].extra_copy = { headline: ["Far too long a headline"] };
    const [blocker] = reviewGoogleVideoPlan(t, "2026-10-08").blockers;
    assert.equal(blocker.message, 'Lead: Headline "Far too long a headline" is 23 characters (limit 15).');
  });

  it("no location is a blocker: an empty list, only exclusions, or only names without a Google ID", () => {
    const message = "No locations — this would run worldwide. Add at least one location.";
    const cases: VideoTreeLike["plan"]["geo_targets"][] = [
      [],
      [{ name: "Ireland", bid_modifier_pct: null, negative: true }],
      [{ name: "South East England", bid_modifier_pct: null, negative: false }],
    ];
    for (const geo of cases) {
      const t = tree();
      t.plan.geo_targets = geo;
      const blockers = reviewGoogleVideoPlan(t, "2026-10-08").blockers;
      assert.deepEqual(blockers.map((b) => b.code), ["no_locations"], JSON.stringify(geo));
      assert.equal(blockers[0].message, message);
    }
    assert.ok(!reviewGoogleVideoPlan(tree(), "2026-10-08").blockers.some((b) => b.code === "no_locations"));
  });

  it("no business name is a blocker", () => {
    const t = tree();
    t.plan.business_name = "  ";
    const review = reviewGoogleVideoPlan(t, "2026-10-08");
    assert.deepEqual(review.blockers.map((b) => b.code), ["no_business_name"]);
    assert.equal(review.blockers[0].message, "No business name. Every responsive video ad needs one; set it in Settings.");
  });

  it("writes no TV or location bid modifier; Review lists them by hand", () => {
    const t = tree();
    t.plan.device_exclusions = ["CONNECTED_TV"];
    const csv = buildEditorCsv(t);
    assert.ok(!csv.includes("Bid Modifier"));
    assert.ok(!csv.includes("-10%"));
    const { editorOnly } = reviewGoogleVideoPlan(t, "2026-10-08");
    assert.ok(editorOnly.includes("Include Google TV: Disabled (TV screens are excluded)"));
    assert.ok(editorOnly.includes("Location bid adjustment: Manchester -10%"));
    assert.ok(editorOnly.includes("Excluded location: Ireland"));
    assert.ok(editorOnly.includes("Logo: add it on each responsive video ad (an image asset)"));
  });

  it("drops content exclusions, and location, objective and subtype lines that contradict the plan", () => {
    const t = tree();
    t.plan.settings_rows = [
      { setting: "Content exclusions", value: "Exclude: embedded videos, live streaming videos" },
      { setting: "Objective", value: "Create a campaign without a goal's guidance" },
      { setting: "Campaign subtype", value: "Video views" },
      { setting: "Campaign type", value: "Video" },
      { setting: "Frequency cap", value: "2 per day" },
    ];
    t.plan.targeting_rows = [
      { type: "Location", setting: "United Kingdom (presence, not interest)", value: "Base" },
    ];
    const { editorOnly } = reviewGoogleVideoPlan(t, "2026-10-08");
    assert.equal(editorOnly.some((line) => /content exclusion/i.test(line)), false);
    assert.equal(editorOnly.some((line) => line.startsWith("Objective")), false);
    assert.equal(editorOnly.some((line) => line.startsWith("Campaign subtype")), false);
    assert.equal(editorOnly.some((line) => /United Kingdom/.test(line) && /Base/.test(line)), false);
    assert.ok(editorOnly.some((line) => line.startsWith("Frequency cap")));
    assert.ok(editorOnly.includes("Location bid adjustment: Manchester -10%"));
  });

  it("locations can be added and removed only from the checked list, and no location still blocks Review", () => {
    const added = addPlanLocation([], "Manchester");
    assert.ok(added);
    assert.equal(added[0]?.name, "Manchester");
    assert.equal(editorLocation(added[0]?.name ?? "")?.id, "1006912");
    assert.equal(addPlanLocation([], "South East England"), null);
    assert.equal(addPlanLocation([], "Estepona"), null);
    assert.equal(addPlanLocation(added, "greater london")?.[1]?.name, "London");
    assert.equal(addPlanLocation(added, "Manchester"), added);
    const cleared = removePlanLocation(
      [{ name: "United Kingdom", bid_modifier_pct: null, negative: false }],
      "United Kingdom",
    );
    assert.deepEqual(cleared, []);
    const t = tree();
    t.plan.geo_targets = cleared;
    const blockers = reviewGoogleVideoPlan(t, "2026-10-08").blockers;
    assert.deepEqual(blockers.map((b) => b.code), ["no_locations"]);
    assert.equal(blockers[0]?.message, NO_LOCATIONS_MESSAGE);
    const ids = new Set(editorLocationChoices().map((choice) => choice.id));
    assert.equal(ids.has("1006886"), true);
    assert.equal(ids.has("2826"), true);
    assert.equal(ids.has("9049069"), false);
  });

  it("locations go by checked ID; an excluded location is not written", () => {
    const locations = buildEditorRows(tree())
      .filter((r) => r.ID)
      .map((r) => [r.ID, r.Location, r["Location type"]]);
    assert.deepEqual(locations.slice(0, 2), [
      ["2826", "United Kingdom", "Country"],
      ["1006912", "Manchester, Manchester, England, United Kingdom", "City"],
    ]);
    assert.equal(locations.length, 4);
  });
});

describe("reviewGoogleVideoPlan blockers", () => {
  const TODAY = "2026-10-08";

  it("the synthetic plan has no blockers and warns about connected TV", () => {
    const review = reviewGoogleVideoPlan(tree(), TODAY);
    assert.deepEqual(review.blockers, []);
    assert.ok(review.warnings.some((w) => w.code === "connected_tv_included"));
  });

  it("no budget", () => {
    const t = tree();
    t.plan.total_budget = null;
    t.campaigns[0].daily_budget = null;
    t.campaigns[1].daily_budget = null;
    const codes = reviewGoogleVideoPlan(t, TODAY).blockers.map((b) => b.code);
    assert.deepEqual(codes, ["no_budget", "no_budget"]);
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

  it("a ';' in a copy field warns, naming the ad and field", async () => {
    const XLSX = await import("xlsx");
    const { parseGoogleVideoPlanXlsx } = await import("../xlsx-import.ts");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Campaign", "Placement", "URL / ID", "Status"],
        ["[IRW0004] CP | Video", "One", "https://youtu.be/Q-gTWjK62vw", "Enabled"],
      ]),
      "4 Placements",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Ad", "Field", "Text"],
        ["Ad A", "Description", "Sold out before; final release now"],
        ["Ad A", "Headline", "Sat 24 Oct"],
      ]),
      "5 Ad Copy & Creative",
    );
    const draft = parseGoogleVideoPlanXlsx(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));
    assert.deepEqual(
      draft.warnings.filter((w) => w.code === "ad_semicolon").map((w) => w.message),
      ['Ad A: Description "Sold out before; final release now" contains ";". Editor reads ";" as a separator between values in one cell; replace it.'],
    );
  });

  it("a second Headline row, or 'Headline 2', fills slot 2; a sixth value warns and is dropped", async () => {
    const XLSX = await import("xlsx");
    const { parseGoogleVideoPlanXlsx } = await import("../xlsx-import.ts");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Setting", "Value"],
        ["Business name", "Ironworks"],
      ]),
      "2 Campaign Settings",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Campaign", "Placement", "URL / ID", "Status"],
        ["[IRW0004] CP | Video", "One", "https://youtu.be/Q-gTWjK62vw", "Enabled"],
      ]),
      "4 Placements",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Ad", "Field", "Text"],
        ["Ad A", "Headline", "One"],
        ["Ad A", "Headline 2", "Two"],
        ["Ad A", "Headline", "Three"],
        ["Ad A", "Description", "Only"],
        ["Ad B", "CTA", "A"],
        ["Ad B", "CTA", "B"],
        ["Ad B", "CTA", "C"],
        ["Ad B", "CTA", "D"],
        ["Ad B", "CTA", "E"],
        ["Ad B", "CTA", "F"],
      ]),
      "5 Ad Copy & Creative",
    );
    const draft = parseGoogleVideoPlanXlsx(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));
    const [a, b] = draft.ads;
    assert.equal(draft.plan.business_name, "Ironworks");
    assert.equal(a.headline, "One");
    assert.deepEqual(a.extra_copy, { headline: ["Two", "Three"] });
    assert.equal(a.description, "Only");
    assert.equal(b.call_to_action, "A");
    assert.deepEqual(b.extra_copy, { call_to_action: ["B", "C", "D", "E"] });
    assert.deepEqual(
      draft.warnings.filter((w) => w.code === "ad_too_many_slots").map((w) => w.message),
      ["Ad B: 6 CTA values; a responsive video ad takes 5. The rest are dropped."],
    );
  });

  it("no placements → 'Parsed 0 placements' with the tabs found", async () => {
    const { describeEmptyGoogleVideoImport } = await import("../xlsx-import.ts");
    assert.equal(
      describeEmptyGoogleVideoImport(["2 Campaign Settings", "4 Placements"]),
      "Parsed 0 placements. Tabs found: 2 Campaign Settings, 4 Placements. A video plan needs a Placements tab with Campaign and Placement columns.",
    );
  });
});
