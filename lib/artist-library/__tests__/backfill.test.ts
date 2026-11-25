import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { adEvent, campaignEvents, planArtistAssets, summariseAds, type BackfillInputs } from "../backfill.ts";
import { codeInName, hasFullName, kindFromAd, matchAd, rankedStageOf } from "../match.ts";
import { buildArtistView } from "../view.ts";

const ENZO = { id: "lib-enzo", name: "Enzo Siragusa" };

describe("matching an ad to an artist (AL2)", () => {
  it("full name anywhere; one name word only on a show the artist is linked to", () => {
    const ad = (ad_name: string, campaign_name = "[NX26-X] SIGNUP") => ({ ad_name, adset_name: null, campaign_name });
    assert.equal(matchAd(ad("Enzo Siragusa - UGC 2"), ENZO.name, { linked: false, tagged: false }), "ad_name");
    assert.equal(matchAd(ad("Interest", "Enzo Siragusa Interest Targeting (RA)"), ENZO.name, { linked: false, tagged: false }), "ad_name");
    assert.equal(matchAd(ad("Lineup Push - Enzo"), ENZO.name, { linked: false, tagged: false }), null, "a first name alone, on someone else's show");
    assert.equal(matchAd(ad("Lineup Push - Enzo"), ENZO.name, { linked: true, tagged: false }), "event_artists");
    assert.equal(matchAd(ad("Lineup Push - Enzon"), ENZO.name, { linked: true, tagged: false }), null, "whole words only");
    assert.equal(matchAd(ad("Carousel 3"), ENZO.name, { linked: false, tagged: true }), "tag");
    assert.ok(hasFullName("ENZO SIRAGUSA_closing", "Enzo Siragusa"));
    assert.ok(hasFullName("Énzo Siragusa", "Enzo Siragusa"), "accents folded");
  });

  it("stages are the tree's (RC14); Unsorted isn't ranked", () => {
    assert.equal(rankedStageOf("[P26-BDAY] SIGNUP", null), "signup");
    assert.equal(rankedStageOf("[P26-BDAY] On Sale V2", null), "on_sale");
    assert.equal(rankedStageOf("Enzo Siragusa Engagers (Skiddle)", "OUTCOME_SALES"), "on_sale");
    assert.equal(rankedStageOf("Enzo Siragusa Engagers (Skiddle)", "OUTCOME_ENGAGEMENT"), null);
    assert.equal(rankedStageOf("[P26-BDAY] PRESALE", null), null);
    assert.equal(kindFromAd(null, "ENZO - TICKETING TIERS ARTWORK"), "static");
    assert.equal(kindFromAd("video", "Artwork"), "clip");
    assert.equal(codeInName("[NX26-ENZO] Retargeting"), "NX26-ENZO");
  });

  it("an event's own campaign list wins over the launch ledger", () => {
    const links = campaignEvents([{ id: "e-enzo", meta_campaign_id: "c1, c2" }, { id: "e-global", meta_campaign_id: "c3" }]);
    const context = { launchedAds: new Map([["ad1", { clientId: "c-electric", eventId: "e-global" }]]), launchedAdSets: new Map(), codedEvents: [] };
    const events = new Map([["e-enzo", { client_id: "c-electric" }], ["e-global", { client_id: "c-electric" }]]);
    const base = { meta_ad_id: "ad1", meta_adset_id: null, campaign_name: "Enzo Siragusa Engagers (Skiddle)", ad_account_id: null };
    assert.deepEqual(adEvent({ ...base, meta_campaign_id: "c2" }, context, links, events), { eventId: "e-enzo", clientId: "c-electric" });
    assert.deepEqual(adEvent({ ...base, meta_campaign_id: "zzz" }, context, links, events), { eventId: "e-global", clientId: "c-electric" });
  });
});

