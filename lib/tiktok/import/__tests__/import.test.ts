import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { migrateTikTokDraft } from "../../../tiktok-wizard/migrate-draft.ts";
import { tiktokGet } from "../../client.ts";
import { collectTikTokLaunchPreflight } from "../../write/preflight.ts";

type TikTokGet = typeof tiktokGet;

function mockGet(
  impl: (path: string, params: Record<string, unknown>) => Promise<unknown>,
): TikTokGet {
  return (async (path, params) => impl(path, params)) as TikTokGet;
}
import {
  TIKTOK_ADGROUP_GET_ACCEPTED_FIELDS,
  TIKTOK_ADGROUP_GET_REJECTED_FIELDS,
} from "../__fixtures__/captured/adgroup-get-accepted-fields-2026-09-15.ts";
import {
  CREATIVE_LIBRARY_VIDEO_IDS,
  LEGACY_CAMPAIGN_GET,
  LEGACY_SPC_GET,
  MANUAL_AD_GET,
  MANUAL_ADGROUP_GET,
  MANUAL_CAMPAIGN_GET,
  UPGRADED_AD_GET_ALL,
  UPGRADED_ADGROUP_GET,
  UPGRADED_CAMPAIGN_GET,
  UPGRADED_SMART_PLUS_AD_GET,
} from "../__fixtures__/doc-derived-v1.3.ts";
import { TikTokImportEnvelopeError } from "../envelope.ts";
import {
  TikTokImportSourceError,
  buildTikTokImportPicker,
  finalizeTikTokImportDraft,
  mapTikTokLiveCampaignToDraft,
} from "../map.ts";
import {
  ADGROUP_GET_FIELDS,
  fetchTikTokAds,
  fetchTikTokSmartPlusAds,
  listTikTokLiveCampaigns,
  readTikTokLiveCampaign,
  type TikTokImportLiveBundle,
} from "../readers.ts";
import {
  formatTikTokImportJoinLine,
  formatTikTokImportRowOriginBadge,
  hydratePickerThumbnails,
} from "../picker.ts";
import { handleTikTokImportRaw } from "../raw.ts";
import { recordingTikTokGet } from "../record.ts";
import {
  TIKTOK_IMPORT_PATHS,
  TIKTOK_IMPORT_RELAUNCH_ENHANCEMENTS,
  classifyTikTokCampaign,
  enhancementsFromAds,
  formatTikTokImportCreativeCounts,
  formatTikTokImportDroppedLine,
  formatTikTokImportEnhancementLine,
} from "../types.ts";

const ACCOUNT = {
  tiktokAccountId: "acct-1",
  advertiserId: "7639802149165301776",
  currency: "GBP",
  timezone: "Europe/London",
};

const HERE = dirname(fileURLToPath(import.meta.url));

function libraryVideosFromIds(ids: readonly string[]) {
  return ids.map((video_id) => ({
    video_id,
    file_name: null,
    duration: null,
    width: null,
    height: null,
    video_cover_url: null,
  }));
}

function manualBundle(
  overrides: Partial<TikTokImportLiveBundle> = {},
): TikTokImportLiveBundle {
  const libraryVideoIds = overrides.libraryVideoIds ?? CREATIVE_LIBRARY_VIDEO_IDS;
  return {
    kind: "manual",
    campaign: MANUAL_CAMPAIGN_GET,
    adGroups: [MANUAL_ADGROUP_GET],
    ads: [MANUAL_AD_GET],
    smartPlusAds: [],
    spc: null,
    ...overrides,
    libraryVideoIds,
    libraryVideos: overrides.libraryVideos ?? libraryVideosFromIds(libraryVideoIds),
  };
}

function upgradedBundle(
  overrides: Partial<TikTokImportLiveBundle> = {},
): TikTokImportLiveBundle {
  const libraryVideoIds = overrides.libraryVideoIds ?? CREATIVE_LIBRARY_VIDEO_IDS;
  return {
    kind: "smart_plus",
    campaign: UPGRADED_CAMPAIGN_GET,
    adGroups: [UPGRADED_ADGROUP_GET],
    ads: UPGRADED_AD_GET_ALL,
    smartPlusAds: [UPGRADED_SMART_PLUS_AD_GET],
    spc: null,
    ...overrides,
    libraryVideoIds,
    libraryVideos: overrides.libraryVideos ?? libraryVideosFromIds(libraryVideoIds),
  };
}

describe("classifyTikTokCampaign", () => {
  it("reads the two /campaign/get/ flags", () => {
    assert.equal(
      classifyTikTokCampaign({
        campaign_automation_type: "MANUAL",
        is_smart_performance_campaign: false,
      }),
      "manual",
    );
    assert.equal(
      classifyTikTokCampaign({
        campaign_automation_type: "UPGRADED_SMART_PLUS",
        is_smart_performance_campaign: false,
      }),
      "smart_plus",
    );
    assert.equal(
      classifyTikTokCampaign({
        campaign_automation_type: "SMART_PLUS",
        is_smart_performance_campaign: true,
      }),
      "legacy_smart_plus",
    );
    assert.equal(
      classifyTikTokCampaign({ is_smart_performance_campaign: true }),
      "legacy_smart_plus",
    );
  });
});

/* -------------------------------------------------------------------- *
 * B — the field name that made every manual import throw
 * ------------------------------------------------------------------- */

describe("ADGROUP_GET_FIELDS against the captured accepted list", () => {
  it("does not send connection_type", () => {
    assert.equal(ADGROUP_GET_FIELDS.includes("connection_type"), false);
  });

  it("sends nothing TikTok rejected live", () => {
    for (const field of TIKTOK_ADGROUP_GET_REJECTED_FIELDS) {
      assert.equal(
        (ADGROUP_GET_FIELDS as readonly string[]).includes(field),
        false,
        `${field} was rejected live at fields.32`,
      );
    }
  });

  it("is a subset of the captured 152-name accepted list", () => {
    assert.equal(TIKTOK_ADGROUP_GET_ACCEPTED_FIELDS.length, 152);
    const accepted = new Set(TIKTOK_ADGROUP_GET_ACCEPTED_FIELDS);
    for (const field of ADGROUP_GET_FIELDS) {
      assert.ok(accepted.has(field), `${field} is not in the captured accepted list`);
    }
    assert.equal(ADGROUP_GET_FIELDS.length, 35);
  });

  it("has a header saying the accepted list is a complete capture, and PENDING_CAPTURE is gone", () => {
    const fixture = readFileSync(
      join(HERE, "../__fixtures__/captured/adgroup-get-accepted-fields-2026-09-15.ts"),
      "utf8",
    );
    assert.match(fixture, /CAPTURED 2026-09-15/);
    assert.match(fixture, /advertiser 7639802149165301776/);
    assert.match(fixture, /complete \(152\)/);
    assert.equal(fixture.includes("PENDING_CAPTURE"), false);
    assert.equal(fixture.includes("PARTIAL"), false);
  });
});

