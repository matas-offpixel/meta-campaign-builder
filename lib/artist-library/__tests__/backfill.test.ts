import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ALIASES, type AliasEntry } from "../aliases.ts";
import { adEvent, campaignEvents, planArtistAssets, planGeneral, planRemovals, summariseAds, type BackfillInputs, type StoredAsset } from "../backfill.ts";
import { artistsNamedIn, artistsOfAd, buildRoster, codeInName, hasFullName, isClipIdentity, kindFromAd, rankedStageOf } from "../match.ts";
import { SOURCE_MAP, type SourceEntry } from "../source-map.ts";
import { creativeName, heldNoSourceFiles, suggestOwner } from "../suggest.ts";
import { buildArtistView, forEvent } from "../view.ts";

const ENZO = { id: "lib-enzo", name: "Enzo Siragusa" };
const ENZO_ALIAS: AliasEntry = { artistId: ENZO.id, alias: "Enzo", confirmedBy: "Matas", confirmedOn: "2026-11-25", note: "test" };

describe("matching an ad to an artist (AL2)", () => {
  const roster = buildRoster([
    { id: "enzo", names: ["Enzo Siragusa"] },
    { id: "luke", names: ["Luke Dean"] },
    { id: "banana", names: ["Dr Banana"] },
  ]);
  const withAlias = buildRoster([
    { id: "enzo", names: ["Enzo Siragusa", "Enzo"] },
    { id: "luke", names: ["Luke Dean"] },
    { id: "lukeAlias", names: ["Luke"] },
  ]);
  const ad = (ad_name: string | null, adset_name: string | null = null, campaign_name = "[P26-BDAY] SIGNUP") => ({ ad_name, adset_name, campaign_name });

  it("exact names only, folded for case, accents and punctuation; never a prefix or a first name", () => {
    assert.deepEqual(artistsNamedIn("ENZO SIRAGUSA_closing", roster), ["enzo"]);
    assert.deepEqual(artistsNamedIn("Énzo Siragusa", roster), ["enzo"], "accents folded");
    assert.deepEqual(artistsNamedIn("Dr. Banana!", roster), ["banana"], "punctuation folded");
    assert.deepEqual(artistsNamedIn("Lineup Push - Enzo", roster), [], "a first name isn't a name unless it's a recorded alias");
    assert.deepEqual(artistsNamedIn("Lineup Push - Enzo", withAlias), ["enzo"], "a recorded alias is");
    assert.deepEqual(artistsNamedIn("Lineup Push - Enzon", withAlias), [], "whole words only");
    assert.deepEqual(artistsNamedIn("Enzo Siragus", roster), [], "no fuzzy match");
    assert.deepEqual(artistsNamedIn("Luke Dean b2b Enzo Siragusa", roster), ["enzo", "luke"], "both acts named, both get it");
    assert.deepEqual(artistsNamedIn("Luke Dean Vid 4", withAlias), ["luke"], "an alias inside a longer name of another artist gives way");
    assert.ok(hasFullName("ENZO SIRAGUSA_closing", "Enzo Siragusa"));
  });

  it("the ad name decides; the ad set name only when the ad name names no one and it isn't the campaign's own name", () => {
    assert.deepEqual(artistsOfAd(ad("Dr Banana", "Enzo Siragusa Interest Targeting (RA)", "Enzo Siragusa Interest Targeting (RA)"), roster), { artistIds: ["banana"], field: "ad" });
    assert.deepEqual(artistsOfAd(ad("LILI", "Enzo Siragusa Interest Targeting (RA)", "Enzo Siragusa Interest Targeting (RA)"), roster), { artistIds: [], field: null }, "an ad set that is only the campaign's name");
    assert.deepEqual(artistsOfAd(ad("Carousel 3", "Lineup Push - Enzo Siragusa"), roster), { artistIds: ["enzo"], field: "adset" });
    assert.deepEqual(artistsOfAd(ad("Interest", null, "Enzo Siragusa Interest Targeting (RA)"), roster), { artistIds: [], field: null }, "the campaign name never counts");
  });

  it("a source file's clip identity: '{Client} - {Artist} UGC n' and copies fold in, other numbers don't", () => {
    const names = ["Enzo Siragusa", "Enzo"];
    assert.ok(isClipIdentity("Enzo - UGC 1", "UGC 1", names, "Puzzle"));
    assert.ok(isClipIdentity("Puzzle - Enzo UGC 1", "UGC 1", names, "Puzzle"));
    assert.ok(isClipIdentity("Enzo - UGC 1 – Copy", "UGC 1", names, "Puzzle"));
    assert.ok(isClipIdentity("Enzo - UGC 1 – Copy 2", "UGC 1", names, "Puzzle"));
    assert.ok(isClipIdentity("Enzo Siragusa - UGC 1", "UGC 1", names, "Puzzle"));
    assert.ok(!isClipIdentity("Enzo - UGC 12", "UGC 1", names, "Puzzle"));
    assert.ok(!isClipIdentity("Puzzle - Enzo UGC 1", "UGC 1", ["Enzo Siragusa"], "Puzzle"), "no alias recorded, no match");
    assert.ok(!isClipIdentity("Electric - Enzo UGC 1", "UGC 1", names, "Puzzle"), "only the ad's own client's name is folded off");
    assert.ok(!isClipIdentity("Enzo - UGC 1 recut", "UGC 1", names, "Puzzle"));
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

const MAPPED: SourceEntry = {
  artistId: ENZO.id,
  driveFileId: "drv-ugc2",
  name: "Enzo Siragusa - UGC 2.mp4",
  kind: "clip",
  folderId: "folder",
  ownerKind: "artist",
  source: "Enzo's Instagram",
  confirmedBy: "Matas",
  confirmedOn: "2026-11-25",
  ranAs: { eventCode: "P26-BDAY", clip: "UGC 2" },
};

function inputs(sources: readonly SourceEntry[] = [], aliases: readonly AliasEntry[] = [ENZO_ALIAS]): BackfillInputs {
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
    { ...day("ad-map", "[P26-BDAY] SIGNUP", 30, 15), ad_name: "Enzo - UGC 2" },
    { ...day("ad-puz", "[P26-BDAY] SIGNUP", 30, 15), ad_name: "Puzzle - Enzo UGC 1" },
    { ...day("ad-general", "[P26-BDAY] SIGNUP", 30, 15), ad_name: "Puzzle - Lineup Video" },
    { ...day("ad-luke-set", "[P26-BDAY] SIGNUP", 30, 15), ad_name: "Carousel 3", adset_name: "Lineup Push - Luke Dean" },
    { ...day("ad-banana", "Enzo Siragusa Interest Targeting (RA)", 10, 0), ad_name: "Dr Banana", adset_name: "Enzo Siragusa Interest Targeting (RA)" },
    { ...day("ad-lili", "Enzo Siragusa Interest Targeting (RA)", 10, 0), ad_name: "LILI", adset_name: "Enzo Siragusa Interest Targeting (RA)" },
  ];
  return {
    artists: [ENZO, { id: "lib-luke", name: "Luke Dean" }, { id: "lib-banana", name: "Dr Banana" }],
    links: [{ event_id: "e-bday", artist_id: "lib-enzo" }, { event_id: "e-bday", artist_id: "lib-luke" }, { event_id: "e-nx", artist_id: "lib-enzo" }],
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
    aliases,
    ads: summariseAds(days),
    insights: days,
    sources,
    context: {
      launchedAds: new Map([["ad-banana", { clientId: "c-electric", eventId: "e-nx" }], ["ad-lili", { clientId: "c-electric", eventId: "e-nx" }]]),
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

  it("ads: named ads held with their client, archived clients and other artists out", () => {
    assert.equal(byKey.get("ad:ad-ugc")!.matched_by, "ad_name");
    assert.equal(byKey.get("ad:ad-lineup")!.matched_by, "ad_name", "through the recorded alias 'Enzo'");
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
    assert.equal(Math.round(bday.spend * 10) / 10, 25.2 + 40 + 21 + 50 + 30 + 30, "Luke's ads and the show's own ads on the same show aren't counted");
    assert.deepEqual(view.counted, { shows: 2, clients: 2 });
    const art = view.groups.find((g) => g.key === "render:r-art")!;
    assert.equal(art.driveFileId, "drv-r-art");
    assert.equal(art.byStage.signup!.spend, 21);
  });
});

describe("shared shows (Matas, 25 Nov)", () => {
  it("an ad naming no artist goes to the show's general bucket, not to every artist on the bill", () => {
    const i = inputs();
    const enzo = new Set(planArtistAssets(i, ENZO).rows.map((r) => r.asset_key));
    const luke = new Set(planArtistAssets(i, { id: "lib-luke", name: "Luke Dean" }).rows.map((r) => r.asset_key));
    assert.ok(!enzo.has("ad:ad-general") && !luke.has("ad:ad-general"));
    const bday = planGeneral(i).find((g) => g.code === "P26-BDAY")!;
    assert.equal(bday.bill, 2);
    assert.equal(bday.files.get("Puzzle - Lineup Video"), 1);
    assert.ok(!bday.files.has("lab ad") && !bday.files.has("Enzo - UGC 2"), "Lab ads and named ads aren't general");
  });

  it("one artist's ads never cross to another on the same bill", () => {
    const i = inputs();
    const enzo = new Set(planArtistAssets(i, ENZO).rows.map((r) => r.asset_key));
    const luke = new Set(planArtistAssets(i, { id: "lib-luke", name: "Luke Dean" }).rows.map((r) => r.asset_key));
    assert.ok(luke.has("ad:ad-other") && !enzo.has("ad:ad-other"));
    assert.ok(luke.has("ad:ad-luke-set") && !enzo.has("ad:ad-luke-set"), "named in its ad set");
    for (const key of luke) if (key.startsWith("ad:")) assert.ok(!enzo.has(key), key);
  });

  it("an ad naming another act in an ad set named for the headliner is the act's", () => {
    const i = inputs();
    const enzo = new Set(planArtistAssets(i, ENZO).rows.map((r) => r.asset_key));
    assert.ok(!enzo.has("ad:ad-banana") && !enzo.has("ad:ad-lili"));
    assert.ok(planArtistAssets(i, { id: "lib-banana", name: "Dr Banana" }).rows.some((r) => r.asset_key === "ad:ad-banana"));
    assert.equal(planGeneral(i).find((g) => g.code === "NX26-ENZO")!.files.get("LILI"), 1, "LILI names no one on the roster");
  });

  it("without the recorded alias, 'Enzo - …' ads are the show's own", () => {
    const keys = new Set(planArtistAssets(inputs([], []), ENZO).rows.map((r) => r.asset_key));
    assert.ok(!keys.has("ad:ad-lineup") && !keys.has("ad:ad-map"));
    assert.ok(keys.has("ad:ad-ugc"), "the full name still matches");
  });
});

describe("re-applying for an artist (planRemovals)", () => {
  const stored = (asset_key: string, extra: Partial<StoredAsset> = {}): StoredAsset => ({ id: `id-${asset_key}`, artist_id: ENZO.id, asset_key, name: asset_key, kind: "clip", shareable: false, drive_file_id: null, ...extra });

  it("removes the rows the new plan no longer gives the artist, and only those", () => {
    const plan = planArtistAssets(inputs([MAPPED]), ENZO);
    const rows = [stored("ad:ad-ugc"), stored("ad:ad-banana"), stored("ad:ad-lili"), stored("ad:ad-other"), stored("clip:clip-gone"), stored("render:r-gone")];
    assert.deepEqual(planRemovals(rows, plan, [MAPPED]).map((r) => r.asset_key).sort(), ["ad:ad-banana", "ad:ad-lili", "ad:ad-other", "clip:clip-gone", "render:r-gone"]);
  });

  it("never removes a row of a file the source map makes shareable, a Drive drop, or another artist's row", () => {
    const plan = { artist: ENZO, rows: [] };
    const rows = [
      stored("ad:ad-gone-mapped", { shareable: true, drive_file_id: "drv-ugc2" }),
      stored("drive:drv-ugc2", { shareable: true, drive_file_id: "drv-ugc2" }),
      stored("drive:drv-library-drop", { shareable: true, drive_file_id: "drv-library-drop" }),
      stored("ad:ad-luke", { artist_id: "lib-luke" }),
      stored("ad:ad-stale"),
    ];
    assert.deepEqual(planRemovals(rows, plan, [MAPPED]).map((r) => r.asset_key), ["ad:ad-stale"]);
    for (const e of SOURCE_MAP) {
      const kept = planRemovals([stored(`ad:x-${e.driveFileId}`, { artist_id: e.artistId, shareable: true, drive_file_id: e.driveFileId })], { artist: { id: e.artistId, name: "x" }, rows: [] }, SOURCE_MAP);
      assert.equal(kept.length, 0, e.name);
    }
  });
});

describe("owner suggestions (proposals only)", () => {
  it("statics and crowd or venue videos read promoter; posts, IG ids and press kits read artist; the rest unsure", () => {
    assert.equal(suggestOwner({ file: "ENZO- TICKETING TIERS ARTWORK", kind: "static" }).owner, "promoter");
    assert.equal(suggestOwner({ file: "Puzzle crowd recap", kind: "clip" }).owner, "promoter");
    assert.equal(suggestOwner({ file: "Live at Circuit & Engine Rooms", kind: "clip" }, { venueNames: ["Circuit & Engine Rooms"] }).owner, "promoter");
    assert.equal(suggestOwner({ file: "Enzo IG post 3", kind: "clip" }).owner, "artist");
    assert.equal(suggestOwner({ file: "IW Feed Post - Countdown Promo", kind: "clip" }).owner, "unsure", "a feed post may be the promoter's feed");
    assert.equal(suggestOwner({ file: "IV Location Reel - FEED", kind: "clip" }).owner, "unsure", "a bare reel isn't the artist's account");
    assert.equal(suggestOwner({ file: "17987037296972560.mp4", kind: "clip" }).owner, "artist");
    assert.equal(suggestOwner({ file: "Enzo press shot", kind: "static" }).owner, "artist", "a press shot isn't the client's artwork");
    assert.equal(suggestOwner({ file: "Puzzle - Enzo Vid CTA 1", kind: "clip" }).owner, "unsure");
    assert.equal(suggestOwner({ file: "Puzzle - Enzo Vid 2 - 12PM Thursday", kind: "clip" }, { venueNames: ["Circuit & Engine Rooms"] }).owner, "unsure", "the client's name in an edit isn't the venue");
  });

  it("one creative is one line: bulk-attach tails and copies fold", () => {
    assert.equal(creativeName("Arthi Artist Card Motion \u2014 attached:120251365392580755"), "Arthi Artist Card Motion");
    assert.equal(creativeName("Arthi Artist Card Motion \u2014 Garage Audience 2"), "Arthi Artist Card Motion");
    assert.equal(creativeName("Adam Promo Vid -Cutdown 2 \u2013 Copy 2"), "Adam Promo Vid -Cutdown 2");
    assert.equal(creativeName("Enzo - UGC 1 \u2013 Copy \u2013 Copy"), "Enzo - UGC 1");
    assert.equal(creativeName("Lineup - 2 for 1"), "Lineup - 2 for 1");
  });

  it("a suggestion never marks anything shareable or changes an owner: the plan is the same, every held file stays held", () => {
    const plan = planArtistAssets(inputs(), ENZO);
    const before = JSON.stringify(plan.rows);
    const files = heldNoSourceFiles(plan.rows, ENZO.name);
    assert.ok(files.length > 0);
    for (const f of files) {
      const s = suggestOwner(f);
      assert.deepEqual(Object.keys(s).sort(), ["owner", "why"]);
      const rows = plan.rows.filter((r) => r.name === f.file && r.source_event_id === f.eventId);
      assert.ok(rows.every((r) => !r.shareable && r.owner_kind === "promoter"), f.file);
    }
    assert.equal(JSON.stringify(plan.rows), before);
    assert.ok(!files.some((f) => plan.rows.some((r) => r.name === f.file && r.shareable)), "a shareable row is never in the held list");
  });
});

describe("the source map (confirmed sources)", () => {
  it("every entry has its who, when and Drive id; Enzo's four UGC files are the artist's", () => {
    assert.equal(SOURCE_MAP.length, 4);
    for (const e of SOURCE_MAP) {
      assert.match(e.driveFileId, /^[A-Za-z0-9_-]{20,}$/, e.name);
      assert.equal(e.ownerKind, "artist");
      assert.equal(e.confirmedBy, "Matas");
      assert.equal(e.confirmedOn, "2026-11-25");
      assert.equal(e.source, "Enzo's Instagram");
      assert.equal(e.ranAs.eventCode, "P26-BDAY");
    }
    assert.equal(new Set(SOURCE_MAP.map((e) => e.driveFileId)).size, 4);
    assert.deepEqual(SOURCE_MAP.map((e) => e.ranAs.clip), ["UGC 1", "UGC 2", "UGC 3", "UGC 4"]);
    assert.ok(ALIASES.some((a) => a.artistId === SOURCE_MAP[0]!.artistId && a.alias === "Enzo"), "Puzzle's 'Enzo - …' names match through the recorded alias");
  });

  it("'Puzzle - Enzo UGC 1' folds into UGC 1 and is shareable with it", () => {
    const ugc1: SourceEntry = { ...MAPPED, driveFileId: "drv-ugc1", name: "Enzo Siragusa - UGC 1.mp4", ranAs: { eventCode: "P26-BDAY", clip: "UGC 1" } };
    const puz = planArtistAssets(inputs([ugc1]), ENZO).rows.find((r) => r.asset_key === "ad:ad-puz")!;
    assert.deepEqual([puz.owner_kind, puz.shareable, puz.drive_file_id, puz.source_client_id], ["artist", true, "drv-ugc1", "c-puzzle"]);
  });

  it("a file in the map comes out artist and shareable; its ads keep their show and client", () => {
    const plan = planArtistAssets(inputs([MAPPED]), ENZO);
    const file = plan.rows.find((r) => r.asset_key === "drive:drv-ugc2")!;
    assert.deepEqual([file.kind, file.owner_kind, file.shareable, file.held_reason, file.source_client_id], ["clip", "artist", true, null, null]);
    const ad = plan.rows.find((r) => r.asset_key === "ad:ad-map")!;
    assert.deepEqual([ad.owner_kind, ad.shareable, ad.drive_file_id, ad.source_event_id, ad.source_client_id], ["artist", true, "drv-ugc2", "e-bday", "c-puzzle"]);
  });

  it("a file outside the map stays held, map or no map", () => {
    for (const sources of [[], [MAPPED]]) {
      const puz = planArtistAssets(inputs(sources), ENZO).rows.find((r) => r.asset_key === "ad:ad-puz")!;
      assert.deepEqual([puz.owner_kind, puz.shareable, puz.held_reason, puz.source_client_id], ["promoter", false, "filmed", "c-puzzle"]);
    }
    const unmapped = planArtistAssets(inputs([]), ENZO).rows.find((r) => r.asset_key === "ad:ad-map")!;
    assert.equal(unmapped.shareable, false, "without the map the same ad is Puzzle's");
  });

  it("another client's event gets the mapped file with its results, and Puzzle's held count drops by every name it ran as", () => {
    const i = inputs([MAPPED]);
    const view = (sources: readonly SourceEntry[]) => {
      const inp = inputs(sources);
      return buildArtistView({ assets: planArtistAssets(inp, ENZO).rows, insights: inp.insights, events: inp.events, linkedEventIds: ["e-bday"], today: "2026-11-25" });
    };
    const before = forEvent(view([]), "c-electric");
    const after = forEvent(view([MAPPED]), "c-electric");
    assert.equal(after.held.get("c-puzzle"), before.held.get("c-puzzle")! - 2, "'Enzo - UGC 2' and 'Enzo Siragusa - UGC 2' are both UGC 2");
    const ranked = after.ranked.signup.find((r) => r.group.key === "drive:drv-ugc2")!;
    assert.equal(ranked.group.name, "Enzo Siragusa - UGC 2.mp4");
    assert.equal(ranked.group.code, "P26-BDAY");
    assert.equal(Math.round(ranked.cost * 1000) / 1000, Math.round(((30 + 25.2) / (15 + 12)) * 1000) / 1000);
    assert.ok(i.sources.length === 1);
  });

  it("a Lab clip whose file is in the map is the artist's, and so is a render of it alone", () => {
    const i = inputs([{ ...MAPPED, driveFileId: "drv-crowd-file" }]);
    i.creativeAssets = i.creativeAssets.map((a) => (a.id === "ca-crowd" ? { ...a, drive_file_id: "drv-crowd-file" } : a));
    const rows = planArtistAssets(i, ENZO).rows;
    assert.equal(rows.find((r) => r.asset_key === "clip:clip-crowd")!.shareable, true);
    assert.equal(rows.find((r) => r.asset_key === "render:r-mixed")!.shareable, true, "its only clip is now the artist's");
  });
});

