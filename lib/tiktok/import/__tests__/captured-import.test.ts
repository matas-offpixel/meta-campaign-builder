import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { bundleFromRawCapture } from "../capture.ts";
import {
  buildTikTokImportPicker,
  mapTikTokLiveCampaignToDraft,
  parseTikTokImportCarry,
} from "../map.ts";
import { defaultCarryKeys, matchTikTokGeneratedName } from "../picker.ts";
import { formatTikTokImportCreativeCounts } from "../types.ts";

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
  it("loads the Smart+ capture and the mapper runs without a throw", () => {
    const smart = bundleFromRawCapture(loadCapture(SMART_PLUS_PATH));
    assert.doesNotThrow(() =>
      mapTikTokLiveCampaignToDraft(smart, "from-smart-capture", ACCOUNT),
    );
  });

  it(
    "loads the manual capture and the mapper runs without a throw",
    { skip: !existsSync(MANUAL_PATH) },
    () => {
      const manual = bundleFromRawCapture(loadCapture(MANUAL_PATH));
      assert.doesNotThrow(() =>
        mapTikTokLiveCampaignToDraft(manual, "from-manual-capture", ACCOUNT),
      );
    },
  );
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
    const sparks = picker.rows.filter((row) => !row.key.startsWith("v") && !row.disabled);
    assert.equal(sparks.length, 1);
    assert.equal(sparks[0]?.key, "7681731377242311958");
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
      (row) => !row.disabled && !ORIGINAL_MP4_STEMS.includes(row.name) && row.key.startsWith("v"),
    );
    for (const row of variants) {
      assert.equal(row.defaultTicked, false, row.name);
      assert.ok(row.suggestionReason, row.name);
    }
    assert.equal(
      picker.rows.some((row) => row.suggestionReason && !picker.rows.includes(row)),
      false,
    );
    const generatedStillListed = picker.rows.filter((row) => row.suggestionReason);
    assert.ok(generatedStillListed.length > 0);
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

  it("keeps a generated name in the list when the operator would untick it", () => {
    const generated = picker.rows.find((row) => row.suggestionReason);
    assert.ok(generated);
    assert.equal(generated!.defaultTicked, false);
    assert.equal(generated!.disabled, false);
  });
});

describe("manual capture 1874142286754113", () => {
  it("has 9 rows, all ticked by default, 8 Spark + v7, no library gate", {
    skip: !existsSync(MANUAL_PATH),
  }, () => {
    const bundle = bundleFromRawCapture(loadCapture(MANUAL_PATH));
    const picker = buildTikTokImportPicker(bundle);
    assert.equal(picker.rows.length, 9);
    assert.equal(
      picker.rows.filter((row) => row.defaultTicked && !row.disabled).length,
      9,
    );
    const sparks = picker.rows.filter((row) => !row.key.startsWith("v"));
    const videos = picker.rows.filter((row) => row.key.startsWith("v"));
    assert.equal(sparks.length, 8);
    assert.equal(videos.length, 1);
    assert.ok(videos[0]?.name.toLowerCase().includes("v7") || videos[0]?.key);
    assert.equal(
      picker.rows.some((row) => row.unsupportedReason === "not_in_creative_library"),
      false,
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