/* -------------------------------------------------------------------- *
 * Manual
 * ------------------------------------------------------------------- */

describe("map manual campaign", () => {
  it("keeps targeting, budget, pixel, identity, video_id and lists uncarriable fields", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      manualBundle(),
      "draft-manual",
      ACCOUNT,
    );
    assert.equal(mapped.campaignSetup.objective, "LEAD_GENERATION");
    assert.equal(mapped.campaignSetup.optimisationGoal, "CONVERSION");
    assert.equal(mapped.campaignSetup.bidStrategy, "LOWEST_COST");
    assert.equal(mapped.accountSetup.pixelId, "7644201699552690194");
    assert.equal(mapped.accountSetup.optimisationEvent, "ON_WEB_REGISTER");
    assert.equal(mapped.accountSetup.identityId, "identity-ironworks");
    assert.equal(mapped.accountSetup.identityType, "BC_AUTH_TT");
    assert.equal(mapped.accountSetup.currency, "GBP");
    assert.equal(mapped.accountSetup.timezone, "Europe/London");
    assert.deepEqual(mapped.audiences.locationCodes, ["GB"]);
    assert.equal(mapped.audiences.ageMin, 18);
    assert.equal(mapped.audiences.ageMax, 34);
    assert.deepEqual(mapped.audiences.customAudienceIds, ["aud-1"]);
    assert.deepEqual(mapped.audiences.lookalikeAudienceIds, []);
    assert.equal(mapped.optimisation.pacing, "STANDARD");
    assert.equal(mapped.budgetSchedule.budgetAmount, 80);
    assert.equal(mapped.budgetSchedule.adGroups[0]?.budget, 80);
    assert.equal(mapped.creatives.items[0]?.videoId, "v901");
    assert.equal(mapped.creatives.items[0]?.mode, "VIDEO_REFERENCE");
    assert.equal(mapped.creatives.items[0]?.id, "manual-ad-1");
    const dropped = mapped.importMeta?.dropped ?? [];
    const fields = dropped.map((item) => item.field);
    assert.ok(fields.includes("excluded_audience_ids"));
    assert.deepEqual(
      dropped.find((item) => item.field === "excluded_audience_ids")?.sourceValue,
      ["ticketholder-1"],
    );
    assert.ok(fields.includes("saved_audience_id"));
    assert.ok(fields.includes("placements"));
    assert.equal(mapped.optimisation.smartPlusEnabled, false);
    assert.notEqual(mapped.optimisation.bidStrategy, "SMART_PLUS");
    assert.match(
      formatTikTokImportDroppedLine(dropped) ?? "",
      /excluded audiences \(ticketholder-1\)/,
    );
  });

  it("does not invent a display name from the ad name", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      manualBundle(),
      "draft-display",
      ACCOUNT,
    );
    assert.equal(mapped.creatives.items[0]?.displayName, "");
    assert.ok(
      (mapped.importMeta?.dropped ?? []).some((item) => item.field === "display_name"),
    );
  });

  it("reports an image-only /ad/get/ row as image_ad_unsupported, not no_asset_reported", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      manualBundle({
        ads: [
          MANUAL_AD_GET,
          {
            ad_id: "manual-image-1",
            ad_name: "Still frame",
            image_ids: ["img-still-1", "img-still-2"],
          },
        ],
      }),
      "draft-image",
      ACCOUNT,
    );
    const entry = (mapped.importMeta?.notCarried ?? []).find(
      (item) => item.adId === "manual-image-1",
    );
    assert.equal(entry?.reason, "image_ad_unsupported");
    assert.equal(
      mapped.importMeta?.notCarried.some((item) => item.reason === "no_asset_reported"),
      false,
    );
    assert.match(
      formatTikTokImportCreativeCounts(
        mapped.importMeta!.creativeCounts!,
        mapped.importMeta!.notCarried,
      ),
      /image ad/,
    );
  });

  it("lists an all-image campaign as image_ad_unsupported and saves nothing by default", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      manualBundle({
        ads: [
          {
            ad_id: "manual-image-1",
            ad_name: "Still frame",
            image_ids: ["img-still-1"],
          },
        ],
      }),
      "draft-all-image",
      ACCOUNT,
    );
    assert.equal(mapped.creatives.items.length, 0);
    assert.equal(mapped.importMeta?.notCarried[0]?.reason, "image_ad_unsupported");
  });

  it("refuses a multi-ad-group source campaign rather than losing groups 2..n", () => {
    assert.throws(
      () =>
        mapTikTokLiveCampaignToDraft(
          manualBundle({
            adGroups: [MANUAL_ADGROUP_GET, { ...MANUAL_ADGROUP_GET, adgroup_id: "two" }],
          }),
          "draft-two-groups",
          ACCOUNT,
        ),
      (err: unknown) =>
        err instanceof TikTokImportSourceError && /2 ad groups/.test(err.message),
    );
  });
});

/* -------------------------------------------------------------------- *
 * The silent-plausible class: a default is a claim
 * ------------------------------------------------------------------- */

describe("targeting that cannot be mapped is never defaulted", () => {
  it("throws on an unmappable age_groups value instead of claiming 18-65", () => {
    assert.throws(
      () =>
        mapTikTokLiveCampaignToDraft(
          manualBundle({
            adGroups: [{ ...MANUAL_ADGROUP_GET, age_groups: ["AGE_NOT_A_BUCKET"] }],
          }),
          "draft-bad-age",
          ACCOUNT,
        ),
      (err: unknown) =>
        err instanceof TikTokImportSourceError && /age_groups/.test(err.message),
    );
  });

  it("throws on empty location_ids instead of claiming no location targeting", () => {
    assert.throws(
      () =>
        mapTikTokLiveCampaignToDraft(
          manualBundle({ adGroups: [{ ...MANUAL_ADGROUP_GET, location_ids: [] }] }),
          "draft-no-location",
          ACCOUNT,
        ),
      (err: unknown) =>
        err instanceof TikTokImportSourceError && /location_ids/.test(err.message),
    );
  });

  it("leaves age at the draft default only when the source reported no age_groups", () => {
    const { age_groups: _omit, ...group } = MANUAL_ADGROUP_GET;
    const mapped = mapTikTokLiveCampaignToDraft(
      manualBundle({ adGroups: [group] }),
      "draft-no-age",
      ACCOUNT,
    );
    assert.equal(mapped.audiences.ageMin, 18);
    assert.equal(mapped.audiences.ageMax, 65);
  });

  it("does not borrow an identity from a neighbouring creative", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      manualBundle({
        ads: [
          MANUAL_AD_GET,
          {
            ...MANUAL_AD_GET,
            ad_id: "manual-ad-2",
            ad_name: "Other clip",
            video_id: "v-library-1",
            identity_id: "identity-other",
          },
        ],
      }),
      "draft-identity-conflict",
      ACCOUNT,
    );
    assert.equal(mapped.accountSetup.identityId, null);
    assert.ok(
      (mapped.importMeta?.dropped ?? []).some(
        (item) => item.field === "identity_conflict",
      ),
    );
    assert.equal(mapped.creatives.items[0]?.identityId, "identity-ironworks");
    assert.equal(mapped.creatives.items[1]?.identityId, "identity-other");
  });
});

