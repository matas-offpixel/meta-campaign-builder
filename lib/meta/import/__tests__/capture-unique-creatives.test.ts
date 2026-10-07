/**
 * Unique-creative grouping on the two live captures:
 *   120249957259050453  [DHB26-DUBAI] Deep House Bible Dubai — 25 objects, 105 ads
 *   52522388611107      [IRW0001] Jamie Jones — 301 objects, 408 ads
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { groupMetaImportCreatives } from "../groups.ts";
import { mapMetaLiveCampaign } from "../map.ts";
import { buildMetaImportPicker, defaultMetaImportCarry } from "../picker.ts";
import { readMetaLiveCampaign } from "../readers.ts";
import type { MetaImportRecordedCall, MetaLiveCampaignBundle } from "../types.ts";

const CAPTURED = join(dirname(fileURLToPath(import.meta.url)), "../__fixtures__/captured");

function readCapture(campaignId: string, adAccountId: string): Promise<MetaLiveCampaignBundle> {
  const { calls } = JSON.parse(
    readFileSync(join(CAPTURED, `meta-import-capture-${campaignId}.json`), "utf8"),
  ) as { calls: MetaImportRecordedCall[] };
  const gets = calls.filter((call) => call.method === "GET");
  const posts = calls.filter((call) => call.method === "POST");
  let postAt = 0;
  return readMetaLiveCampaign({
    adAccountId,
    campaignId,
    token: "token",
    sleep: async () => {},
    request: {
      get: async (path, params) => {
        const call = gets.find(
          (row) => row.path === path && String(row.params.after ?? "") === (params.after ?? ""),
        );
        if (!call) throw new Error(`no recorded GET ${path}`);
        return call.data;
      },
      post: async () => posts[postAt++ % posts.length]!.data,
    },
  });
}

type Video = { video_id?: string; thumbnail_url?: string; adlabels?: { name?: string }[] };

function videosOf(bundle: MetaLiveCampaignBundle, creativeId: string): Video[] {
  const feed = bundle.creatives[creativeId]!.asset_feed_spec as { videos?: Video[] } | undefined;
  return feed?.videos ?? [];
}

function posterFile(video: Video): string {
  return new URL(video.thumbnail_url!).pathname.split("/").pop()!;
}

function bodyOf(bundle: MetaLiveCampaignBundle, creativeId: string): string {
  const feed = bundle.creatives[creativeId]!.asset_feed_spec as { bodies?: { text?: string }[] };
  return JSON.stringify(feed.bodies?.map((row) => row.text));
}

describe("DHB capture: unique creatives", () => {
  const bundlePromise = readCapture("120249957259050453", "act_968594768066330");

  it("9 rows: 2 static, 2 motion, 5 boosted posts; names carry no ad set suffix", async () => {
    const bundle = await bundlePromise;
    const picker = buildMetaImportPicker(bundle);
    assert.deepEqual(
      picker.rows.map((row) => [row.name, row.disabled]),
      [
        ["Static - Ahmed", false],
        ["Motion - Ahmed", false],
        ["Motion - Artwork", false],
        ["Feed - Motion", true],
        ["Static - Artwork", false],
        ["Feed - Motion", true],
        ["Feed - Motion", true],
        ["Feed - Motion", true],
        ["Feed - Motion", true],
      ],
    );
    assert.equal(picker.rows.some((row) => / — |\s{2}/.test(row.name)), false);
    const draft = mapMetaLiveCampaign({
      bundle,
      adAccountId: "act_968594768066330",
      carry: defaultMetaImportCarry(picker),
      availability: [],
    });
    assert.deepEqual(
      draft.creatives.map((row) => [row.name, row.importedMeta?.creativeIds.length, row.importedMeta?.adSetIds.length]),
      [
        ["Static - Ahmed", 5, 21],
        ["Motion - Ahmed", 5, 21],
        ["Motion - Artwork", 5, 21],
        ["Static - Artwork", 5, 21],
      ],
    );
  });

  it("the original Motion - Ahmed and its Ads Manager copies are one row despite different posters", async () => {
    const bundle = await bundlePromise;
    const ahmed = groupMetaImportCreatives(bundle).find((group) => group.name === "Motion - Ahmed")!;
    const posters = new Set(ahmed.creativeIds.flatMap((id) => videosOf(bundle, id).map(posterFile)));
    assert.ok(posters.size >= 4, `posters ${[...posters].join(", ")}`);
    assert.equal(new Set(ahmed.creativeIds.map((id) => bodyOf(bundle, id))).size, 1);
    assert.equal(ahmed.creativeIds.length, 5);
  });

  it("a poster shared across Ahmed-body and Artwork-body creatives never merges them", async () => {
    const bundle = await bundlePromise;
    const groups = groupMetaImportCreatives(bundle);
    const byPoster = new Map<string, Set<string>>();
    for (const group of groups) {
      for (const id of group.creativeIds) {
        for (const video of videosOf(bundle, id)) {
          const file = posterFile(video);
          byPoster.set(file, (byPoster.get(file) ?? new Set()).add(group.name));
        }
      }
      if (group.key.startsWith("post:")) continue;
      assert.equal(new Set(group.creativeIds.map((id) => bodyOf(bundle, id))).size, 1, group.name);
    }
    const shared = [...byPoster.values()].find((names) => names.size > 1);
    assert.deepEqual(shared && [...shared].sort(), ["Motion - Ahmed", "Motion - Artwork"]);
  });

  it("rows with the same name get a story-id disambiguator", async () => {
    const picker = buildMetaImportPicker(await bundlePromise);
    const posts = picker.rows.filter((row) => row.name === "Feed - Motion");
    assert.equal(posts.length, 5);
    assert.ok(posts.every((row) => /^post …\d{6}$/.test(row.nameHint ?? "")));
    assert.equal(new Set(posts.map((row) => row.nameHint)).size, 5);
    assert.ok(picker.rows.filter((row) => row.name !== "Feed - Motion").every((row) => row.nameHint === null));
  });
});

describe("Jamie Jones capture: unique creatives", () => {
  const bundlePromise = readCapture("52522388611107", "act_1967530076312");

  it("301 objects are 40 rows; no name keeps our ad set suffix or a – Copy", async () => {
    const bundle = await bundlePromise;
    const adSetNames = new Set(bundle.adSets.map((adSet) => String(adSet.name)));
    const picker = buildMetaImportPicker(bundle);
    assert.equal(Object.keys(bundle.creatives).length, 301);
    assert.equal(picker.rows.length, 40);
    for (const row of picker.rows) {
      const tail = row.name.split(" — ").pop()!;
      assert.equal(row.name.includes(" — ") && adSetNames.has(tail), false, row.name);
      assert.doesNotMatch(row.name, /\s[–-]\s+Copy(\s+\d+)?$/i);
    }
    assert.ok(picker.rows.some((row) => row.name === "Adam Ten - Static 1"));
    assert.ok(picker.rows.some((row) => row.name === "JJ - Motion 4"));
  });

  it("eighteen JJ - Feed Video posts are tellable apart by story id", async () => {
    const picker = buildMetaImportPicker(await bundlePromise);
    const posts = picker.rows.filter((row) => row.name === "JJ - Feed Video");
    assert.equal(posts.length, 18);
    assert.ok(posts.every((row) => /^post …\d{6}$/.test(row.nameHint ?? "")));
    assert.equal(new Set(posts.map((row) => row.nameHint)).size, 18);
  });
});