function inputs(): BackfillInputs {
  const day = (meta_ad_id: string, campaign_name: string, spend: number, registrations: number, purchases = 0, date = "2026-11-10") => ({
    id: `${meta_ad_id}-${date}`,
    meta_ad_id,
    meta_adset_id: `as-${meta_ad_id}`,
    meta_campaign_id: `cmp-${campaign_name}`,
    ad_name: null as string | null,
    adset_name: null,
    ad_account_id: null,
    campaign_name,
    campaign_objective: null,
    date,
    spend,
    registrations,
    purchases,
  });
  const days = [
    { ...day("ad-ugc", "[P26-BDAY] SIGNUP", 25.2, 12), ad_name: "Enzo Siragusa - UGC 2" },
    { ...day("ad-lineup", "[P26-BDAY] SIGNUP", 40, 20), ad_name: "Lineup Push - Enzo" },
    { ...day("ad-nx", "[NX26-ENZO] Retargeting", 26, 0, 1), ad_name: "Enzo Siragusa closing out NX" },
    { ...day("ad-other", "[P26-BDAY] SIGNUP", 30, 10), ad_name: "Luke Dean - UGC 1" },
    { ...day("ad-lab", "[P26-BDAY] SIGNUP", 21, 10), ad_name: "lab ad" },
    { ...day("ad-mixed", "[P26-BDAY] SIGNUP", 50, 40), ad_name: "lab mixed ad" },
    { ...day("ad-arch", "[OLD26] SIGNUP", 50, 40), ad_name: "Enzo Siragusa old" },
  ];
  return {
    artists: [ENZO, { id: "lib-luke", name: "Luke Dean" }],
    links: [{ event_id: "e-bday", artist_id: "lib-enzo" }],
    events: [
      { id: "e-bday", name: "Puzzle 4th Birthday", event_code: "P26-BDAY", client_id: "c-puzzle", event_date: "2026-12-27", venue_name: "Circuit & Engine Rooms", venue_city: "Southampton", announcement_at: "2026-10-01T17:00:00Z", presale_at: "2026-10-08T09:00:00Z", general_sale_at: "2026-10-10T09:00:00Z", status: "on_sale" },
      { id: "e-nx", name: "Enzo", event_code: "NX26-ENZO", client_id: "c-electric", event_date: "2026-10-31", venue_name: "NX Newcastle", venue_city: "Newcastle upon Tyne", announcement_at: null, presale_at: null, general_sale_at: null, status: "on_sale" },
      { id: "e-old", name: "Old", event_code: "OLD26", client_id: "c-old", event_date: "2026-12-30", venue_name: null, venue_city: null, announcement_at: null, presale_at: null, general_sale_at: null, status: "on_sale" },
    ],
    clients: [
      { id: "c-puzzle", name: "Puzzle", status: "active" },
      { id: "c-electric", name: "Electric Brixton", status: "active" },
      { id: "c-old", name: "Old Promoter", status: "archived" },
    ],
    labArtists: [{ id: "lab-enzo", client_id: "c-puzzle", artist_id: "lib-enzo" }, { id: "lab-dj", client_id: "c-puzzle", artist_id: "lib-luke" }],
    clips: [
      { id: "clip-raw", artist_id: "lab-enzo", owner: "artist", event_id: "e-bday", shown_on_event_id: null, creative_asset_id: "ca-raw", created_at: "2026-11-01T00:00:00Z", ig_posted_at: null },
      { id: "clip-crowd", artist_id: null, owner: "promoter", event_id: null, shown_on_event_id: "e-bday", creative_asset_id: "ca-crowd", created_at: "2026-11-01T00:00:00Z", ig_posted_at: null },
      { id: "clip-luke", artist_id: "lab-dj", owner: "artist", event_id: "e-bday", shown_on_event_id: null, creative_asset_id: null, created_at: "2026-11-01T00:00:00Z", ig_posted_at: null },
    ],
    clipFeatures: [{ clip_id: "clip-crowd", artist_id: "lab-enzo" }],
    creativeAssets: [{ id: "ca-raw", filename: "Enzo - Raw 1.mp4", drive_file_id: "drv-raw" }, { id: "ca-crowd", filename: "Puzzle crowd.mp4", drive_file_id: null }],
    renders: [
      { id: "r-art", clip_id: "clip-raw", caption_id: null, status: "done", drive_file_id: "drv-r-art", drive_file_name: "P26-BDAY_enzo-siragusa-1_artist1-signup_r1_9x16.mp4", created_at: "2026-11-05T00:00:00Z" },
      { id: "r-mixed", clip_id: "clip-crowd", caption_id: null, status: "done", drive_file_id: "drv-r-mixed", drive_file_name: "Montage - Enzo.mp4", created_at: "2026-11-05T00:00:00Z" },
      { id: "r-failed", clip_id: "clip-raw", caption_id: null, status: "failed", drive_file_id: null, drive_file_name: null, created_at: "2026-11-05T00:00:00Z" },
    ],
    captions: [],
    roundAds: [{ id: "ra1", render_id: "r-art", round_id: "round1" }, { id: "ra2", render_id: "r-mixed", round_id: "round1" }],
    rounds: [{ id: "round1", event_id: "e-bday" }],
    launches: [{ round_ad_id: "ra1", meta_ad_id: "ad-lab" }, { round_ad_id: "ra2", meta_ad_id: "ad-mixed" }],
    launchedAds: [],
    tags: [],
    ads: summariseAds(days),
    insights: days,
    context: {
      launchedAds: new Map(),
      launchedAdSets: new Map(),
      codedEvents: [
        { eventId: "e-bday", clientId: "c-puzzle", eventCode: "P26-BDAY", adAccountId: null },
        { eventId: "e-nx", clientId: "c-electric", eventCode: "NX26-ENZO", adAccountId: null },
        { eventId: "e-old", clientId: "c-old", eventCode: "OLD26", adAccountId: null },
      ],
    },
  };
}