/* -------------------------------------------------------------------- *
 * E — the documented /smart_plus/ad/get/ walk
 * ------------------------------------------------------------------- */

describe("map upgraded Smart+ from the documented creative_list shape", () => {
  it("reads id, video_id, name and identity through creative_info", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      upgradedBundle(),
      "draft-upgraded",
      ACCOUNT,
    );
    const first = mapped.creatives.items[0]!;
    assert.equal(first.id, "chosen-1");
    assert.equal(first.videoId, "v-library-1");
    assert.equal(first.name, "80% - JJ New 1_vaES07ge.mp4");
    assert.equal(first.coverImageId, "img-1");
    assert.equal(first.identityId, "identity-ironworks");
    assert.equal(first.identityType, "BC_AUTH_TT");
    assert.equal(first.musicId, "music-1");
    assert.equal(mapped.campaignSetup.objective, "CONVERSIONS");
    assert.equal(mapped.campaignSetup.salesDestination, "WEBSITE");
    assert.deepEqual(mapped.audiences.locationCodes, ["2648110"]);
    assert.equal(mapped.audiences.ageMin, 18);
    assert.equal(mapped.audiences.ageMax, 54);
    assert.equal(mapped.optimisation.smartPlusEnabled, false);
    assert.notEqual(mapped.campaignSetup.bidStrategy, "SMART_PLUS");
  });

  it("carries ad_text_list[0] and lists the rest, rather than copying one text onto every creative", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      upgradedBundle(),
      "draft-text",
      ACCOUNT,
    );
    assert.equal(mapped.creatives.items[0]?.adText, "Tickets on sale");
    const extra = (mapped.importMeta?.dropped ?? []).find(
      (item) => item.field === "ad_text_list",
    );
    assert.deepEqual(extra?.sourceValue, ["Final release"]);
  });

  it("puts a CAROUSEL_ADS row in dropped[] and notCarried[], never in creatives.items", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      upgradedBundle(),
      "draft-carousel",
      ACCOUNT,
    );
    assert.equal(
      mapped.creatives.items.some((item) => item.id === "chosen-carousel"),
      false,
    );
    assert.ok(
      (mapped.importMeta?.dropped ?? []).some(
        (item) => item.field === "unsupported_ad_format",
      ),
    );
    const entry = (mapped.importMeta?.notCarried ?? []).find(
      (item) => item.adId === "chosen-carousel",
    );
    assert.equal(entry?.reason, "unsupported_ad_format");
    assert.equal(entry?.adFormat, "CAROUSEL_ADS");
    assert.equal(
      "ad_format" in UPGRADED_AD_GET_ALL.find((row) => row.ad_id === "chosen-carousel")!,
      false,
      "AD_GET_FIELDS does not request ad_format; the fixture must not carry it",
    );
  });

  it("keys unnamed creatives on smart_plus_ad_id so same-named asset groups do not collapse", () => {
    const unnamed = (id: string, videoId: string) => ({
      smart_plus_creative_id: id,
      creative_info: {
        ad_format: "SINGLE_VIDEO",
        video_info: { video_id: videoId },
      },
    });
    const mapped = mapTikTokLiveCampaignToDraft(
      upgradedBundle({
        libraryVideoIds: ["v-library-1", "v-library-2"],
        smartPlusAds: [
          {
            smart_plus_ad_id: "group-a",
            ad_name: "80% Sold",
            creative_list: [unnamed("a-1", "v-library-1")],
          },
          {
            smart_plus_ad_id: "group-b",
            ad_name: "80% Sold",
            creative_list: [unnamed("b-1", "v-library-2")],
          },
        ],
        ads: [],
      }),
      "draft-same-name",
      ACCOUNT,
    );
    const names = mapped.creatives.items.map((item) => item.name);
    assert.deepEqual(names, ["group-a 1", "group-b 1"]);
    assert.equal(mapped.creatives.items.length, 2);
  });

  it("joins on smart_plus_creative_id === /ad/get/ ad_id", () => {
    const bundle = upgradedBundle();
    const picker = buildTikTokImportPicker(bundle);
    // Doc-derived leftover: two /ad/get/ rows (auto-*) match no creative_list.
    assert.equal(picker.chosenJoined, 5);
    assert.equal(picker.chosenTotal, 5);
    assert.equal(picker.unjoined, 2);
    assert.equal(
      formatTikTokImportJoinLine(picker.chosenJoined, picker.chosenTotal),
      null,
    );
    const mapped = mapTikTokLiveCampaignToDraft(bundle, "draft-join", ACCOUNT);
    assert.equal(mapped.importMeta?.creativeCounts?.sourceRows, 7);
    const notCarriedIds = (mapped.importMeta?.notCarried ?? []).map((item) => item.adId);
    assert.ok(notCarriedIds.includes("chosen-carousel"));
    assert.ok(notCarriedIds.includes("auto-ai-video"));
  });

  it("counts unmatched /ad/get/ rows when 1 of 45 creative_list rows joins — doc-derived", () => {
    const ads = Array.from({ length: 45 }, (_, index) => ({
      ad_id: `partial-ad-${index + 1}`,
      ad_name: `Partial clip ${index + 1}`,
      campaign_id: "upgraded-campaign-1",
      adgroup_id: "upgraded-adgroup-1",
      video_id: `v-partial-${index + 1}`,
      campaign_automation_type: "UPGRADED_SMART_PLUS",
    }));
    const creative_list = ads.map((ad, index) => ({
      smart_plus_creative_id:
        index === 0 ? ad.ad_id : `unmatched-${ad.ad_id}`,
      ad_material_id: `material-partial-${index + 1}`,
      creative_info: {
        ad_format: "SINGLE_VIDEO",
        material_name: ad.ad_name,
        video_info: {
          video_id: index === 0 ? ad.video_id : `v-chosen-only-${index + 1}`,
        },
      },
    }));
    const bundle = upgradedBundle({
      smartPlusAds: [{ ...UPGRADED_SMART_PLUS_AD_GET, creative_list }],
      ads,
    });
    const picker = buildTikTokImportPicker(bundle);
    assert.equal(picker.chosenJoined, 1);
    assert.equal(picker.chosenTotal, 45);
    assert.equal(picker.unjoined, 44);
    assert.equal(
      formatTikTokImportJoinLine(picker.chosenJoined, picker.chosenTotal),
      "1 of 45 creatives TikTok says you selected matched a source ad",
    );
    assert.equal(picker.rows.length, 45);
    const badged = picker.rows.filter(
      (row) => formatTikTokImportRowOriginBadge(row.origin) !== null,
    );
    const unbadged = picker.rows.filter(
      (row) => formatTikTokImportRowOriginBadge(row.origin) === null,
    );
    assert.equal(badged.length, 44);
    assert.equal(unbadged.length, 1);
    assert.ok(
      picker.rows.every((row) => row.defaultTicked && !row.disabled),
    );
    for (const row of badged) {
      assert.equal(row.origin, "unjoined");
      assert.equal(
        formatTikTokImportRowOriginBadge(row.origin),
        "TikTok couldn't confirm you selected this",
      );
    }
  });

  it("badges a stem group when one of two copies is unjoined — doc-derived", () => {
    const ads = [
      {
        ad_id: "partial-ad-1",
        ad_name: "Shared stem chosen",
        campaign_id: "upgraded-campaign-1",
        adgroup_id: "upgraded-adgroup-1",
        video_id: "v-stem-chosen",
        campaign_automation_type: "UPGRADED_SMART_PLUS",
      },
      {
        ad_id: "partial-ad-2",
        ad_name: "Shared stem leftover",
        campaign_id: "upgraded-campaign-1",
        adgroup_id: "upgraded-adgroup-1",
        video_id: "v-stem-unjoined",
        campaign_automation_type: "UPGRADED_SMART_PLUS",
      },
    ];
    const bundle = upgradedBundle({
      smartPlusAds: [
        {
          ...UPGRADED_SMART_PLUS_AD_GET,
          creative_list: [
            {
              smart_plus_creative_id: "partial-ad-1",
              ad_material_id: "material-stem-1",
              creative_info: {
                ad_format: "SINGLE_VIDEO",
                material_name: "Shared stem",
                video_info: { video_id: "v-stem-chosen" },
              },
            },
          ],
        },
      ],
      ads,
      libraryVideoIds: ["v-stem-chosen", "v-stem-unjoined"],
      libraryVideos: [
        {
          video_id: "v-stem-chosen",
          file_name: "shared-stem.mp4",
          duration: null,
          width: null,
          height: null,
          video_cover_url: null,
        },
        {
          video_id: "v-stem-unjoined",
          file_name: "shared-stem.mp4",
          duration: null,
          width: null,
          height: null,
          video_cover_url: null,
        },
      ],
    });
    const picker = buildTikTokImportPicker(bundle);
    assert.equal(picker.chosenJoined, 1);
    assert.equal(picker.chosenTotal, 1);
    assert.equal(picker.unjoined, 1);
    const row = picker.rows.find((item) => item.copies === 2);
    assert.ok(row);
    assert.equal(row?.origin, "unjoined");
    assert.equal(
      formatTikTokImportRowOriginBadge(row!.origin),
      "TikTok couldn't confirm you selected this",
    );
  });

  it("throws when every creative_list is empty — doc-derived", () => {
    assert.throws(
      () =>
        mapTikTokLiveCampaignToDraft(
          upgradedBundle({
            smartPlusAds: [
              { ...UPGRADED_SMART_PLUS_AD_GET, creative_list: [] },
            ],
          }),
          "draft-empty-list",
          ACCOUNT,
        ),
      (err: unknown) =>
        err instanceof TikTokImportSourceError &&
        err.message.includes("upgraded-campaign-1") &&
        err.message.includes("0 creatives") &&
        err.message.includes(`${UPGRADED_AD_GET_ALL.length} /ad/get/ rows`),
    );
  });

  it("counts two ads that share a Spark id as 2 copies — doc-derived", () => {
    const sparkId = "7684280114589548562";
    const bundle = upgradedBundle({
      smartPlusAds: [
        {
          ...UPGRADED_SMART_PLUS_AD_GET,
          creative_list: [
            {
              smart_plus_creative_id: "chosen-spark-a",
              creative_info: {
                ad_format: "SINGLE_VIDEO",
                material_name: "Shared spark",
                tiktok_item_id: sparkId,
              },
            },
            {
              smart_plus_creative_id: "chosen-spark-b",
              creative_info: {
                ad_format: "SINGLE_VIDEO",
                material_name: "Shared spark",
                tiktok_item_id: sparkId,
              },
            },
          ],
        },
      ],
      ads: [
        {
          ad_id: "chosen-spark-a",
          ad_name: "Shared spark A",
          tiktok_item_id: sparkId,
        },
        {
          ad_id: "chosen-spark-b",
          ad_name: "Shared spark B",
          tiktok_item_id: sparkId,
        },
      ],
    });
    const picker = buildTikTokImportPicker(bundle);
    const spark = picker.rows.find((row) => row.kind === "spark");
    assert.equal(spark?.key, sparkId);
    assert.equal(spark?.copies, 2);
  });

  it("reports every /ad/get/ row as unjoined when the join key matches nothing", () => {
    const broken = {
      ...UPGRADED_SMART_PLUS_AD_GET,
      creative_list: UPGRADED_SMART_PLUS_AD_GET.creative_list.map((creative) => ({
        ...creative,
        smart_plus_creative_id: `not-an-ad-id-${creative.ad_material_id}`,
        creative_info: {
          ...creative.creative_info,
          video_info: undefined,
          tiktok_item_id: undefined,
        },
      })),
    };
    const bundle = upgradedBundle({ smartPlusAds: [broken] });
    const picker = buildTikTokImportPicker(bundle);
    assert.equal(picker.unjoined, UPGRADED_AD_GET_ALL.length);
    assert.equal(picker.chosenJoined, 0);
    assert.equal(picker.chosenTotal, UPGRADED_SMART_PLUS_AD_GET.creative_list.length);
    assert.equal(
      formatTikTokImportJoinLine(picker.chosenJoined, picker.chosenTotal),
      `0 of ${UPGRADED_SMART_PLUS_AD_GET.creative_list.length} creatives TikTok says you selected matched a source ad`,
    );
    assert.doesNotThrow(() =>
      mapTikTokLiveCampaignToDraft(bundle, "draft-unjoined", ACCOUNT),
    );
  });

  it("throws when creative_list is missing", () => {
    assert.throws(
      () =>
        mapTikTokLiveCampaignToDraft(
          upgradedBundle({
            smartPlusAds: [{ smart_plus_ad_id: "missing-list", ad_name: "No list" }],
          }),
          "draft-no-list",
          ACCOUNT,
        ),
      (err: unknown) =>
        err instanceof TikTokImportEnvelopeError &&
        err.message.includes("creative_list"),
    );
  });

  it("throws when a creative row has no creative_info", () => {
    assert.throws(
      () =>
        mapTikTokLiveCampaignToDraft(
          upgradedBundle({
            smartPlusAds: [
              {
                ...UPGRADED_SMART_PLUS_AD_GET,
                creative_list: [{ smart_plus_creative_id: "chosen-1" }],
              },
            ],
          }),
          "draft-no-info",
          ACCOUNT,
        ),
      (err: unknown) =>
        err instanceof TikTokImportEnvelopeError &&
        err.message.includes("creative_info"),
    );
  });

  it("throws when upgraded targeting_spec is missing", () => {
    const { targeting_spec: _omit, ...flat } = UPGRADED_ADGROUP_GET;
    assert.throws(
      () =>
        mapTikTokLiveCampaignToDraft(
          upgradedBundle({ adGroups: [flat] }),
          "draft-no-spec",
          ACCOUNT,
        ),
      (err: unknown) =>
        err instanceof TikTokImportEnvelopeError &&
        err.message.includes("targeting_spec"),
    );
  });
});

