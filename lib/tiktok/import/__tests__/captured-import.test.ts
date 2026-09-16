import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { TikTokApiError, tiktokGet } from "../../client.ts";
import { bundleFromRawCapture } from "../capture.ts";
import {
  buildTikTokImportPicker,
  classifyTikTokImportCarry,
  finalizeTikTokImportDraft,
  formatRejectedCarryKeys,
  mapTikTokLiveCampaignToDraft,
  parseTikTokImportCarry,
} from "../map.ts";
import {
  defaultCarryKeys,
  formatTikTokImportJoinLine,
  formatTikTokImportUnjoinedLine,
  hydratePickerThumbnails,
  matchTikTokGeneratedName,
  type TikTokImportPickerRow,
} from "../picker.ts";
import { formatTikTokImportCreativeCounts } from "../types.ts";
import { collectTikTokLaunchPreflight } from "../../write/preflight.ts";

type TikTokGet = typeof tiktokGet;

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURED = join(HERE, "../__fixtures__/captured");
const SMART_PLUS_PATH = join(
  CAPTURED,
  "tiktok-import-capture-1876044101888033.json",
);
const MANUAL_PATH = join(
  CAPTURED,
  "tiktok-import-capture-1874142286754113.json",
);

const ACCOUNT = {
  tiktokAccountId: "acct-1",
  advertiserId: "7639802149165301776",
  currency: "GBP",
  timezone: "Europe/London",
};

const ORIGINAL_MP4_STEMS = [
  "80% - JJ New 1_vaES07ge.mp4",
  "80% - JJ New 2_57AZyiz0.mp4",
  "80% - JJ Classic 1_TsM7pLQI.mp4",
  "80% - JJ Classic 2_sSPFriEa.mp4",
  "JJ - Lineup - Motion 1_cKoHRCX4.mp4",
  "JJ - Lineup - Motion 2_PO30WehD.mp4",
  "JJ - Lineup - Motion 3_OtKHmiPn.mp4",
  "JJ - Lineup - Motion Classic 1_bh2JPt5k.mp4",
  "JJ - Lineup - Motion Classic 2_WaBQHo8P.mp4",
];

