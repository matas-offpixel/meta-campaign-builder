import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { attachedAdSetKey } from "../../types.ts";
import { buildLabDraft, buildLabLaunchBody } from "../lab-draft.ts";
import { launchApprovedRound, postLabLaunch, type LabUploadRequest } from "../launch.ts";
import type { ServiceRoleDb } from "../load.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

const ROUND = "round-1";
const USER = "op";
const ADSET = "adset-1";

function tree(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tree(path) : [path];
  });
}

function source(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function roundDb(over: { status?: string; ads?: Record<string, unknown>[] } = {}): FakeDb {
  return fakeDb({
    creative_lab_rounds: [
      {
        id: ROUND,
        user_id: USER,
        event_id: "evt-1",
        artist_id: "artist-1",
        status: over.status ?? "approved",
        ad_account_id: "act_1",
        meta_campaign_id: "camp_1",
        meta_adset_id: ADSET,
        page_id: "page_promoter",
        instagram_actor_id: "ig_1",
        destination_url: "https://tickets.example/puzzle",
        cta: "buy_tickets",
        meta_campaign_objective: "OUTCOME_LEADS",
        meta_adset_name: "Puzzle signup",
        meta_adset_status: "ACTIVE",
      },
    ],
    events: [{ id: "evt-1", client_id: "client-1", name: "Puzzle 4th Birthday Part 1", user_id: USER }],
    creative_lab_artists: [
      {
        id: "artist-1",
        client_id: "client-1",
        name: "Luke Dean",
        rights_doc_ref: "rights.pdf",
        approved_at: "2026-11-01T00:00:00Z",
      },
    ],
    artists: [{ id: "roster-1", client_id: "client-1", name: "Luke Dean", meta_page_id: "page_luke" }],
    creative_lab_captions: [
      { id: "cap-1", event_id: "evt-1", style: "lineup", primary_text: "Who's coming?", text: "Luke Dean" },
      { id: "cap-2", event_id: "evt-1", style: "artist_first_person", primary_text: "I play Circuit", text: "I play" },
    ],
    creative_lab_renders: [
      { id: "render-1", user_id: USER, creative_asset_id: "asset-1" },
      { id: "render-2", user_id: USER, creative_asset_id: "asset-2" },
    ],
    creative_assets: [
      { id: "asset-1", user_id: USER, storage_path: "videos/creative-lab/a.mp4", content_hash: "hash-a", byte_size: 10, filename: "a.mp4" },
      { id: "asset-2", user_id: USER, storage_path: "videos/creative-lab/b.mp4", content_hash: "hash-a", byte_size: 10, filename: "b.mp4" },
    ],
    creative_lab_round_ads: over.ads ?? [
      { id: "ad-1", round_id: ROUND, user_id: USER, ad_name: "LUKEDEAN-clip01_cap-lineup1", caption_id: "cap-1", render_id: "render-1", launch_state: "ready" },
    ],
    creative_lab_round_ad_launches: [],
    launched_ads: [],
  });
}

function calls() {
  const uploads: LabUploadRequest[] = [];
  const launches: { createPaused?: boolean; names: string[]; pages: string[]; ig: (string | null)[]; objective: string; settingsObjective: string }[] = [];
  const tags: { metaAdId: string; style: string; creativeName: string }[] = [];
  return {
    uploads,
    launches,
    tags,
    upload: async (request: LabUploadRequest) => {
      uploads.push(request);
      return { videoId: `vid-${request.contentHash}`, registryAssetId: "asset-1" };
    },
    launch: async (body: { draft: { settings: { objective: string; existingMetaCampaign?: { objective?: string } }; creatives: { name: string; identity: { pageId: string; instagramActorId?: string } }[] }; createPaused: true }) => {
      launches.push({
        createPaused: body.createPaused,
        names: body.draft.creatives.map((creative) => creative.name),
        pages: body.draft.creatives.map((creative) => creative.identity.pageId),
        ig: body.draft.creatives.map((creative) => creative.identity.instagramActorId ?? null),
        objective: body.draft.settings.existingMetaCampaign?.objective ?? "",
        settingsObjective: body.draft.settings.objective,
      });
      return { ok: true, status: 201, launchRunId: "run-1" };
    },
    tag: async (_db: ServiceRoleDb, args: { metaAdId: string; style: string; creativeName: string }) => {
      tags.push({ metaAdId: args.metaAdId, style: args.style, creativeName: args.creativeName });
      return { tagId: "tag-1", eventId: "evt-1", eventSource: "round" as const };
    },
  };
}

describe("lab draft", () => {
  it("attaches one 9:16 video per ad, named and captioned, with enhancements off", () => {
    const draft = buildLabDraft(
      {
        roundId: ROUND,
        eventId: "evt-1",
        clientId: "client-1",
        campaignName: "Puzzle",
        adAccountId: "act_1",
        campaignId: "camp_1",
        campaignObjective: "OUTCOME_SALES",
        adSetId: ADSET,
        adSetName: ADSET,
        adSetStatus: "ACTIVE",
        destinationUrl: "https://tickets.example/puzzle",
        cta: "buy_tickets",
      },
      [
        {
          id: "ad-1",
          adName: "LUKEDEAN-clip01_cap-lineup1",
          primaryText: "Who's coming?",
          videoId: "vid-1",
          registryAssetId: "asset-1",
          pageId: "page_promoter",
          instagramActorId: "ig_1",
        },
      ],
    );
    assert.equal(draft.id, ROUND);
    assert.equal(draft.settings.wizardMode, "attach_adset");
    assert.equal(draft.settings.creativeIntegrityMode, undefined);
    assert.deepEqual(draft.creativeAssignments[attachedAdSetKey(ADSET)], ["ad-1"]);
    const creative = draft.creatives[0];
    assert.equal(creative.name, "LUKEDEAN-clip01_cap-lineup1");
    assert.equal(creative.captions[0].text, "Who's coming?");
    assert.equal(creative.identity.pageId, "page_promoter");
    assert.equal(creative.identity.instagramActorId, "ig_1");
    assert.equal(creative.mediaType, "video");
    assert.equal(creative.assetVariations.length, 1);
    assert.equal(creative.assetVariations[0].assets.length, 1);
    assert.equal(creative.assetVariations[0].assets[0].aspectRatio, "9:16");
    assert.equal(creative.assetVariations[0].assets[0].videoId, "vid-1");
    assert.deepEqual(creative.enhancements, {
      enabled: false,
      textOptimizations: false,
      visualEnhancements: false,
      musicEnhancements: false,
      autoVariations: false,
    });
    assert.equal(buildLabLaunchBody(draft).createPaused, true);
  });
});

describe("launch a round", () => {
  it("returns 503 before any upload or launch when the flag is not exactly true", async () => {
    const previous = process.env.CREATIVE_LAB_LAUNCH_ENABLED;
    const fake = roundDb();
    const seen = calls();
    try {
      delete process.env.CREATIVE_LAB_LAUNCH_ENABLED;
      const off = await postLabLaunch(ROUND, USER, { db: fake as unknown as ServiceRoleDb, upload: seen.upload, launch: seen.launch });
      assert.equal(off.status, 503);
      process.env.CREATIVE_LAB_LAUNCH_ENABLED = "false";
      const other = await postLabLaunch(ROUND, USER, { db: fake as unknown as ServiceRoleDb, upload: seen.upload, launch: seen.launch });
      assert.equal(other.status, 503);
      assert.equal(other.body.error, "Lab launches are switched off");
      assert.equal(seen.uploads.length, 0);
      assert.equal(seen.launches.length, 0);
    } finally {
      if (previous === undefined) delete process.env.CREATIVE_LAB_LAUNCH_ENABLED;
      else process.env.CREATIVE_LAB_LAUNCH_ENABLED = previous;
    }
  });

  it("refuses a round that is not approved", async () => {
    const fake = roundDb({ status: "draft" });
    const seen = calls();
    await assert.rejects(
      launchApprovedRound(ROUND, { db: fake as unknown as ServiceRoleDb, userId: USER, upload: seen.upload, launch: seen.launch, tag: seen.tag }),
      /not approved/,
    );
    assert.equal(seen.uploads.length, 0);
    assert.equal(seen.launches.length, 0);
  });

  it("skips a render_failed ad and launches the ready one paused", async () => {
    const fake = roundDb({
      ads: [
        { id: "ad-1", round_id: ROUND, user_id: USER, ad_name: "LUKEDEAN-clip01_cap-lineup1", caption_id: "cap-1", render_id: "render-1", launch_state: "ready" },
        { id: "ad-2", round_id: ROUND, user_id: USER, ad_name: "LUKEDEAN-clip02_cap-lineup1", caption_id: "cap-1", render_id: "render-2", launch_state: "render_failed", launch_error: "timeout" },
      ],
    });
    const seen = calls();
    fake.tables.launched_ads.push({ launch_run_id: "run-1", ad_name: "LUKEDEAN-clip01_cap-lineup1", meta_ad_id: "meta-1", meta_adset_id: ADSET, meta_campaign_id: "camp_1", ad_account_id: "act_1" });
    const result = await launchApprovedRound(ROUND, { db: fake as unknown as ServiceRoleDb, userId: USER, upload: seen.upload, launch: seen.launch, tag: seen.tag });
    assert.equal(seen.launches[0].createPaused, true);
    assert.deepEqual(seen.launches[0].names, ["LUKEDEAN-clip01_cap-lineup1"]);
    assert.equal(result.skipped[0].reason, "timeout");
    assert.equal(result.launched[0].metaAdId, "meta-1");
    assert.equal(fake.tables.creative_lab_rounds[0].status, "launched");
    assert.equal(seen.tags[0].style, "lineup");
    assert.equal(fake.tables.creative_lab_round_ad_launches.length, 1);
  });

  it("keeps the round approved when one ad fails", async () => {
    const fake = roundDb({
      ads: [
        { id: "ad-1", round_id: ROUND, user_id: USER, ad_name: "LUKEDEAN-clip01_cap-lineup1", caption_id: "cap-1", render_id: "render-1", launch_state: "ready" },
        { id: "ad-2", round_id: ROUND, user_id: USER, ad_name: "LUKEDEAN-clip02_cap-lineup1", caption_id: "cap-1", render_id: "render-1", launch_state: "ready" },
      ],
    });
    const seen = calls();
    fake.tables.launched_ads.push({ launch_run_id: "run-1", ad_name: "LUKEDEAN-clip01_cap-lineup1", meta_ad_id: "meta-1", meta_adset_id: ADSET, meta_campaign_id: "camp_1", ad_account_id: "act_1" });
    const result = await launchApprovedRound(ROUND, { db: fake as unknown as ServiceRoleDb, userId: USER, upload: seen.upload, launch: seen.launch, tag: seen.tag });
    assert.equal(result.status, "approved");
    assert.equal(fake.tables.creative_lab_rounds[0].status, "approved");
    assert.equal(result.errors.length, 1);
    assert.equal(fake.tables.creative_lab_round_ads.find((ad) => ad.id === "ad-2")?.launch_state, "launch_failed");
    assert.equal(result.launched.length, 1);
  });

  it("writes the launch row, the tag and launch_state, and a retry does not send the ad again", async () => {
    const fake = roundDb();
    const seen = calls();
    fake.tables.launched_ads.push({ launch_run_id: "run-1", ad_name: "LUKEDEAN-clip01_cap-lineup1", meta_ad_id: "meta-1", meta_adset_id: ADSET, meta_campaign_id: "camp_1", ad_account_id: "act_1" });
    const deps = { db: fake as unknown as ServiceRoleDb, userId: USER, upload: seen.upload, launch: seen.launch, tag: seen.tag };
    const first = await launchApprovedRound(ROUND, deps);
    assert.equal(first.status, "launched");
    assert.equal(fake.tables.creative_lab_round_ads[0].launch_state, "launched");
    assert.equal(fake.tables.creative_lab_rounds[0].draft_id, ROUND);
    fake.tables.creative_lab_rounds[0].status = "approved";
    const second = await launchApprovedRound(ROUND, deps);
    assert.equal(seen.launches.length, 1);
    assert.equal(seen.uploads.length, 1);
    assert.equal(fake.tables.creative_lab_round_ad_launches.length, 1);
    assert.equal(second.launched.length, 0);
  });

  it("an uncleared artist launches the promoter-voice ad and skips artist voice", async () => {
    const fake = roundDb({
      ads: [
        { id: "ad-1", round_id: ROUND, user_id: USER, ad_name: "LUKEDEAN-clip01_cap-lineup1", caption_id: "cap-1", render_id: "render-1", launch_state: "ready" },
        { id: "ad-2", round_id: ROUND, user_id: USER, ad_name: "LUKEDEAN-clip01_cap-artist_first_person1", caption_id: "cap-2", render_id: "render-2", launch_state: "ready" },
      ],
    });
    fake.tables.creative_lab_artists[0].approved_at = null;
    fake.tables.creative_lab_artists[0].meta_page_id = "page_luke";
    fake.tables.creative_lab_artists[0].instagram_actor_id = "ig_luke";
    fake.tables.launched_ads.push({
      launch_run_id: "run-1",
      ad_name: "LUKEDEAN-clip01_cap-lineup1",
      meta_ad_id: "meta-1",
      meta_adset_id: ADSET,
      meta_campaign_id: "camp_1",
      ad_account_id: "act_1",
    });
    const seen = calls();
    const result = await launchApprovedRound(ROUND, { db: fake as unknown as ServiceRoleDb, userId: USER, upload: seen.upload, launch: seen.launch, tag: seen.tag });
    assert.deepEqual(seen.launches[0]?.names, ["LUKEDEAN-clip01_cap-lineup1"]);
    assert.deepEqual(seen.launches[0]?.pages, ["page_promoter"]);
    assert.equal(result.skipped.some((row) => row.reason === "not cleared for Luke Dean's own channels"), true);
    assert.equal(result.launched.length, 1);
  });

  it("skips an artist-first-person ad that has no artist page", async () => {
    const fake = roundDb({
      ads: [
        { id: "ad-2", round_id: ROUND, user_id: USER, ad_name: "LUKEDEAN-clip01_cap-artist_first_person1", caption_id: "cap-2", render_id: "render-2", launch_state: "ready" },
      ],
    });
    const seen = calls();
    const result = await launchApprovedRound(ROUND, { db: fake as unknown as ServiceRoleDb, userId: USER, upload: seen.upload, launch: seen.launch, tag: seen.tag });
    assert.equal(seen.launches.length, 0);
    assert.equal(seen.uploads.length, 0);
    assert.equal(result.errors[0].error, "no artist page");
  });

  it("fails an artist-first-person ad before upload when the artist has no Instagram account", async () => {
    const fake = roundDb({
      ads: [
        { id: "ad-2", round_id: ROUND, user_id: USER, ad_name: "LUKEDEAN-clip01_cap-artist_first_person1", caption_id: "cap-2", render_id: "render-2", launch_state: "ready" },
      ],
    });
    fake.tables.creative_lab_artists[0].meta_page_id = "page_luke";
    const seen = calls();
    const result = await launchApprovedRound(ROUND, { db: fake as unknown as ServiceRoleDb, userId: USER, upload: seen.upload, launch: seen.launch, tag: seen.tag });
    assert.equal(seen.uploads.length, 0);
    assert.equal(result.errors[0].error, "no artist Instagram account");
  });

  it("uses the artist page for an artist-first-person ad", async () => {
    const fake = roundDb({
      ads: [
        { id: "ad-2", round_id: ROUND, user_id: USER, ad_name: "LUKEDEAN-clip01_cap-artist_first_person1", caption_id: "cap-2", render_id: "render-2", launch_state: "ready" },
      ],
    });
    fake.tables.creative_lab_artists[0].meta_page_id = "page_luke";
    fake.tables.creative_lab_artists[0].instagram_actor_id = "ig_luke";
    const seen = calls();
    fake.tables.launched_ads.push({
      launch_run_id: "run-1",
      ad_name: "LUKEDEAN-clip01_cap-artist_first_person1",
      meta_ad_id: "meta-2",
      meta_adset_id: ADSET,
      meta_campaign_id: "camp_1",
      ad_account_id: "act_1",
    });
    await launchApprovedRound(ROUND, { db: fake as unknown as ServiceRoleDb, userId: USER, upload: seen.upload, launch: seen.launch, tag: seen.tag });
    const body = buildLabLaunchBody(
      buildLabDraft(
        {
          roundId: ROUND,
          eventId: "evt-1",
          clientId: "client-1",
          campaignName: "Puzzle",
          adAccountId: "act_1",
          campaignId: "camp_1",
          campaignObjective: "OUTCOME_SALES",
          adSetId: ADSET,
          adSetName: ADSET,
          adSetStatus: "ACTIVE",
          destinationUrl: "https://tickets.example/puzzle",
          cta: "buy_tickets",
        },
        [
          {
            id: "ad-2",
            adName: "LUKEDEAN-clip01_cap-artist_first_person1",
            primaryText: "I play Circuit",
            videoId: "vid-hash-a",
            registryAssetId: "asset-1",
            pageId: "page_luke",
            instagramActorId: "ig_luke",
          },
        ],
      ),
    );
    assert.equal(body.createPaused, true);
    assert.equal(seen.uploads.length, 1);
    assert.equal(seen.uploads[0].aspectRatio, "9:16");
    assert.equal(seen.uploads[0].contentHash, "hash-a");
    assert.deepEqual(seen.launches[0].pages, ["page_luke"]);
    assert.deepEqual(seen.launches[0].ig, ["ig_luke"]);
    assert.equal(seen.launches[0].objective, "OUTCOME_LEADS");
    assert.equal(seen.launches[0].settingsObjective, "registration");
    assert.notEqual(seen.launches[0].objective, "OUTCOME_SALES");
  });
});

describe("paused launch is pinned", () => {
  it("createPaused true is one literal, and the Lab does not import an ACTIVE attach route", () => {
    const files = tree("lib/creative-lab").filter((path) => path.endsWith(".ts") && !path.includes("__tests__"));
    const lab = files.map((path) => source(path)).join("\n");
    const literals = lab.match(/createPaused:\s*true/g) ?? [];
    assert.equal(literals.length, 1);
    assert.doesNotMatch(lab, /bulk-attach-ads|create-creatives-and-ads|launch-campaign/);
    const route = source("app/api/creative-lab/rounds/[id]/launch/route.ts");
    assert.doesNotMatch(route, /bulk-attach-ads|create-creatives-and-ads/);
    assert.match(route, /labLaunchesEnabled\(\)/);
    assert.ok(route.indexOf("labLaunchesEnabled()") < route.indexOf("handleUploadAsset("));
    assert.ok(route.indexOf("labLaunchesEnabled()") < route.indexOf("metaLaunchPost("));
  });
});