/* -------------------------------------------------------------------- *
 * Picker edges that the captures do not cover (hollow / image / empty)
 * ------------------------------------------------------------------- */

describe("picker lists unsupported rows and does not throw on hollow", () => {
  it("reports a row TikTok gave no asset for, and maps an all-hollow campaign to zero creatives", () => {
    const hollow = Array.from({ length: 3 }, (_, i) => ({
      ad_id: `hollow-${i}`,
      ad_name: "80% Sold",
    }));
    const mapped = mapTikTokLiveCampaignToDraft(
      upgradedBundle({ ads: [...UPGRADED_AD_GET_ALL, ...hollow] }),
      "draft-hollow-some",
      ACCOUNT,
    );
    assert.equal(
      (mapped.importMeta?.notCarried ?? []).filter(
        (item) => item.reason === "no_asset_reported",
      ).length,
      3,
    );

    const empty = mapTikTokLiveCampaignToDraft(
      upgradedBundle({
        smartPlusAds: [
          {
            ...UPGRADED_SMART_PLUS_AD_GET,
            creative_list: [
              { smart_plus_creative_id: "c1", creative_info: { material_name: "80% Sold" } },
            ],
          },
        ],
        ads: hollow,
      }),
      "draft-hollow-all",
      ACCOUNT,
    );
    assert.equal(empty.creatives.items.length, 0);
    assert.ok(
      (empty.importMeta?.notCarried ?? []).every(
        (item) => item.reason === "no_asset_reported",
      ),
    );
  });
});

