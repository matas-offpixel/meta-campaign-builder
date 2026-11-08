import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLabDraft } from "../lab-draft.ts";
import type { ServiceRoleDb } from "../load.ts";
import { proposeRound, RoundBuildError } from "../propose.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

const USER = "op";
const CLIENT = "client-1";
const EVENT = "evt-1";
const ARTIST = "artist-1";
const ADSET = "as-1";

function seed(over: Record<string, Record<string, unknown>[]> = {}): FakeDb {
  return fakeDb({
    events: [{ id: EVENT, client_id: CLIENT }],
    creative_lab_artists: [
      {
        id: ARTIST,
        client_id: CLIENT,
        name: "Luke Dean",
        rights_doc_ref: "PENDING: Luke Dean team",
        approved_at: "2026-11-01T00:00:00Z",
        starting_caption: "Luke Dean joins",
      },
    ],
    launched_ad_sets: [{
      meta_adset_id: ADSET,
      ad_account_id: "act",
      meta_campaign_id: "camp",
      draft_id: "draft-1",
      objective: "registration",
      source_name: "Puzzle signup",
    }],
    launched_ads: [
      {
        id: "ad-live",
        meta_adset_id: ADSET,
        destination_url: "https://tickets.example/p26",
        cta: "LEARN_MORE",
        launched_at: "2026-11-01",
      },
    ],
    campaign_drafts: [
      { id: "draft-1", draft_json: { creatives: [{ identity: { pageId: "page-1", instagramActorId: "ig-1" } }] } },
    ],
    creative_lab_clips: [],
    creative_lab_captions: [],
    creative_assets: [],
    artists: [],
    creative_lab_rounds: [],
    creative_lab_round_ads: [],
    creative_lab_renders: [],
    ...over,
  });
}

const db = (fake: FakeDb) => fake as unknown as ServiceRoleDb;

function withVoices(over: Record<string, unknown> = {}) {
  return seed({
    creative_lab_clips: [
      { id: "clip-1", artist_id: ARTIST, clip_no: 1, in_s: 0, out_s: 10, creative_asset_id: "asset-1" },
    ],
    creative_assets: [{ id: "asset-1", user_id: USER, duration_seconds: 12 }],
    creative_lab_captions: [
      { id: "cap-line", event_id: EVENT, status: "approved", text: "Luke Dean joins", style: "lineup", caption_no: 1, style_version: "v1", created_at: "2026-11-04" },
      { id: "cap-fp", event_id: EVENT, status: "approved", text: "I play Circuit", style: "artist_first_person", caption_no: 1, style_version: "v1", created_at: "2026-11-05" },
    ],
    ...over,
  });
}