describe("the backfill plan (AL2)", () => {
  const plan = planArtistAssets(inputs(), ENZO);
  const byKey = new Map(plan.rows.map((r) => [r.asset_key, r]));

  it("Lab clips by owner: the artist's own is shareable, a promoter clip featuring them is Puzzle's", () => {
    assert.equal(byKey.get("clip:clip-raw")!.shareable, true);
    assert.equal(byKey.get("clip:clip-raw")!.drive_file_id, "drv-raw");
    const crowd = byKey.get("clip:clip-crowd")!;
    assert.deepEqual([crowd.owner_kind, crowd.shareable, crowd.held_reason, crowd.source_client_id], ["promoter", false, "filmed", "c-puzzle"]);
    assert.ok(!byKey.has("clip:clip-luke"), "another artist's clip");
  });

  it("a render of a promoter clip isn't shareable; its ads take its rights", () => {
    assert.equal(byKey.get("render:r-art")!.shareable, true);
    const mixed = byKey.get("render:r-mixed")!;
    assert.deepEqual([mixed.owner_kind, mixed.shareable, mixed.held_reason], ["offpixel", false, "footage"]);
    assert.equal(byKey.get("ad:ad-mixed")!.shareable, false);
    assert.equal(byKey.get("ad:ad-lab")!.shareable, true);
    assert.equal(byKey.get("ad:ad-lab")!.lab_render_id, "r-art");
    assert.ok(!byKey.has("render:r-failed"));
  });

  it("ads: name and linked-show matches, client ads held, archived clients and other artists out", () => {
    assert.equal(byKey.get("ad:ad-ugc")!.matched_by, "ad_name");
    assert.equal(byKey.get("ad:ad-lineup")!.matched_by, "event_artists");
    assert.equal(byKey.get("ad:ad-nx")!.source_client_id, "c-electric");
    assert.equal(byKey.get("ad:ad-nx")!.shareable, false);
    assert.ok(!byKey.has("ad:ad-other"));
    assert.ok(!byKey.has("ad:ad-arch"));
    assert.equal(plan.skipped.archived, 1);
    for (const r of plan.rows) assert.ok(!(r.owner_kind === "promoter" && r.shareable), r.asset_key);
  });

  it("the view: spend on matched ads only, a render and its ad are one file", () => {
    const i = inputs();
    const view = buildArtistView({ assets: plan.rows, insights: i.insights, events: i.events, linkedEventIds: ["e-bday"], today: "2026-11-25" });
    const bday = view.shows.find((s) => s.code === "P26-BDAY")!;
    assert.equal(Math.round(bday.spend * 10) / 10, 25.2 + 40 + 21 + 50, "Luke's ad on the same show isn't counted");
    assert.deepEqual(view.counted, { shows: 2, clients: 2 });
    const art = view.groups.find((g) => g.key === "render:r-art")!;
    assert.equal(art.driveFileId, "drv-r-art");
    assert.equal(art.byStage.signup!.spend, 21);
  });
});