/* -------------------------------------------------------------------- *
 * D — absent is not false
 * ------------------------------------------------------------------- */

describe("enhancement counts", () => {
  it("counts absent separately from present-false", () => {
    const absent = enhancementsFromAds(
      Array.from({ length: 45 }, (_, i) => ({ ad_id: `a${i}` })),
    );
    assert.equal(absent.isAcoAbsent, 45);
    assert.equal(absent.isAcoOn, 0);
    assert.equal(absent.isAcoOff, 0);
    assert.match(
      formatTikTokImportEnhancementLine({
        sourceKind: "smart_plus",
        sourceEnhancements: absent,
      }),
      /is_aco not reported on 45 of 45 source ads/,
    );

    const present = enhancementsFromAds([
      { is_aco: true, creative_authorized: true },
      { is_aco: false, creative_authorized: false },
      { is_aco: false, creative_authorized: false },
    ]);
    assert.equal(present.isAcoOn, 1);
    assert.equal(present.isAcoOff, 2);
    assert.equal(present.isAcoAbsent, 0);
    assert.match(
      formatTikTokImportEnhancementLine({
        sourceKind: "smart_plus",
        sourceEnhancements: present,
      }),
      /enhancements ON \(is_aco true on 1 of 3\)/,
    );
  });

  it("renders the live Ironworks case as not reported, not as 0 of 45", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      upgradedBundle(),
      "draft-absent",
      ACCOUNT,
    );
    const line = formatTikTokImportEnhancementLine(mapped.importMeta!);
    assert.match(line, /not reported/);
    assert.equal(line.includes("true on 0 of"), false);
  });
});

/* -------------------------------------------------------------------- *
 * Legacy
 * ------------------------------------------------------------------- */

describe("map legacy Smart+", () => {
  it("reads the single /campaign/spc/get/ object", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      {
        kind: "legacy_smart_plus",
        campaign: LEGACY_CAMPAIGN_GET,
        adGroups: [],
        ads: [],
        smartPlusAds: [],
        spc: LEGACY_SPC_GET,
        libraryVideoIds: CREATIVE_LIBRARY_VIDEO_IDS,
        libraryVideos: libraryVideosFromIds(CREATIVE_LIBRARY_VIDEO_IDS),
      },
      "draft-legacy",
      ACCOUNT,
    );
    assert.equal(mapped.campaignSetup.objective, "TRAFFIC");
    assert.equal(mapped.campaignSetup.optimisationGoal, "CLICK");
    assert.equal(mapped.creatives.items[0]?.videoId, "v-library-1");
    assert.equal(mapped.creatives.items[1]?.videoId, "v-library-2");
    assert.equal(mapped.creatives.items[0]?.title, "Legacy title one");
    const dropped = (mapped.importMeta?.dropped ?? []).map((item) => item.field);
    assert.ok(dropped.includes("spc_audience_age"));
    assert.ok(dropped.includes("smart_audience_enabled"));
    assert.equal(mapped.optimisation.smartPlusEnabled, false);
    assert.equal(
      formatTikTokImportEnhancementLine(mapped.importMeta!),
      "Source: Legacy Smart+ — fully automated creative and targeting. Relaunch: OFF.",
    );
    assert.equal(
      formatTikTokImportEnhancementLine(mapped.importMeta!).includes("0 of 0"),
      false,
    );
  });
});

/* -------------------------------------------------------------------- *
 * Relaunch shape + preflight
 * ------------------------------------------------------------------- */

describe("finalizeTikTokImportDraft", () => {
  it("goes through duplicateTikTokDraftState: empty publishedIds, relaunch name, healed schedule", () => {
    const mapped = mapTikTokLiveCampaignToDraft(manualBundle(), "mapped", ACCOUNT);
    mapped.publishedIds = {
      campaignId: "do-not-keep",
      adgroupIds: ["x"],
      adIds: ["y"],
      launchedAt: "2026-01-01T00:00:00.000Z",
    };
    const now = new Date("2026-09-14T12:00:00.000Z");
    const copy = finalizeTikTokImportDraft(mapped, "copy-1", [], now);
    assert.equal(copy.id, "copy-1");
    assert.equal(copy.publishedIds, null);
    assert.equal(copy.campaignSetup.campaignName, "[IRW] Manual fixture — relaunch");
    assert.equal(copy.optimisation.smartPlusEnabled, false);
    assert.ok(copy.importMeta);
    assert.equal(copy.status, "draft");
    assert.notEqual(
      copy.budgetSchedule.scheduleStartAt,
      MANUAL_ADGROUP_GET.schedule_start_time,
    );
  });

  it("keeps importMeta through migrateTikTokDraft", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      upgradedBundle(),
      "mapped-up",
      ACCOUNT,
    );
    const copy = finalizeTikTokImportDraft(mapped, "copy-up");
    const migrated = migrateTikTokDraft(JSON.parse(JSON.stringify(copy)));
    assert.equal(migrated.importMeta?.sourceKind, "smart_plus");
    assert.ok((migrated.importMeta?.dropped.length ?? 0) > 0);
    assert.ok((migrated.importMeta?.notCarried.length ?? 0) >= 1);
  });

  it("produces no creative preflight blames every creative for a missing asset", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      upgradedBundle(),
      "mapped-preflight",
      ACCOUNT,
    );
    const copy = finalizeTikTokImportDraft(mapped, "copy-preflight");
    copy.eventId = "00000000-0000-0000-0000-000000000002";
    copy.accountSetup.timezone = "Europe/London";
    copy.accountSetup.currency = "GBP";
    const { issues } = collectTikTokLaunchPreflight(copy, {
      now: new Date("2026-09-14T12:00:00.000Z"),
    });
    assert.equal(
      issues.some(
        (issue) => issue.id === "smart-plus" || issue.id === "smart-plus-bid",
      ),
      false,
    );
    assert.equal(
      issues.some((issue) => issue.field === "video_id"),
      false,
      "#944 shipped 45 creatives that each failed this check",
    );
  });
});