function loadCapture(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("verbatim captures", () => {
  it("loads both captures as fixtures and the mapper runs without a throw", () => {
    const smart = bundleFromRawCapture(loadCapture(SMART_PLUS_PATH));
    assert.doesNotThrow(() =>
      mapTikTokLiveCampaignToDraft(smart, "from-smart-capture", ACCOUNT),
    );
    const manual = bundleFromRawCapture(loadCapture(MANUAL_PATH));
    assert.doesNotThrow(() =>
      mapTikTokLiveCampaignToDraft(manual, "from-manual-capture", ACCOUNT),
    );
  });
});

describe("Smart+ capture 1876044101888033", () => {
  const bundle = bundleFromRawCapture(loadCapture(SMART_PLUS_PATH));
  const picker = buildTikTokImportPicker(bundle);

  it("is 41 unique videos + 1 Spark from 45 rows", () => {
    const videoIds = new Set(
      bundle.ads.map((ad) => ad.video_id).filter((id): id is string => Boolean(id)),
    );
    assert.equal(bundle.ads.length, 45);
    assert.equal(videoIds.size, 41);
    const sparks = picker.rows.filter((row) => row.kind === "spark" && !row.disabled);
    assert.equal(sparks.length, 1);
    assert.equal(sparks[0]?.key, "7681731377242311958");
  });

  it("joins every creative_list id to an /ad/get/ ad_id and reports unjoined 0", () => {
    const adIds = new Set(bundle.ads.map((ad) => ad.ad_id));
    const creativeIds = bundle.smartPlusAds.flatMap((ad) =>
      (ad.creative_list ?? []).map((row) => row.smart_plus_creative_id),
    );
    assert.equal(creativeIds.length, 45);
    assert.equal(
      creativeIds.every((id) => typeof id === "string" && adIds.has(id)),
      true,
    );
    assert.equal(picker.unjoined, 0);
    assert.equal(picker.chosenJoined, 45);
    assert.equal(picker.chosenTotal, 45);
    assert.equal(formatTikTokImportUnjoinedLine(picker.unjoined), null);
    assert.equal(
      formatTikTokImportJoinLine(picker.chosenJoined, picker.chosenTotal),
      null,
    );
  });

  it("lists CAROUSEL_ADS without a Spark id as unsupported, never in creatives.items", () => {
    const carousels = picker.rows.filter(
      (row) => row.unsupportedReason === "unsupported_ad_format",
    );
    assert.ok(carousels.length >= 3);
    const mapped = mapTikTokLiveCampaignToDraft(bundle, "carousel-capture", ACCOUNT);
    assert.equal(
      mapped.creatives.items.some((item) =>
        carousels.some((row) => row.key === item.id),
      ),
      false,
    );
  });

  it("collapses nine rows that share a stem with another video_id", () => {
    const collapsed = picker.rows.filter((row) => row.copies > 1);
    const originalPairs = collapsed.filter((row) =>
      ORIGINAL_MP4_STEMS.includes(row.name),
    );
    assert.equal(originalPairs.length, 8);
    assert.ok(
      collapsed.length >= 9,
      `expected at least 9 collapsed stems, got ${collapsed.length}`,
    );
  });

  it("pattern-default unticks exactly the variant rows and none of the nine .mp4 originals", () => {
    const originals = picker.rows.filter((row) =>
      ORIGINAL_MP4_STEMS.includes(row.name),
    );
    assert.equal(originals.length, 9);
    for (const row of originals) {
      assert.equal(row.defaultTicked, true, row.name);
      assert.equal(row.disabled, false, row.name);
      assert.equal(matchTikTokGeneratedName(row.name), null, row.name);
    }
    const variants = picker.rows.filter(
      (row) => !row.disabled && !ORIGINAL_MP4_STEMS.includes(row.name) && row.kind === "video",
    );
    for (const row of variants) {
      assert.equal(row.defaultTicked, false, row.name);
      assert.ok(row.suggestionReason, row.name);
    }
    const suggested = picker.rows.filter((row) => row.suggestionReason);
    assert.ok(suggested.length > 0);
    for (const row of suggested) {
      assert.equal(
        picker.rows.some((item) => item.key === row.key),
        true,
        row.name,
      );
      if (!row.unsupportedReason) {
        assert.equal(row.disabled, false, row.name);
      }
    }
  });

  it("carries the Spark row from creative_list.creative_info.tiktok_item_id", () => {
    const sparkCreative = bundle.smartPlusAds
      .flatMap((ad) => ad.creative_list ?? [])
      .find((row) => row.creative_info?.tiktok_item_id);
    assert.equal(sparkCreative?.creative_info?.ad_format, "CAROUSEL_ADS");
    assert.equal(
      sparkCreative?.creative_info?.tiktok_item_id,
      "7681731377242311958",
    );
    const mapped = mapTikTokLiveCampaignToDraft(bundle, "spark-join", ACCOUNT);
    const spark = mapped.creatives.items.find((item) => item.mode === "SPARK_AD");
    assert.ok(spark);
    assert.equal(spark?.sparkPostId, "7681731377242311958");
  });
});

describe("manual capture 1874142286754113", () => {
  it("maps v7 as VIDEO_REFERENCE and the eight Spark item ids; one video_id is in the library; all stay ticked", () => {
    const bundle = bundleFromRawCapture(loadCapture(MANUAL_PATH));
    const picker = buildTikTokImportPicker(bundle);
    assert.equal(picker.rows.length, 9);
    assert.equal(picker.unjoined, 0);
    assert.equal(
      picker.rows.filter((row) => row.defaultTicked && !row.disabled).length,
      9,
    );
    const sparks = picker.rows.filter((row) => row.kind === "spark");
    const videos = picker.rows.filter((row) => row.kind === "video");
    assert.equal(sparks.length, 8);
    assert.equal(videos.length, 1);
    assert.ok(videos[0]?.name.toLowerCase().includes("v7"));

    const sparkIdsFromCapture = bundle.ads
      .map((ad) => ad.tiktok_item_id)
      .filter((id): id is string => Boolean(id));
    assert.equal(sparkIdsFromCapture.length, 8);
    const keys = picker.rows.map((row) => row.key);
    const mapped = mapTikTokLiveCampaignToDraft(bundle, "manual-nine", ACCOUNT, {
      carry: keys,
    });
    const v7 = mapped.creatives.items.find((item) => item.mode === "VIDEO_REFERENCE");
    assert.equal(mapped.creatives.items.filter((item) => item.mode === "VIDEO_REFERENCE").length, 1);
    assert.equal(v7?.sparkPostId, null);
    assert.ok(v7?.name.toLowerCase().includes("v7"));
    const sparkItems = mapped.creatives.items.filter((item) => item.mode === "SPARK_AD");
    assert.equal(sparkItems.length, 8);
    assert.deepEqual(
      sparkItems.map((item) => item.sparkPostId).sort(),
      sparkIdsFromCapture.slice().sort(),
    );

    const videoIds = bundle.ads
      .map((ad) => ad.video_id)
      .filter((id): id is string => Boolean(id));
    assert.equal(videoIds.length, 9);
    const inLibrary = videoIds.filter((id) => bundle.libraryVideoIds.includes(id));
    assert.deepEqual(inLibrary, ["v10033g50000da3mctvog65n5k613ri0"]);
    assert.equal(
      picker.rows.every((row) => row.defaultTicked && !row.disabled),
      true,
    );
  });
});

describe("POST carry decision and mapped save", () => {
  const bundle = bundleFromRawCapture(loadCapture(SMART_PLUS_PATH));
  const picker = buildTikTokImportPicker(bundle);

  it("without carry is picker; carry [] is nosave; three keys map those three assigned", () => {
    assert.deepEqual(parseTikTokImportCarry({}), { action: "picker" });
    assert.deepEqual(parseTikTokImportCarry({ carry: [] }), { action: "nosave" });
    const keys = defaultCarryKeys(picker).slice(0, 3);
    assert.equal(keys.length, 3);
    assert.deepEqual(parseTikTokImportCarry({ carry: keys }), {
      action: "save",
      carry: keys,
    });
    const mapped = mapTikTokLiveCampaignToDraft(bundle, "three", ACCOUNT, {
      carry: keys,
    });
    assert.equal(mapped.creatives.items.length, 3);
    const assigned = Object.values(mapped.creativeAssignments.byAdGroupId).flat();
    assert.deepEqual(
      assigned.slice().sort(),
      mapped.creatives.items.map((item) => item.id).slice().sort(),
    );
    const carrySet = new Set(keys);
    assert.equal(
      mapped.creatives.items.every(
        (item) =>
          (item.videoId && carrySet.has(item.videoId)) ||
          (item.sparkPostId && carrySet.has(item.sparkPostId)),
      ),
      true,
    );
  });

  it("map with carry [] saves no creatives", () => {
    const mapped = mapTikTokLiveCampaignToDraft(bundle, "none", ACCOUNT, {
      carry: [],
    });
    assert.equal(mapped.creatives.items.length, 0);
    assert.equal(mapped.importMeta?.creativeCounts?.carried, 0);
  });

  it("confirm with only disabled or unknown keys names the rejected keys and saves nothing", () => {
    const disabled = picker.rows.filter((row) => row.disabled).map((row) => row.key);
    assert.ok(disabled.length > 0);
    const carry = [...disabled, "not-a-creative-key"];
    const { accepted, rejected } = classifyTikTokImportCarry(picker, carry);
    assert.deepEqual(accepted, []);
    assert.deepEqual(rejected, carry);
    assert.match(formatRejectedCarryKeys(rejected), /Rejected keys:/);
    assert.match(formatRejectedCarryKeys(rejected), /not-a-creative-key/);
    const mapped = mapTikTokLiveCampaignToDraft(bundle, "rejected", ACCOUNT, {
      carry,
    });
    assert.equal(mapped.creatives.items.length, 0);
  });

  it("Step 1 line names originals carried and unticked by reason", () => {
    const mapped = mapTikTokLiveCampaignToDraft(bundle, "defaults", ACCOUNT);
    const generated = (mapped.importMeta?.notCarried ?? []).filter(
      (item) => item.reason === "looks_tiktok_generated",
    ).length;
    const byYou = (mapped.importMeta?.notCarried ?? []).filter(
      (item) => item.reason === "operator_unticked",
    ).length;
    const line = formatTikTokImportCreativeCounts(
      mapped.importMeta!.creativeCounts!,
      mapped.importMeta!.notCarried,
    );
    assert.match(line, /originals carried/);
    assert.match(line, /unticked/);
    assert.equal(generated > 0, true);
    assert.equal(byYou, 0);
  });
});

describe("hydratePickerThumbnails", () => {
  function videoRow(
    key: string,
    extras: Partial<TikTokImportPickerRow> = {},
  ): TikTokImportPickerRow {
    return {
      key,
      kind: "video",
      origin: "chosen",
      name: key,
      thumbnailUrl: null,
      thumbnailError: false,
      durationSeconds: null,
      width: null,
      height: null,
      assetGroups: [],
      copies: 1,
      inLibrary: false,
      defaultTicked: true,
      disabled: false,
      suggestionReason: null,
      unsupportedReason: null,
      suggestionLabel: null,
      ...extras,
    };
  }

  function infoRequest(bad: ReadonlySet<string>, sizes: number[]) {
    return (async (path: string, params: Record<string, unknown>) => {
      assert.equal(path, "/file/video/ad/info/");
      const ids = params.video_ids as string[];
      sizes.push(ids.length);
      if (ids.some((id) => bad.has(id))) {
        throw new Error("one of the video_ids is not acceptable");
      }
      return {
        list: ids.map((video_id) => ({
          video_id,
          video_cover_url: `https://thumb/${video_id}`,
        })),
      };
    }) as TikTokGet;
  }

  it("keeps the good id's thumbnail when a mixed chunk has one bad id", async () => {
    const sizes: number[] = [];
    const hydrated = await hydratePickerThumbnails({
      rows: [videoRow("v-bad-id"), videoRow("v-good-id")],
      advertiserId: ACCOUNT.advertiserId,
      token: "token",
      request: infoRequest(new Set(["v-bad-id"]), sizes),
    });
    assert.ok(sizes.includes(2));
    assert.equal(hydrated[0]?.thumbnailUrl, null);
    assert.equal(hydrated[0]?.thumbnailError, true);
    assert.equal(hydrated[1]?.thumbnailUrl, "https://thumb/v-good-id");
    assert.equal(hydrated[1]?.thumbnailError, false);
  });

  it("splits a 4-id chunk so one bad id does not cost the other three", async () => {
    const keys = ["v-good-a", "v-bad-id", "v-good-b", "v-good-c"];
    const sizes: number[] = [];
    const hydrated = await hydratePickerThumbnails({
      rows: keys.map((key) => videoRow(key)),
      advertiserId: ACCOUNT.advertiserId,
      token: "token",
      request: infoRequest(new Set(["v-bad-id"]), sizes),
    });
    const budget = 2 * Math.ceil(Math.log2(keys.length)) + 1;
    assert.ok(sizes.length <= budget, `calls=${sizes.length} sizes=${sizes.join(",")}`);
    assert.ok(
      sizes.some((size) => size > 1 && size < keys.length),
      "retries a half, not each id",
    );
    assert.equal(hydrated.filter((row) => row.thumbnailError).length, 1);
    assert.equal(
      hydrated.filter((row) => row.thumbnailUrl?.startsWith("https://thumb/")).length,
      3,
    );
    assert.equal(
      hydrated.find((row) => row.key === "v-bad-id")?.thumbnailError,
      true,
    );
  });

  it("marks every id when every id in the chunk is bad", async () => {
    const keys = ["v-bad-a", "v-bad-b", "v-bad-c", "v-bad-d"];
    const sizes: number[] = [];
    const hydrated = await hydratePickerThumbnails({
      rows: keys.map((key) => videoRow(key)),
      advertiserId: ACCOUNT.advertiserId,
      token: "token",
      request: infoRequest(new Set(keys), sizes),
    });
    assert.equal(hydrated.every((row) => row.thumbnailError), true);
    assert.equal(hydrated.every((row) => row.thumbnailUrl === null), true);
    assert.ok(sizes.length > 1);
    assert.equal(sizes.length, 7);
  });

  it("does not ask /file/video/ad/info/ for a blocked row, and does not mark it thumbnailError", async () => {
    // Ironworks Smart+ capture: three blocked carousel rows whose key is
    // an ad_id. The manual capture has none of this shape.
    const picker = buildTikTokImportPicker(
      bundleFromRawCapture(loadCapture(SMART_PLUS_PATH)),
    );
    const blocked = picker.rows.filter((row) => row.disabled);
    assert.ok(blocked.length > 0);
    const blockedKeys = new Set(blocked.map((row) => row.key));

    const blockedOnlySizes: number[] = [];
    const blockedHydrated = await hydratePickerThumbnails({
      rows: blocked,
      advertiserId: ACCOUNT.advertiserId,
      token: "token",
      request: infoRequest(new Set(), blockedOnlySizes),
    });
    assert.deepEqual(blockedOnlySizes, []);
    assert.equal(
      blockedHydrated.every((row) => row.thumbnailError === false),
      true,
    );

    const mixedIds: string[] = [];
    const mixed = await hydratePickerThumbnails({
      rows: picker.rows,
      advertiserId: ACCOUNT.advertiserId,
      token: "token",
      request: (async (path: string, params: Record<string, unknown>) => {
        assert.equal(path, "/file/video/ad/info/");
        const ids = params.video_ids as string[];
        mixedIds.push(...ids);
        return {
          list: ids.map((video_id) => ({
            video_id,
            video_cover_url: `https://thumb/${video_id}`,
          })),
        };
      }) as TikTokGet,
    });
    assert.equal(
      mixedIds.some((id) => blockedKeys.has(id)),
      false,
    );
    assert.equal(
      mixed.filter((row) => row.disabled).every((row) => row.thumbnailError === false),
      true,
    );
  });

  it("retries a non-bad-id error once, then stops without marking thumbnailError", async () => {
    const keys = ["v-a", "v-b", "v-c", "v-d"];
    const cases: Array<{ label: string; err: Error }> = [
      {
        label: "429",
        err: new TikTokApiError("Too many requests", 50001, "req-429", 429),
      },
      {
        label: "401",
        err: new TikTokApiError("Access token is invalid", 40105, "req-401", 401),
      },
      {
        label: "transport",
        err: new Error("Network error calling TikTok Business API: ECONNRESET"),
      },
    ];
    for (const { label, err } of cases) {
      const sizes: number[] = [];
      const hydrated = await hydratePickerThumbnails({
        rows: keys.map((key) => videoRow(key)),
        advertiserId: ACCOUNT.advertiserId,
        token: "token",
        request: (async (_path: string, params: Record<string, unknown>) => {
          const ids = params.video_ids as string[];
          sizes.push(ids.length);
          throw err;
        }) as TikTokGet,
      });
      assert.deepEqual(sizes, [4, 4], label);
      assert.equal(
        hydrated.every((row) => row.thumbnailError === false),
        true,
        label,
      );
      assert.equal(
        hydrated.every((row) => row.thumbnailUrl === null),
        true,
        label,
      );
    }
  });
});

describe("imported draft launch exit", () => {
  it("7f93de68 shape with event and a future start has zero preflight issues", () => {
    const bundle = bundleFromRawCapture(loadCapture(MANUAL_PATH));
    const picker = buildTikTokImportPicker(bundle);
    const mapped = mapTikTokLiveCampaignToDraft(
      bundle,
      "7f93de68-be46-4cc7-bfe4-b239f59a80fb",
      ACCOUNT,
      { carry: defaultCarryKeys(picker) },
    );
    // import/heal clock — the 4th arg save.ts now passes (wall-clock in prod)
    const importNow = new Date("2026-09-16T16:00:00.000Z");
    // launch-evaluation clock — collectTikTokLaunchPreflight options.now
    const launchNow = new Date("2026-09-16T16:00:00.000Z");
    const draft = finalizeTikTokImportDraft(
      mapped,
      "7f93de68-be46-4cc7-bfe4-b239f59a80fb",
      [],
      importNow,
    );
    draft.eventId = "2d5a5485-bfec-4812-9fcc-2f6f89262f6c";
    draft.budgetSchedule.scheduleStartAt = "2026-09-17T12:00";
    draft.budgetSchedule.scheduleEndAt = "2026-10-03T12:00";
    assert.equal(draft.accountSetup.pixelId, "7644201699552690194");
    assert.equal(draft.accountSetup.optimisationEvent, "ON_WEB_REGISTER");
    assert.ok(draft.accountSetup.identityBcId);
    assert.equal(draft.accountSetup.currency, "GBP");
    assert.equal(draft.optimisation.bidStrategy, "COST_CAP");
    assert.equal(draft.optimisation.targetCostPerResult, 1.5);
    const { issues } = collectTikTokLaunchPreflight(draft, {
      now: launchNow,
    });
    assert.deepEqual(
      issues,
      [],
      issues.map((issue) => `${issue.id}:${issue.field}:${issue.message}`).join(" | "),
    );
  });
});
