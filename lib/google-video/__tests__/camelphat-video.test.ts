import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildEditorCsv, buildEditorRows } from "../editor-export.ts";
import { reviewGoogleVideoPlan, YOUTUBE_CHANNEL_MANUAL_STEP, YOUTUBE_VIDEO_MANUAL_STEP } from "../validation.ts";
import { countDraftPlacements, parseGoogleVideoPlanXlsx } from "../xlsx-import.ts";

const SHEET = new URL("./fixtures/IRW0004_CamelPhat_YouTubeVideo_BuildSheet.xlsx", import.meta.url);
const GOLDEN = new URL("./fixtures/IRW0004_CamelPhat_YouTubeVideo.editor.csv", import.meta.url);

function parse() {
  return parseGoogleVideoPlanXlsx(new Uint8Array(readFileSync(SHEET)), {
    fallbackPlanName: "IRW0004_CamelPhat_YouTubeVideo_BuildSheet",
  });
}

/** The sheet's Summary tab names the full recap as youtube.com/watch?v=ozh-w-EBw58. The 15s cut is not uploaded yet. */
function withFullRecapLinked() {
  const draft = parse();
  const recap = draft.ads.find((a) => a.name.startsWith("Ad 2"));
  assert.ok(recap);
  recap.video_value = "https://www.youtube.com/watch?v=ozh-w-EBw58";
  draft.plan.business_name = "Ironworks";
  return draft;
}

describe("CamelPhat YouTube build sheet — import", () => {
  const draft = parse();

  it("V1 is one enabled campaign with the one Mixmag video placement", () => {
    const v1 = draft.campaigns[0];
    assert.equal(v1.name, "[IRW0004] CP | Video | V1 Placement-CamelPhat-Mixmag");
    assert.equal(v1.status, "enabled");
    assert.equal(v1.ad_groups.length, 1);
    assert.equal(v1.ad_groups[0].status, "enabled");
    const [placement] = v1.ad_groups[0].placements;
    assert.equal(v1.ad_groups[0].placements.length, 1);
    assert.equal(placement.value, "https://youtu.be/Q-gTWjK62vw");
    assert.equal(placement.kind, "video");
    assert.equal(placement.resolved_id, "Q-gTWjK62vw");
    assert.equal(placement.status, "enabled");
  });

  it("V2 is one paused campaign with the 10 tier-2 placements, all paused", () => {
    const v2 = draft.campaigns[1];
    assert.equal(draft.campaigns.length, 2);
    assert.equal(v2.name, "[IRW0004] CP | Video | V2 Placement-Tier2-Reserve (PAUSED)");
    assert.equal(v2.status, "paused");
    assert.equal(v2.ad_groups[0].status, "paused");
    assert.equal(v2.ad_groups[0].placements.length, 10);
    assert.ok(v2.ad_groups[0].placements.every((p) => p.status === "paused"));
    assert.deepEqual(
      v2.ad_groups[0].placements.filter((p) => p.resolved_id == null).map((p) => p.label),
      ["CamelPhat — other set and mix uploads", "Solomun / Adriatique / Innellea set videos"],
    );
    assert.equal(countDraftPlacements(draft), 11);
  });

  it("keeps [IRW0004] exactly as written", () => {
    assert.ok(draft.campaigns.every((c) => c.name.startsWith("[IRW0004] ")));
  });

  it("2 ads run, with copy inside the limits; the 6s bumper is held paused", () => {
    const enabled = draft.ads.filter((a) => a.status === "enabled");
    assert.deepEqual(
      enabled.map((a) => a.name),
      ["Ad 1 — 15s cut (lead)", "Ad 2 — full recap"],
    );
    assert.deepEqual(
      enabled.map((a) => [a.call_to_action, a.headline]),
      [
        ["Buy Now", "CamelPhat 24/10"],
        ["Buy Now", "See It Yourself"],
      ],
    );
    assert.equal(draft.ads.find((a) => a.name.startsWith("Ad 3"))?.status, "paused");
    assert.equal(draft.warnings.filter((w) => w.code === "ad_over_limit").length, 0);
  });

  it("excludes connected TV, targets the UK in English, and reads £8.80/day at £0.03 CPV", () => {
    assert.deepEqual(draft.plan.device_exclusions, ["CONNECTED_TV"]);
    assert.equal(draft.plan.daily_budget, 8.8);
    assert.equal(draft.plan.cpv_bid, 0.03);
    assert.equal(draft.plan.start_date, "2026-10-09");
    assert.equal(draft.plan.end_date, "2026-10-24");
    assert.equal(draft.plan.include_video_partners, false);
    assert.deepEqual(draft.plan.language_codes, ["en"]);
    assert.deepEqual(draft.plan.geo_targets, [
      { name: "United Kingdom", bid_modifier_pct: null, negative: false },
      { name: "London", bid_modifier_pct: 25, negative: false },
      { name: "South East England", bid_modifier_pct: 15, negative: false },
    ]);
    assert.equal(draft.plan.frequency_cap_per_day, 2);
    assert.equal(draft.plan.frequency_cap_per_week, 8);
  });

  it("warns, naming each ad, that the Video cells are titles rather than links", () => {
    const messages = draft.warnings.filter((w) => w.code === "ad_video_not_a_link").map((w) => w.message);
    assert.equal(messages.length, 3);
    assert.match(messages[0], /^Ad 1 — 15s cut \(lead\): .*The note mentions https:\/\/www\.youtube\.com\/watch\?v=ozh-w-EBw58; it was not used\.$/);
    assert.match(messages[1], /^Ad 2 — full recap: /);
    assert.match(messages[2], /^Ad 3 — 6s bumper \(hold\): /);
  });

  it("warns on the two tier-2 rows that are instructions, not links", () => {
    assert.equal(draft.warnings.filter((w) => w.code === "placement_unparseable").length, 2);
  });
});