/* -------------------------------------------------------------------- *
 * Readers
 * ------------------------------------------------------------------- */

describe("readers", () => {
  it("lists campaigns from /campaign/get/ with the two flags", async () => {
    const calls: Array<{ path: string; params: Record<string, unknown> }> = [];
    const rows = await listTikTokLiveCampaigns({
      advertiserId: ACCOUNT.advertiserId,
      token: "token",
      request: mockGet(async (path, params) => {
        calls.push({ path, params });
        assert.equal(path, "/campaign/get/");
        return {
          list: [MANUAL_CAMPAIGN_GET, UPGRADED_CAMPAIGN_GET, LEGACY_CAMPAIGN_GET],
          page_info: { page: 1, total_page: 1 },
        };
      }),
    });
    assert.deepEqual(
      rows.map((row) => row.kind),
      ["manual", "smart_plus", "legacy_smart_plus"],
    );
    assert.ok(
      (calls[0]?.params.fields as string[]).includes("campaign_automation_type"),
    );
    assert.ok(
      (calls[0]?.params.fields as string[]).includes("is_smart_performance_campaign"),
    );
  });

  it("never sends ad_ids_v2 and pages /smart_plus/ad/get/ at 100", async () => {
    const calls: Array<{ path: string; params: Record<string, unknown> }> = [];
    await fetchTikTokSmartPlusAds({
      advertiserId: ACCOUNT.advertiserId,
      campaignId: "upgraded-campaign-1",
      token: "token",
      request: mockGet(async (path, params) => {
        calls.push({ path, params });
        return { list: [], page_info: { page: 1, total_page: 1 } };
      }),
    });
    assert.equal(calls[0]?.path, "/smart_plus/ad/get/");
    assert.equal(calls[0]?.params.page_size, 100);
    assert.equal("ad_ids_v2" in (calls[0]?.params ?? {}), false);
    await fetchTikTokAds({
      advertiserId: ACCOUNT.advertiserId,
      campaignId: "upgraded-campaign-1",
      token: "token",
      filtering: { campaign_automation_type: "UPGRADED_SMART_PLUS" },
      request: mockGet(async (path, params) => {
        calls.push({ path, params });
        return { list: [], page_info: { page: 1, total_page: 1 } };
      }),
    });
    const adGet = calls.find((call) => call.path === "/ad/get/");
    assert.ok(adGet);
    assert.equal("ad_ids_v2" in adGet.params, false);
    assert.equal(
      (adGet.params.filtering as { campaign_automation_type?: string })
        .campaign_automation_type,
      "UPGRADED_SMART_PLUS",
    );
  });

  it("reads the Creative Library on every import and routes onto allowed paths only", async () => {
    const seen: string[] = [];
    const request = mockGet(async (path) => {
      seen.push(path);
      if (path === "/campaign/get/") {
        return {
          list: [UPGRADED_CAMPAIGN_GET],
          page_info: { page: 1, total_page: 1 },
        };
      }
      if (path === "/smart_plus/adgroup/get/") {
        return {
          list: [UPGRADED_ADGROUP_GET],
          page_info: { page: 1, total_page: 1 },
        };
      }
      if (path === "/smart_plus/ad/get/") {
        return {
          list: [UPGRADED_SMART_PLUS_AD_GET],
          page_info: { page: 1, total_page: 1 },
        };
      }
      if (path === "/ad/get/") {
        return { list: UPGRADED_AD_GET_ALL, page_info: { page: 1, total_page: 1 } };
      }
      if (path === "/file/video/ad/search/") {
        return {
          list: CREATIVE_LIBRARY_VIDEO_IDS.map((video_id) => ({ video_id })),
          page_info: { page: 1, page_size: 100, total_number: 3, total_page: 1 },
        };
      }
      return { list: [], page_info: { page: 1, total_page: 1 } };
    });
    const bundle = await readTikTokLiveCampaign({
      advertiserId: ACCOUNT.advertiserId,
      campaignId: "upgraded-campaign-1",
      token: "token",
      request,
    });
    for (const path of seen) {
      assert.ok(
        (TIKTOK_IMPORT_PATHS as readonly string[]).includes(path),
        `unexpected path ${path}`,
      );
    }
    assert.ok(seen.includes("/smart_plus/adgroup/get/"));
    assert.ok(seen.includes("/smart_plus/ad/get/"));
    assert.ok(seen.includes("/ad/get/"));
    assert.ok(seen.includes("/file/video/ad/search/"));
    assert.deepEqual([...bundle.libraryVideoIds], CREATIVE_LIBRARY_VIDEO_IDS);
  });

  it("throws when the Creative Library read fails", async () => {
    await assert.rejects(
      () =>
        readTikTokLiveCampaign({
          advertiserId: ACCOUNT.advertiserId,
          campaignId: "manual-campaign-1",
          token: "token",
          request: mockGet(async (path) => {
            if (path === "/file/video/ad/search/") {
              throw new Error("Access denied for /file/video/ad/search/");
            }
            if (path === "/campaign/get/") {
              return {
                list: [MANUAL_CAMPAIGN_GET],
                page_info: { page: 1, total_page: 1 },
              };
            }
            if (path === "/adgroup/get/") {
              return {
                list: [MANUAL_ADGROUP_GET],
                page_info: { page: 1, total_page: 1 },
              };
            }
            return { list: [MANUAL_AD_GET], page_info: { page: 1, total_page: 1 } };
          }),
        }),
      /Access denied for \/file\/video\/ad\/search\//,
    );
  });

  it("throws when the Creative Library page has no page_info — a missing total is a partial library", async () => {
    await assert.rejects(
      () =>
        readTikTokLiveCampaign({
          advertiserId: ACCOUNT.advertiserId,
          campaignId: "manual-campaign-1",
          token: "token",
          request: mockGet(async (path) => {
            if (path === "/campaign/get/") {
              return {
                list: [MANUAL_CAMPAIGN_GET],
                page_info: { page: 1, total_page: 1 },
              };
            }
            if (path === "/adgroup/get/") {
              return {
                list: [MANUAL_ADGROUP_GET],
                page_info: { page: 1, total_page: 1 },
              };
            }
            if (path === "/file/video/ad/search/") {
              return { list: [{ video_id: "v901" }] };
            }
            return { list: [MANUAL_AD_GET], page_info: { page: 1, total_page: 1 } };
          }),
        }),
      /returned no page_info/,
    );
  });

  it("does not throw when the Creative Library is empty — membership is not a carry rule", async () => {
    const bundle = await readTikTokLiveCampaign({
      advertiserId: ACCOUNT.advertiserId,
      campaignId: "manual-campaign-1",
      token: "token",
      request: mockGet(async (path) => {
        if (path === "/campaign/get/") {
          return {
            list: [MANUAL_CAMPAIGN_GET],
            page_info: { page: 1, total_page: 1 },
          };
        }
        if (path === "/adgroup/get/") {
          return {
            list: [MANUAL_ADGROUP_GET],
            page_info: { page: 1, total_page: 1 },
          };
        }
        if (path === "/file/video/ad/search/") {
          return {
            list: [],
            page_info: { page: 1, page_size: 100, total_number: 0, total_page: 0 },
          };
        }
        return { list: [MANUAL_AD_GET], page_info: { page: 1, total_page: 1 } };
      }),
    });
    assert.deepEqual([...bundle.libraryVideoIds], []);
    assert.deepEqual([...bundle.libraryVideos], []);
  });

  it("throws when the source campaign has no ad groups — the empty-shell class", async () => {
    await assert.rejects(
      () =>
        readTikTokLiveCampaign({
          advertiserId: ACCOUNT.advertiserId,
          campaignId: "1874233177915634",
          token: "token",
          request: mockGet(async (path) => {
            if (path === "/campaign/get/") {
              return {
                list: [
                  {
                    campaign_id: "1874233177915634",
                    campaign_name: "empty shell",
                    campaign_automation_type: "MANUAL",
                    is_smart_performance_campaign: false,
                  },
                ],
                page_info: { page: 1, total_page: 1 },
              };
            }
            if (path === "/file/video/ad/search/") {
              return {
                list: [],
                page_info: { page: 1, total_page: 0, total_number: 0 },
              };
            }
            return { list: [], page_info: { page: 1, total_page: 1, total_number: 0 } };
          }),
        }),
      /no ad groups/,
    );
  });

  it("throws when /smart_plus/ad/get/ returns an empty list on an upgraded campaign", async () => {
    await assert.rejects(
      () =>
        readTikTokLiveCampaign({
          advertiserId: ACCOUNT.advertiserId,
          campaignId: "upgraded-campaign-1",
          token: "token",
          request: mockGet(async (path) => {
            if (path === "/campaign/get/") {
              return {
                list: [UPGRADED_CAMPAIGN_GET],
                page_info: { page: 1, total_page: 1 },
              };
            }
            if (path === "/smart_plus/adgroup/get/") {
              return {
                list: [UPGRADED_ADGROUP_GET],
                page_info: { page: 1, total_page: 1 },
              };
            }
            if (path === "/smart_plus/ad/get/") {
              return { list: [], page_info: { page: 1, total_page: 1 } };
            }
            if (path === "/ad/get/") {
              return {
                list: UPGRADED_AD_GET_ALL,
                page_info: { page: 1, total_page: 1 },
              };
            }
            if (path === "/file/video/ad/search/") {
              return {
                list: [],
                page_info: { page: 1, page_size: 100, total_number: 0, total_page: 0 },
              };
            }
            return { list: [], page_info: { page: 1, total_page: 1 } };
          }),
        }),
      /\/smart_plus\/ad\/get\/ returned no ads for upgraded-campaign-1 \(7 \/ad\/get\/ rows\)/,
    );
  });

  it("throws through logUnmatchedCandidates when the list envelope key is unknown", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      await assert.rejects(
        () =>
          listTikTokLiveCampaigns({
            advertiserId: ACCOUNT.advertiserId,
            token: "token",
            request: mockGet(async () => ({
              items: [MANUAL_CAMPAIGN_GET],
              page_info: { page: 1, total_page: 1 },
            })),
          }),
        (err: unknown) =>
          err instanceof TikTokImportEnvelopeError &&
          err.message.includes("none of [list, adgroups, ads, campaigns]"),
      );
    } finally {
      console.error = original;
    }
    assert.equal(
      lines.some((line) =>
        line.includes("[tiktok/unmatched] /campaign/get/ envelope"),
      ),
      true,
    );
  });
});