describe("proposeRound", () => {
  it("an uncleared artist proposes a promoter-voice round and skips artist voice", async () => {
    const fake = withVoices();
    fake.tables.creative_lab_artists[0].approved_at = null;
    fake.tables.creative_lab_artists[0].starting_caption = "I play Circuit";
    fake.tables.creative_lab_artists[0].meta_page_id = "page-luke";
    fake.tables.creative_lab_artists[0].instagram_actor_id = "ig-luke";
    const result = await proposeRound(db(fake), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: ADSET });
    assert.equal(result.ads.length > 0, true);
    assert.equal(result.ads.every((ad) => !ad.adName.includes("artist_first_person")), true);
    assert.equal(result.ads[0]?.role, "control");
    assert.match(result.ads[0]?.adName ?? "", /lineup/);
    assert.ok(result.skipped.some((row) => row.reason === "needs clearance to run on Luke Dean's channels"));
    assert.ok(result.skipped.some((row) => row.reason === "not cleared for Luke Dean's own channels"));
  });

  it("a quote is skipped with the artist-voice reason until the artist is cleared", async () => {
    const fake = withVoices();
    fake.tables.creative_lab_captions = [
      { id: "cap-line", event_id: EVENT, status: "approved", text: "Luke Dean joins", style: "lineup", caption_no: 1, style_version: "v1", created_at: "2026-11-04" },
      { id: "cap-quote", event_id: EVENT, status: "approved", text: "See you at Circuit", style: "quote", mode: "quote", artist_id: ARTIST, caption_no: 1, style_version: "v1", created_at: "2026-11-06" },
    ];
    fake.tables.creative_lab_artists[0].approved_at = null;
    fake.tables.creative_lab_artists[0].meta_page_id = "page-luke";
    fake.tables.creative_lab_artists[0].instagram_actor_id = "ig-luke";
    const result = await proposeRound(db(fake), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: ADSET });
    assert.ok(result.skipped.some((row) => row.reason === "not cleared for Luke Dean's own channels"));
    assert.equal(result.ads.some((ad) => ad.adName.includes("quote")), false);
    assert.ok(result.ads.some((ad) => ad.adName.includes("lineup")));
  });

  it("a cleared artist gets both voices", async () => {
    const fake = withVoices();
    fake.tables.creative_lab_artists[0].meta_page_id = "page-luke";
    fake.tables.creative_lab_artists[0].instagram_actor_id = "ig-luke";
    fake.tables.creative_lab_artists[0].rights_doc_ref = null;
    const result = await proposeRound(db(fake), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: ADSET });
    assert.ok(result.ads.some((ad) => ad.adName.includes("lineup")));
    assert.ok(result.ads.some((ad) => ad.adName.includes("artist_first_person")));
  });

  it("builds round 1 as the starting caption plus three challengers, and reuses a finished render", async () => {
    const fake = seed({
      creative_lab_clips: [
        { id: "clip-1", artist_id: ARTIST, clip_no: 1, in_s: 0, out_s: 10, creative_asset_id: "asset-1" },
        { id: "clip-2", artist_id: ARTIST, clip_no: 2, in_s: 0, out_s: 12, creative_asset_id: "asset-1" },
        { id: "clip-3", artist_id: ARTIST, clip_no: 3, in_s: 0, out_s: 45, creative_asset_id: "asset-1" },
      ],
      creative_assets: [{ id: "asset-1", user_id: USER, duration_seconds: 20 }],
      creative_lab_captions: [
        { id: "cap-start", event_id: EVENT, status: "approved", text: "Luke Dean joins", style: "lineup", caption_no: 1, style_version: "v1", created_at: "2026-10-01" },
        { id: "cap-fp", event_id: EVENT, status: "approved", text: "I play Circuit", style: "artist_first_person", caption_no: 1, style_version: "v1", created_at: "2026-11-05" },
        { id: "cap-a", event_id: EVENT, status: "approved", text: "You in?", style: "question", caption_no: 1, style_version: "v1", created_at: "2026-11-04" },
        { id: "cap-b", event_id: EVENT, status: "approved", text: "Circuit tonight", style: "venue", caption_no: 1, style_version: "v1", created_at: "2026-11-03" },
        { id: "cap-c", event_id: EVENT, status: "approved", text: "See you there", style: "experience", caption_no: 1, style_version: "v1", created_at: "2026-11-02" },
        { id: "cap-d", event_id: EVENT, status: "approved", text: "An older one", style: "pov", caption_no: 1, style_version: "v1", created_at: "2026-10-02" },
      ],
      creative_lab_renders: [
        { id: "render-done", clip_id: "clip-1", caption_id: "cap-start", style_version: "v1", aspect: "9:16", status: "done" },
      ],
    });
    const result = await proposeRound(db(fake), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: ADSET });
    assert.equal(result.roundNo, 1);
    assert.equal(result.status, "rendering");
    assert.equal(fake.tables.creative_lab_rounds[0].channel, "meta");
    assert.deepEqual(
      result.ads.map((ad) => [ad.adName, ad.role, ad.launchState]),
      [
        ["LUKEDEAN-clip01_cap-lineup1", "control", "ready"],
        ["LUKEDEAN-clip01_cap-question1", "challenger", "pending"],
        ["LUKEDEAN-clip01_cap-venue1", "challenger", "pending"],
        ["LUKEDEAN-clip01_cap-experience1", "challenger", "pending"],
        ["LUKEDEAN-clip02_cap-lineup1", "challenger", "pending"],
      ],
    );
    assert.equal(result.ads[0].renderId, "render-done");
    assert.equal(fake.tables.creative_lab_renders.length, 5);
    assert.ok(result.skipped.some((row) => row.reason.includes("45s")));
    assert.ok(result.skipped.some((row) => row.reason.includes("artist_first_person")));
    assert.equal(result.target.pageId, "page-1");
    assert.equal(result.target.destinationUrl, "https://tickets.example/p26");
    assert.equal(result.target.campaignObjective, "registration");
    assert.equal(result.target.adSetName, "Puzzle signup");
    assert.notEqual(result.target.campaignObjective, "OUTCOME_SALES");
    assert.equal(fake.tables.creative_lab_rounds[0].meta_campaign_objective, "registration");
    assert.equal(fake.tables.creative_lab_rounds[0].meta_adset_name, "Puzzle signup");
    const draft = buildLabDraft({
      roundId: result.roundId,
      eventId: EVENT,
      clientId: CLIENT,
      campaignName: "Puzzle",
      adAccountId: result.target.adAccountId,
      campaignId: result.target.metaCampaignId,
      campaignObjective: result.target.campaignObjective,
      adSetId: result.target.metaAdsetId,
      adSetName: result.target.adSetName,
      adSetStatus: result.target.adSetStatus,
      destinationUrl: result.target.destinationUrl,
      cta: result.target.cta,
    }, []);
    assert.equal(draft.settings.objective, "registration");
    assert.equal(draft.settings.existingMetaCampaign?.objective, "registration");
    assert.notEqual(draft.settings.existingMetaCampaign?.objective, "OUTCOME_SALES");
    assert.equal(draft.settings.existingMetaAdSets?.[0]?.name, "Puzzle signup");
  });

  it("stops at no clips before it writes a round", async () => {
    const fake = seed();
    await assert.rejects(
      proposeRound(db(fake), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: "missing" }),
      (err: unknown) => err instanceof RoundBuildError && err.code === "no_clips" && err.message === "no clips",
    );
    assert.equal(fake.tables.creative_lab_rounds.length, 0);
    assert.equal(fake.writes.some((write) => write.table === "artists"), false);
  });

  it("builds round 2 from the previous verdicts and copies the stored ad set", async () => {
    const fake = seed({
      creative_lab_clips: [
        { id: "clip-1", artist_id: ARTIST, clip_no: 1, in_s: 0, out_s: 10 },
        { id: "clip-2", artist_id: ARTIST, clip_no: 2, in_s: 0, out_s: 10 },
      ],
      creative_lab_captions: [
        { id: "cap-start", event_id: EVENT, status: "approved", text: "Luke Dean joins", style: "lineup", caption_no: 1, style_version: "v1", created_at: "2026-10-01" },
        { id: "cap-new", event_id: EVENT, status: "approved", text: "You in?", style: "question", caption_no: 1, style_version: "v1", created_at: "2026-11-04" },
      ],
      creative_lab_rounds: [
        {
          id: "round-1",
          event_id: EVENT,
          artist_id: ARTIST,
          round_no: 1,
          channel: "meta",
          status: "draft",
          ad_account_id: "act",
          meta_campaign_id: "camp",
          meta_adset_id: ADSET,
          page_id: "page-1",
          instagram_actor_id: "ig-1",
          destination_url: "https://tickets.example/p26",
          cta: "LEARN_MORE",
          meta_campaign_objective: "registration",
          meta_adset_name: "Puzzle signup",
        },
      ],
      creative_lab_round_ads: [
        { id: "prev-ad", round_id: "round-1", clip_id: "clip-1", caption_id: "cap-start", verdict: "winner", confirmed: false },
      ],
    });
    const result = await proposeRound(db(fake), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: ADSET });
    assert.equal(result.roundNo, 2);
    const fresh = fake.tables.creative_lab_round_ads.filter((row) => row.round_id === result.roundId);
    assert.deepEqual(
      fresh.map((row) => [row.clip_id, row.caption_id, row.role, row.retest_of ?? null]),
      [
        ["clip-1", "cap-start", "control", "prev-ad"],
        ["clip-1", "cap-new", "challenger", null],
        ["clip-2", "cap-start", "challenger", null],
      ],
    );
    assert.equal(result.target.metaAdsetId, ADSET);
  });

  it("refuses a round that would put more than 50 ads in the ad set", async () => {
    const ads = Array.from({ length: 49 }, (_, i) => ({
      id: `live-${i}`,
      meta_adset_id: ADSET,
      destination_url: "https://tickets.example/p26",
      cta: "LEARN_MORE",
      launched_at: "2026-11-01",
    }));
    const fake = seed({
      launched_ads: ads,
      creative_lab_clips: [{ id: "clip-1", artist_id: ARTIST, clip_no: 1, in_s: 0, out_s: 10 }],
      creative_lab_captions: [
        { id: "cap-start", event_id: EVENT, status: "approved", text: "Luke Dean joins", style: "lineup", caption_no: 1, style_version: "v1", created_at: "2026-10-01" },
        { id: "cap-a", event_id: EVENT, status: "approved", text: "You in?", style: "question", caption_no: 1, style_version: "v1", created_at: "2026-11-04" },
      ],
    });
    await assert.rejects(
      proposeRound(db(fake), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: ADSET, maxAds: 2 }),
      (err: unknown) => err instanceof RoundBuildError && err.code === "ad_set_full",
    );
    assert.equal(fake.tables.creative_lab_rounds.length, 0);
  });

  it("rejects a crowd claim when the clip has no filmed show and keeps it when that show sold enough", async () => {
    const captions = [
      { id: "cap-start", event_id: EVENT, status: "approved", text: "Luke Dean joins", style: "lineup", caption_no: 1, style_version: "v1", created_at: "2026-10-01" },
      { id: "cap-crowd", event_id: EVENT, status: "approved", text: "This is what 2,000 people look like", style: "social_proof", caption_no: 1, style_version: "v1", created_at: "2026-11-04" },
    ];
    const blocked = seed({
      creative_lab_clips: [{ id: "clip-1", artist_id: ARTIST, clip_no: 1, in_s: 0, out_s: 10, event_id: null }],
      creative_lab_captions: captions,
    });
    const refused = await proposeRound(db(blocked), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: ADSET });
    assert.deepEqual(refused.ads.map((ad) => ad.captionId), ["cap-start"]);
    assert.ok(refused.skipped.some((row) => row.reason.includes("2,000 people")));

    const allowed = seed({
      events: [{ id: EVENT, client_id: CLIENT, tickets_sold: 2000 }],
      creative_lab_clips: [{ id: "clip-1", artist_id: ARTIST, clip_no: 1, in_s: 0, out_s: 10, event_id: EVENT }],
      creative_lab_captions: captions,
    });
    const kept = await proposeRound(db(allowed), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: ADSET });
    assert.deepEqual(kept.ads.map((ad) => ad.captionId), ["cap-start", "cap-crowd"]);
  });

  it("caps a support artist at 2 ads across rounds and does not cap a headliner", async () => {
    const captions = [
      { id: "cap-start", event_id: EVENT, status: "approved", text: "Benji King plays", style: "lineup", caption_no: 1, style_version: "v1", created_at: "2026-11-05" },
      { id: "cap-a", event_id: EVENT, status: "approved", text: "You in?", style: "question", caption_no: 1, style_version: "v1", created_at: "2026-11-04" },
      { id: "cap-b", event_id: EVENT, status: "approved", text: "Circuit tonight", style: "venue", caption_no: 1, style_version: "v1", created_at: "2026-11-03" },
      { id: "cap-c", event_id: EVENT, status: "approved", text: "See you there", style: "experience", caption_no: 1, style_version: "v1", created_at: "2026-11-02" },
    ];
    const clips = [{ id: "clip-1", artist_id: ARTIST, clip_no: 1, in_s: 0, out_s: 10 }];
    const facts = {
      event_id: EVENT,
      lineup: ["Enzo Siragusa", "Luke Dean", "Reeshy", "Benji King"],
      headliners: ["Enzo Siragusa", "Luke Dean", "Reeshy"],
    };
    const support = seed({
      creative_lab_clips: clips,
      creative_lab_captions: captions,
      creative_lab_event_facts: [facts],
    });
    support.tables.creative_lab_artists[0].name = "Benji King";
    support.tables.creative_lab_artists[0].starting_caption = "Benji King plays";
    const first = await proposeRound(db(support), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: ADSET });
    assert.equal(first.ads.length, 2);
    assert.ok(first.skipped.filter((row) => row.reason === "support_cap").length >= 1);

    const again = seed({
      creative_lab_clips: clips,
      creative_lab_captions: [
        ...captions,
        { id: "cap-new", event_id: EVENT, status: "approved", text: "One more", style: "pov", caption_no: 1, style_version: "v1", created_at: "2026-11-06" },
      ],
      creative_lab_event_facts: [facts],
      creative_lab_rounds: [{
        id: "round-1",
        event_id: EVENT,
        artist_id: ARTIST,
        round_no: 1,
        channel: "meta",
        status: "draft",
        ad_account_id: "act",
        meta_campaign_id: "camp",
        meta_adset_id: ADSET,
        page_id: "page-1",
        instagram_actor_id: "ig-1",
        destination_url: "https://tickets.example/p26",
        cta: "LEARN_MORE",
        meta_campaign_objective: "registration",
        meta_adset_name: "Puzzle signup",
      }],
      creative_lab_round_ads: [
        { id: "prev-1", round_id: "round-1", clip_id: "clip-1", caption_id: "cap-start", verdict: "winner", confirmed: true },
        { id: "prev-2", round_id: "round-1", clip_id: "clip-1", caption_id: "cap-a", verdict: "winner", confirmed: true },
      ],
    });
    again.tables.creative_lab_artists[0].name = "Benji King";
    again.tables.creative_lab_artists[0].starting_caption = "Benji King plays";
    await assert.rejects(
      proposeRound(db(again), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: ADSET }),
      (err: unknown) => err instanceof RoundBuildError && err.code === "support_cap",
    );
    assert.equal(again.tables.creative_lab_rounds.length, 1);

    const headliner = seed({
      creative_lab_clips: clips,
      creative_lab_captions: captions.map((row) => ({ ...row, text: row.id === "cap-start" ? "Enzo Siragusa plays" : row.text })),
      creative_lab_event_facts: [facts],
    });
    headliner.tables.creative_lab_artists[0].name = "Enzo Siragusa";
    headliner.tables.creative_lab_artists[0].starting_caption = "Enzo Siragusa plays";
    const open = await proposeRound(db(headliner), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: ADSET });
    assert.ok(open.ads.length > 2);
    assert.equal(open.skipped.some((row) => row.reason === "support_cap"), false);
  });

  it("refuses to build a round when headliners are empty", async () => {
    const fake = seed({
      creative_lab_clips: [{ id: "clip-1", artist_id: ARTIST, clip_no: 1, in_s: 0, out_s: 10 }],
      creative_lab_captions: [
        { id: "cap-start", event_id: EVENT, status: "approved", text: "Luke Dean joins", style: "lineup", caption_no: 1, style_version: "v1", created_at: "2026-11-05" },
      ],
      creative_lab_event_facts: [{ event_id: EVENT, lineup: ["Luke Dean"], headliners: [] }],
    });
    await assert.rejects(
      proposeRound(db(fake), { userId: USER, eventId: EVENT, artistId: ARTIST, adsetMetaId: ADSET }),
      /headliners not set/,
    );
    assert.equal(fake.tables.creative_lab_rounds.length, 0);
  });
});