describe("CamelPhat YouTube build sheet — review", () => {
  it("as imported (no event, so no business name), the download is blocked until the videos are linked and a name is set", () => {
    const review = reviewGoogleVideoPlan(parse(), "2026-10-08");
    assert.deepEqual(
      review.blockers.map((b) => b.code),
      ["no_business_name", "ad_video_unparseable", "ad_video_unparseable"],
    );
    assert.match(review.blockers[1].message, /^Ad 1 — 15s cut \(lead\): /);
    assert.match(review.blockers[2].message, /^Ad 2 — full recap: /);
  });

  it("with both videos linked there are no blockers; South East England and the paused leftovers are warnings", () => {
    const draft = withFullRecapLinked();
    draft.ads[0].video_value = "https://youtu.be/AAAAAAAAAAA";
    const review = reviewGoogleVideoPlan(draft, "2026-10-08");
    assert.deepEqual(review.blockers, []);
    assert.deepEqual(
      review.warnings.map((w) => w.code),
      ["location_not_in_file", "left_out", "left_out", "left_out"],
    );
    assert.match(review.warnings[0].message, /^Location "South East England" has no checked Google location ID/);
    assert.deepEqual(review.budgets, [
      "[IRW0004] CP | Video | V1 Placement-CamelPhat-Mixmag: £140.80 campaign total (≈ £8.80/day over 16 days)",
      "[IRW0004] CP | Video | V2 Placement-Tier2-Reserve (PAUSED): £140.80 campaign total (≈ £8.80/day over 16 days)",
    ]);
    for (const line of [
      "Include Google TV: Disabled (TV screens are excluded)",
      "Location bid adjustment: London +25%",
      "Location bid adjustment: South East England +15%",
      "Logo: add it on each responsive video ad (an image asset)",
    ]) {
      assert.ok(review.editorOnly.includes(line), line);
    }
    assert.ok(review.editorOnly.some((l) => l.startsWith("Frequency cap: 2 per user per day")));
    assert.ok(review.editorOnly.some((l) => l.includes("end 18:00")));
    assert.ok(review.editorOnly.includes(YOUTUBE_VIDEO_MANUAL_STEP));
    assert.ok(review.editorOnly.includes(YOUTUBE_CHANNEL_MANUAL_STEP));
    assert.equal(review.editorOnly.some((l) => /content exclusion/i.test(l)), false);
    assert.equal(review.editorOnly.some((l) => l.startsWith("Objective")), false);
    assert.equal(review.editorOnly.some((l) => l.startsWith("Campaign subtype")), false);
    assert.equal(review.editorOnly.some((l) => /United Kingdom/.test(l) && /\(Base\)/.test(l)), false);
  });
});

describe("CamelPhat YouTube build sheet — Editor CSV", () => {
  it("matches the golden file", () => {
    const csv = buildEditorCsv(withFullRecapLinked());
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, csv);
    assert.equal(csv, readFileSync(GOLDEN, "utf8"));
  });

  it("9–24 Oct is 16 days × £8.80 = £140.80 campaign total on both campaigns, Target CPV £0.03, V2 paused", () => {
    const rows = buildEditorRows(withFullRecapLinked());
    const campaigns = rows.filter((r) => r["Campaign Type"]);
    assert.deepEqual(
      campaigns.map((r) => [r["Campaign Status"], r.Budget, r["Budget type"], r["Bid Strategy Type"], r["EU political ads"]]),
      [
        ["Enabled", "140.80", "Campaign total", "Target CPV", "Doesn't have EU political ads"],
        ["Paused", "140.80", "Campaign total", "Target CPV", "Doesn't have EU political ads"],
      ],
    );
    const adGroups = rows.filter((r) => r["Ad Group Type"]);
    assert.deepEqual(
      adGroups.map((r) => [r["Ad Group"], r["Ad Group Type"], r["Target CPV"], r["Ad Group Status"]]),
      [
        ["V1 In-stream", "Responsive video", "0.03", "Enabled"],
        ["V2 In-stream", "Responsive video", "0.03", "Paused"],
      ],
    );
  });

  it("V1 matches the rows of the template Editor accepted, without YouTube URLs in Website", () => {
    const rows = buildEditorRows(withFullRecapLinked());
    const v1 = "[IRW0004] CP | Video | V1 Placement-CamelPhat-Mixmag";
    assert.equal(rows.some((r) => r.Website), false);
    assert.equal(buildEditorCsv(withFullRecapLinked()).includes("youtube.com"), false);
    const ad = rows.find((r) => r["Ad Name"] && r.Campaign === v1);
    assert.deepEqual(
      ad && [ad["Ad type"], ad["Video ID 1"], ad["Call to action 1"], ad["Headline 1"], ad["Business name"], ad.Status],
      ["Responsive video ad", "ozh-w-EBw58", "Buy Now", "See It Yourself", "Ironworks", "Enabled"],
    );
    assert.deepEqual(
      rows.filter((r) => r.ID && r.Campaign === v1).map((r) => [r.ID, r.Location, r["Location type"]]),
      [
        ["2826", "United Kingdom", "Country"],
        ["1006886", "London, England, United Kingdom", "City"],
      ],
    );
  });
});
