import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseInterestSheet } from "../interest.ts";

describe("parseInterestSheet", () => {
  it("happy path — Audience column", () => {
    const rows = [
      ["Audience", "Cost", "Impressions"],
      ["Electronic Music", "£100", "10,000"],
      ["Streetwear", "£50", "5,000"],
    ];
    const out = parseInterestSheet(rows);
    assert.equal(out.length, 2);
    assert.equal(out[0].audience_label, "Electronic Music");
    assert.equal(out[0].cost, 100);
    assert.equal(out[0].vertical, "music_entertainment");
    assert.equal(out[1].audience_label, "Streetwear");
    assert.equal(out[1].vertical, "beauty_fashion");
  });

  it("accepts Interest column alias and skips total row", () => {
    const rows = [
      ["Interest", "Cost"],
      ["Total of 1 result", "£0"],
      ["Yoga", "<5"],
    ];
    const out = parseInterestSheet(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].audience_label, "Yoga");
  });

  // The Audience-Table pivot in TikTok Ads Manager (View Report →
  // Insights → Audience) ships bare "Clicks" / "CPC" / "CTR" / "25%" /
  // "50%" / "75%" / "100%" headers rather than the verbose form on the
  // campaign / ad sheets. Without the alias coverage the watch-depth
  // columns silently render as "—" in the cross-contextual interests
  // section.
  it("parses bare audience-table headers (clicks, cpc, ctr, 25/50/75/100%)", () => {
    const rows = [
      [
        "Audience",
        "Cost",
        "Impressions",
        "CPM",
        "Clicks",
        "CPC",
        "CTR",
        "2s views",
        "6s views",
        "25%",
        "50%",
        "75%",
        "100%",
        "Avg play time per user",
        "Avg play time per video view",
      ],
      [
        "Skin Care",
        "£113.30",
        "111,036",
        "£1.02",
        "84",
        "£1.35",
        "0.08%",
        "90,037",
        "50,492",
        "10,200",
        "5,100",
        "4,000",
        "3,554",
        "8.10",
        "6.77",
      ],
    ];
    const [row] = parseInterestSheet(rows);
    assert.equal(row.audience_label, "Skin Care");
    assert.equal(row.clicks_destination, 84);
    assert.equal(row.cpc_destination, 1.35);
    assert.equal(row.ctr_destination, 0.08);
    assert.equal(row.video_views_2s, 90037);
    assert.equal(row.video_views_6s, 50492);
    assert.equal(row.video_views_p25, 10200);
    assert.equal(row.video_views_p50, 5100);
    assert.equal(row.video_views_p75, 4000);
    assert.equal(row.video_views_p100, 3554);
    assert.equal(row.avg_play_time_per_user, 8.1);
    assert.equal(row.avg_play_time_per_video_view, 6.77);
  });
});