/* -------------------------------------------------------------------- *
 * A — the raw capture route
 * ------------------------------------------------------------------- */

describe("recording request", () => {
  it("records path, params and verbatim data in call order", async () => {
    const { request, calls } = recordingTikTokGet(
      mockGet(async (path) => ({ list: [{ path }] })) as TikTokGet,
    );
    await request("/campaign/get/", { advertiser_id: "1", fields: ["a"] }, "token");
    await request("/ad/get/", { advertiser_id: "1" }, "token");
    assert.deepEqual(
      calls.map((call) => call.path),
      ["/campaign/get/", "/ad/get/"],
    );
    assert.deepEqual(calls[0]?.params, { advertiser_id: "1", fields: ["a"] });
    assert.deepEqual(calls[0]?.data, { list: [{ path: "/campaign/get/" }] });
    assert.equal(calls[0]?.ok, true);
    assert.equal(calls[0]?.error, null);
  });

  it("records a rejected request and rethrows — the field list came from an error body", async () => {
    const { request, calls } = recordingTikTokGet(
      mockGet(async () => {
        throw new Error(
          "fields.32: one or more value of the param is not acceptable",
        );
      }) as TikTokGet,
    );
    await assert.rejects(() => request("/adgroup/get/", { fields: ["x"] }, "token"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.ok, false);
    assert.match(calls[0]?.error?.message ?? "", /fields\.32/);
  });
});

describe("raw capture route", () => {
  const source = [
    readFileSync(
      join(HERE, "../../../../app/api/tiktok/campaigns/import/raw/route.ts"),
      "utf8",
    ),
    readFileSync(join(HERE, "../raw.ts"), "utf8"),
  ].join("\n");
  const unusedSupabase = {} as Parameters<typeof handleTikTokImportRaw>[0]["supabase"];

  it("is a GET and writes no draft", () => {
    assert.match(source, /export async function GET\(/);
    assert.equal(source.includes("export async function POST"), false);
  });

  it("returns 401 without a session", async () => {
    const result = await handleTikTokImportRaw({
      advertiserId: "1",
      campaignId: "2",
      userId: null,
      supabase: unusedSupabase,
    });
    assert.equal(result.status, 401);
    assert.equal(result.body.ok, false);
  });

  it("returns 403 for a user off the allowlist", async () => {
    const result = await handleTikTokImportRaw({
      advertiserId: "1",
      campaignId: "2",
      userId: "00000000-0000-0000-0000-000000000000",
      supabase: unusedSupabase,
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.ok, false);
  });

  it("writes no draft and maps nothing", () => {
    for (const forbidden of [
      "upsertTikTokDraft",
      "mapTikTokLiveCampaignToDraft",
      "finalizeTikTokImportDraft",
      "tiktokPost",
      "OFFPIXEL_TIKTOK_WRITES_ENABLED",
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `raw capture route must not reference ${forbidden}`,
      );
    }
  });

  it("returns what was captured before a throw", () => {
    assert.match(source, /readError/);
    assert.match(source, /calls,/);
  });
});

/* -------------------------------------------------------------------- *
 * Guards
 * ------------------------------------------------------------------- */

describe("relaunch enhancement constant", () => {
  it("tracks lib/tiktok/write/mapping.ts is_aco: false", () => {
    const mapping = readFileSync(join(HERE, "../../write/mapping.ts"), "utf8");
    assert.match(mapping, /is_aco:\s*false/);
    assert.equal(TIKTOK_IMPORT_RELAUNCH_ENHANCEMENTS, "OFF");
  });
});

describe("fixture provenance", () => {
  it("retires doc-derived as the fixture for paths the captures cover", () => {
    const fixture = readFileSync(
      join(HERE, "../__fixtures__/doc-derived-v1.3.ts"),
      "utf8",
    );
    assert.match(fixture, /Doc-derived v1\.3 envelopes/);
    assert.match(fixture, /Not a live capture/);
    assert.match(fixture, /still the fixture for import\.test\.ts/);
    assert.match(fixture, /legacy SPC/);
    assert.match(fixture, /not a carry rule/);
  });

  it("keeps captured fixtures in __fixtures__/captured so neither can be mistaken for the other", () => {
    const captured = readdirSync(join(HERE, "../__fixtures__/captured"));
    assert.ok(
      captured.includes("tiktok-import-capture-1876044101888033.json"),
    );
    for (const file of captured) {
      const source = readFileSync(join(HERE, "../__fixtures__/captured", file), "utf8");
      if (file.endsWith(".json")) {
        const parsed = JSON.parse(source) as { _note?: string };
        assert.match(
          parsed._note ?? "",
          /CAPTURED \d{4}-\d{2}-\d{2}/,
          `${file} needs a _note with the capture date`,
        );
        assert.match(parsed._note ?? "", /video_cover_url/);
        continue;
      }
      assert.match(source, /CAPTURED \d{4}-\d{2}-\d{2}/, `${file} needs a capture date`);
    }
    const docDerived = readdirSync(join(HERE, "../__fixtures__"), {
      withFileTypes: true,
    }).filter((entry) => entry.isFile());
    for (const entry of docDerived) {
      assert.match(
        entry.name,
        /doc-derived/,
        `${entry.name} sits beside doc-derived fixtures; captures live in captured/`,
      );
    }
  });
});

describe("import path allowlist", () => {
  it("records read + thumbnail hydration onto allowed paths only", async () => {
    const { request, calls } = recordingTikTokGet(
      mockGet(async (path) => {
        if (path === "/campaign/get/") {
          return {
            list: [UPGRADED_CAMPAIGN_GET],
            page_info: { page: 1, total_page: 1 },
          };
        }
        if (path === "/smart_plus/adgroup/get/") {
          return {
            list: [UPGRADED_ADGROUP_GET],
            page_info: { page: 1, total_page: 1 },
          };
        }
        if (path === "/smart_plus/ad/get/") {
          return {
            list: [UPGRADED_SMART_PLUS_AD_GET],
            page_info: { page: 1, total_page: 1 },
          };
        }
        if (path === "/ad/get/") {
          return { list: UPGRADED_AD_GET_ALL, page_info: { page: 1, total_page: 1 } };
        }
        if (path === "/file/video/ad/search/") {
          return {
            list: CREATIVE_LIBRARY_VIDEO_IDS.map((video_id) => ({ video_id })),
            page_info: { page: 1, page_size: 100, total_number: 3, total_page: 1 },
          };
        }
        if (path === "/file/video/ad/info/") {
          return { list: [{ video_id: "v-generated-1", video_cover_url: "https://thumb" }] };
        }
        return { list: [], page_info: { page: 1, total_page: 1 } };
      }),
    );
    const bundle = await readTikTokLiveCampaign({
      advertiserId: ACCOUNT.advertiserId,
      campaignId: "upgraded-campaign-1",
      token: "token",
      request,
    });
    const picker = buildTikTokImportPicker(bundle);
    await hydratePickerThumbnails({
      rows: picker.rows,
      advertiserId: ACCOUNT.advertiserId,
      token: "token",
      request,
    });
    const allowed = new Set(TIKTOK_IMPORT_PATHS);
    const recorded = [...new Set(calls.map((call) => call.path))];
    for (const path of recorded) {
      assert.ok(allowed.has(path as (typeof TIKTOK_IMPORT_PATHS)[number]), path);
    }
    assert.ok(recorded.includes("/file/video/ad/info/"));
  });

  it("mentions only the named TikTok paths under lib/tiktok/import", () => {
    // Quoted path literals only (`"/ad/get/"`). A path built with a
    // template literal (`\`/ad/${name}/\``) escapes both this guard and
    // the recorder allowlist.
    const root = join(HERE, "..");
    const files = collectTsFiles(root).filter(
      (file) => !file.includes("/__tests__/") && !file.includes("/__fixtures__/"),
    );
    const allowed = new Set(TIKTOK_IMPORT_PATHS);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/"(\/[a-z0-9_/]+\/)"/g)) {
        const path = match[1]!;
        if (!path.includes("/")) continue;
        if (
          path.startsWith("/campaign/") ||
          path.startsWith("/ad") ||
          path.startsWith("/smart_plus/") ||
          path.startsWith("/file/") ||
          path.startsWith("/tools/") ||
          path.startsWith("/identity/") ||
          path.startsWith("/pixel/")
        ) {
          assert.ok(
            allowed.has(path as (typeof TIKTOK_IMPORT_PATHS)[number]),
            `${file} has ${path}`,
          );
        }
      }
    }
  });

  it("does not keep a dead tiktok_added origin", () => {
    const root = join(HERE, "..");
    const files = collectTsFiles(root).filter(
      (file) => !file.includes("/__tests__/") && !file.includes("/__fixtures__/"),
    );
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.equal(
        source.includes("tiktok_added"),
        false,
        `${file} still names tiktok_added`,
      );
    }
  });

  it("does not edit lib/tiktok/write — import only reads mapping tables", () => {
    const writeDir = join(HERE, "../../write");
    const importMentions = collectTsFiles(writeDir).filter((file) =>
      readFileSync(file, "utf8").includes("tiktok/import"),
    );
    assert.deepEqual(importMentions, []);
  });
});

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}
