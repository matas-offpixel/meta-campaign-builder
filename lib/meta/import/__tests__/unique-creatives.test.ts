import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  metaImportPickerHeaderLine,
  metaImportRowAdSetsLine,
  metaImportSelectAll,
} from "../../../../components/meta/meta-import-flow.ts";
import { migrateDraft } from "../../../autosave.ts";
import { creativeContentKey } from "../../../learning/ad-facts.ts";
import { creativeContentKey as importContentKey } from "../content-key.ts";
import {
  adNameStem,
  adNameWithoutAdSetSuffix,
  isMetaAutoCreativeName,
  stripMetaAutoCreativeName,
} from "../content-key.ts";
import { groupMetaImportCreatives } from "../groups.ts";
import { mapMetaLiveCampaign } from "../map.ts";
import { buildMetaImportPicker, defaultMetaImportCarry } from "../picker.ts";
import type { MetaLiveCampaignBundle } from "../types.ts";
import { GDS_ACCOUNT, gdsDuplicatedBundle } from "../__fixtures__/gds-duplicated-77.ts";

const GDS_NAMES = [
  "GDS - Static – Copy",
  "GDS - Video – Copy",
  "ES - Static",
  "ES - Video",
  "GDS Video (With Text)",
];

function importAll(bundle: MetaLiveCampaignBundle, carry?: string[]) {
  return mapMetaLiveCampaign({
    bundle,
    adAccountId: GDS_ACCOUNT,
    carry: carry ?? defaultMetaImportCarry(buildMetaImportPicker(bundle)),
    availability: [],
  });
}

describe("GDS duplicated campaign: 77 objects, 5 creatives", () => {
  const bundle = gdsDuplicatedBundle();

  it("the fixture is one AdCreative object per ad, all auto-named", () => {
    assert.equal(bundle.adSets.length, 16);
    assert.equal(bundle.ads.length, 77);
    assert.equal(Object.keys(bundle.creatives).length, 77);
    const names = Object.values(bundle.creatives).map((row) => String(row.name));
    assert.equal(names.filter(isMetaAutoCreativeName).length, 77);
  });

  it("the picker lists 5 rows, all ticked, header 5 creatives (77 ads) · 5 ticked", () => {
    const picker = buildMetaImportPicker(bundle);
    assert.equal(picker.rows.length, 5);
    assert.deepEqual(picker.rows.map((row) => row.name), GDS_NAMES);
    assert.ok(picker.rows.every((row) => row.defaultTicked && !row.disabled));
    assert.deepEqual(
      picker.rows.map((row) => row.mediaType),
      ["image", "video", "image", "video", "video"],
    );
    assert.deepEqual(picker.rows.map((row) => row.copies), [15, 15, 16, 16, 15]);
    assert.deepEqual(picker.rows.map((row) => row.adSets.length), [15, 15, 16, 16, 15]);
    assert.equal(metaImportRowAdSetsLine(picker.rows[0]!), "in 15 ad sets");
    assert.equal(
      metaImportPickerHeaderLine(picker, metaImportSelectAll(picker.rows)),
      "5 creatives (77 ads) · 5 ticked",
    );
  });

  it("maps to 5 draft creatives named after the ad, with every object, ad and ad set kept", () => {
    const draft = importAll(bundle);
    assert.deepEqual(draft.creatives.map((row) => row.name), GDS_NAMES);
    assert.ok(draft.creatives.every((row) => row.nameSource === "file"));
    assert.deepEqual(
      draft.creatives.map((row) => row.importedMeta?.creativeIds.length),
      [15, 15, 16, 16, 15],
    );
    assert.deepEqual(
      draft.creatives.map((row) => row.importedMeta?.adIds.length),
      [15, 15, 16, 16, 15],
    );
    const allObjects = draft.creatives.flatMap((row) => row.importedMeta?.creativeIds ?? []);
    assert.deepEqual([...allObjects].sort(), Object.keys(bundle.creatives).sort());
    assert.deepEqual(draft.importMeta?.creativeCounts, {
      read: 77,
      uniqueCreatives: 5,
      adsRead: 77,
      carried: 5,
      notCarried: 0,
    });
    assert.deepEqual(draft.importMeta?.notCarried, []);
  });

  it("assigns each creative to every ad set it ran in", () => {
    const draft = importAll(bundle);
    for (const creative of draft.creatives) {
      for (const adSetId of creative.importedMeta!.adSetIds) {
        assert.ok(draft.creativeAssignments[adSetId]!.includes(creative.id), `${creative.name} in ${adSetId}`);
      }
    }
    const first = bundle.adSets[0]!.id as string;
    const last = bundle.adSets[15]!.id as string;
    const nameOf = (id: string) => draft.creatives.find((row) => row.id === id)!.name;
    assert.deepEqual(draft.creativeAssignments[first]!.map(nameOf), [
      "GDS - Static – Copy",
      "GDS - Video – Copy",
      "ES - Static",
      "ES - Video",
    ]);
    assert.deepEqual(draft.creativeAssignments[last]!.map(nameOf), [
      "ES - Static",
      "ES - Video",
      "GDS Video (With Text)",
    ]);
    const total = Object.values(draft.creativeAssignments).reduce((sum, ids) => sum + ids.length, 0);
    assert.equal(total, 77);
  });

  it("unticked counts are per unique creative, and any member id carries its creative", () => {
    const picker = buildMetaImportPicker(bundle);
    const groups = groupMetaImportCreatives(bundle);
    const esStatic = groups.find((group) => group.name === "ES - Static")!;
    const draft = importAll(bundle, [esStatic.creativeIds[7]!]);
    assert.deepEqual(draft.creatives.map((row) => row.name), ["ES - Static"]);
    assert.equal(draft.creatives[0]!.id, esStatic.representativeId);
    assert.equal(draft.importMeta?.creativeCounts.notCarried, 4);
    assert.deepEqual(
      draft.importMeta?.notCarried.map((row) => [row.name, row.reason]),
      picker.rows
        .filter((row) => row.name !== "ES - Static")
        .map((row) => [row.name, "operator_unticked"]),
    );
  });

  it("before grouping, a video_id key would have split the 46 video objects one per ad", () => {
    const ids = new Set<string>();
    for (const row of Object.values(bundle.creatives)) {
      const videos = (row.asset_feed_spec as { videos?: { video_id: string }[] }).videos ?? [];
      for (const video of videos) ids.add(video.video_id);
    }
    assert.equal(ids.size, 77);
    assert.equal(new Set(Object.values(bundle.creatives).map((row) => creativeContentKey(row))).size, 5);
  });
});

describe("creativeContentKey", () => {
  const image = (body: string, hashes = ["a", "b"]) => ({
    object_story_spec: { page_id: "p", instagram_user_id: "ig" },
    asset_feed_spec: {
      images: hashes.map((hash) => ({ hash })),
      bodies: [{ text: body }],
      link_urls: [{ website_url: "https://x.test/" }],
      call_to_action_types: ["LEARN_MORE"],
    },
  });

  it("is the import's own function, re-exported for the learning loop", () => {
    assert.equal(creativeContentKey, importContentKey);
  });

  it("same media and copy is one key; image order does not matter", () => {
    assert.equal(creativeContentKey(image("Hi")), creativeContentKey(image("Hi", ["b", "a"])));
  });

  it("different copy, media, CTA or Instagram account is a different key", () => {
    const base = creativeContentKey(image("Hi"));
    assert.notEqual(base, creativeContentKey(image("Hello")));
    assert.notEqual(base, creativeContentKey(image("Hi", ["a", "c"])));
    const cta = image("Hi");
    cta.asset_feed_spec.call_to_action_types = ["BOOK_NOW"];
    assert.notEqual(base, creativeContentKey(cta));
    const ig = image("Hi");
    ig.object_story_spec.instagram_user_id = "other";
    assert.notEqual(base, creativeContentKey(ig));
  });

  it("a video is its poster file, so per-ad video copies share a key", () => {
    const video = (id: string, sig: string) => ({
      asset_feed_spec: {
        videos: [{ video_id: id, thumbnail_url: `https://cdn.test/v/831155400_1104_n.jpg?oh=${sig}` }],
        bodies: [{ text: "Hi" }],
      },
    });
    assert.equal(creativeContentKey(video("1", "x")), creativeContentKey(video("2", "y")));
    const other = video("1", "x");
    other.asset_feed_spec.videos[0]!.thumbnail_url = "https://cdn.test/v/999_n.jpg";
    assert.notEqual(creativeContentKey(video("1", "x")), creativeContentKey(other));
  });

  it("a video with no poster falls back to its id", () => {
    const bare = (id: string) => ({ object_story_spec: { video_data: { video_id: id, message: "Hi" } } });
    assert.equal(creativeContentKey(bare("1")), creativeContentKey(bare("1")));
    assert.notEqual(creativeContentKey(bare("1")), creativeContentKey(bare("2")));
  });

  it("an existing post is its story id", () => {
    assert.equal(
      creativeContentKey({ effective_object_story_id: "111_222", video_id: "v1" }),
      "post:111_222",
    );
    assert.equal(
      creativeContentKey({ source_instagram_media_id: "178", effective_object_story_id: "111_222" }),
      "post:178",
    );
  });

  it("null when the read carries neither media nor a post", () => {
    assert.equal(creativeContentKey({}), null);
  });
});

describe("ad name suffixes", () => {
  const adSets = new Set(["Wide", "Adam ten Adv+", "Jamie Jones – Copy"]);

  it("strips our ` — <ad set>` and ` — attached:<id>` suffixes and collapses spaces", () => {
    assert.equal(adNameWithoutAdSetSuffix("Static - Ahmed  — Wide", adSets), "Static - Ahmed");
    assert.equal(
      adNameWithoutAdSetSuffix("Motion - Ahmed  — attached:120249957296630453", adSets),
      "Motion - Ahmed",
    );
    assert.equal(adNameWithoutAdSetSuffix("JJ - Motion 3 — Jamie Jones – Copy", adSets), "JJ - Motion 3");
  });

  it("keeps an Ads Manager ` – Copy` that follows the suffix, and a ` — ` that is not an ad set", () => {
    assert.equal(
      adNameWithoutAdSetSuffix("Adam Ten - Static 1  — Adam ten Adv+ – Copy", adSets),
      "Adam Ten - Static 1 – Copy",
    );
    assert.equal(adNameWithoutAdSetSuffix("Promo — Halloween", adSets), "Promo — Halloween");
    assert.equal(adNameWithoutAdSetSuffix("Motion — attached:abc", adSets), "Motion — attached:abc");
  });

  it("the stem also drops ` – Copy N`, so an original and its copies agree", () => {
    assert.equal(adNameStem("GDS - Video – Copy", adSets), "GDS - Video");
    assert.equal(adNameStem("GDS - Video - Copy 2", adSets), "GDS - Video");
    assert.equal(adNameStem("Adam Ten - Static 1  — Adam ten Adv+ – Copy", adSets), "Adam Ten - Static 1");
    assert.equal(adNameStem("Copycat", adSets), "Copycat");
  });
});

describe("creativeContentKey: videos without a poster hash", () => {
  const video = (poster: string, label: string, body = "Hi") => ({
    asset_feed_spec: {
      videos: [{ video_id: poster, thumbnail_url: `https://cdn.test/v/${poster}_n.jpg`, adlabels: [{ name: label }] }],
      bodies: [{ text: body }],
    },
  });

  it("the same poster file in a different slot is a different video", () => {
    assert.notEqual(
      creativeContentKey(video("813650309", "feed_asset")),
      creativeContentKey(video("813650309", "story_asset")),
    );
  });

  it("with an ad name stem, different posters under one stem, copy and account are one creative", () => {
    assert.equal(
      creativeContentKey(video("813059653", "feed_asset"), { nameStem: "Motion - Ahmed" }),
      creativeContentKey(video("813650309", "feed_asset"), { nameStem: "Motion - Ahmed" }),
    );
  });

  it("with an ad name stem, the same poster under different stems or copy stays apart", () => {
    const shared = video("813650309", "feed_asset");
    assert.notEqual(
      creativeContentKey(shared, { nameStem: "Motion - Ahmed" }),
      creativeContentKey(shared, { nameStem: "Motion - Artwork" }),
    );
    assert.notEqual(
      creativeContentKey(shared, { nameStem: "Motion - Ahmed" }),
      creativeContentKey(video("813650309", "feed_asset", "Other"), { nameStem: "Motion - Ahmed" }),
    );
  });

  it("a poster hash wins over the stem", () => {
    const hashed = (hash: string) => ({
      object_story_spec: { video_data: { video_id: "v", image_hash: hash, message: "Hi" } },
    });
    assert.equal(
      creativeContentKey(hashed("aa"), { nameStem: "One" }),
      creativeContentKey(hashed("aa"), { nameStem: "Two" }),
    );
    assert.notEqual(
      creativeContentKey(hashed("aa"), { nameStem: "One" }),
      creativeContentKey(hashed("bb"), { nameStem: "One" }),
    );
  });
});

describe("Meta auto-names", () => {
  it("matches `<title> YYYY-MM-DD-<32 hex>`", () => {
    const name = "Girls Don't Sync · Electric Studios · Sat 31 Oct 2026-09-30-0123456789abcdef0123456789abcdef";
    assert.equal(isMetaAutoCreativeName(name), true);
    assert.equal(stripMetaAutoCreativeName(name), "Girls Don't Sync · Electric Studios · Sat 31 Oct");
  });

  it("does not match an operator name, a short hash, or uppercase hex", () => {
    assert.equal(isMetaAutoCreativeName("ES - Static"), false);
    assert.equal(isMetaAutoCreativeName("Sign up link in bio 2026-09-23-e86c8b00"), false);
    assert.equal(isMetaAutoCreativeName("Promo 2026-09-23-0123456789ABCDEF0123456789ABCDEF"), false);
    assert.equal(isMetaAutoCreativeName("2026-09-23-0123456789abcdef0123456789abcdef"), false);
    assert.equal(stripMetaAutoCreativeName("ES - Static"), null);
  });
});

describe("unique creative names", () => {
  const AUTO = "Lineup 2026-09-30-0123456789abcdef0123456789abcdef";
  const creative = (id: string, name: string, story: string) => ({
    id,
    name,
    effective_object_story_id: story,
    video_id: "v",
    instagram_permalink_url: "https://www.instagram.com/reel/X/",
  });
  const bundle = (
    creatives: ReturnType<typeof creative>[],
    ads: { id: string; name?: string; creative: string; created_time: string }[],
  ): MetaLiveCampaignBundle => ({
    campaign: { id: "c", name: "c", objective: "OUTCOME_SALES" },
    adSets: [{ id: "as1", name: "One" }, { id: "as2", name: "Two" }],
    ads: ads.map((ad, index) => ({
      id: ad.id,
      ...(ad.name ? { name: ad.name } : {}),
      adset_id: index % 2 === 0 ? "as1" : "as2",
      creative: { id: ad.creative },
      created_time: ad.created_time,
    })),
    creatives: Object.fromEntries(creatives.map((row) => [row.id, row])),
  });

  it("an object's own name is kept only when no ad name exists", () => {
    const withAd = groupMetaImportCreatives(
      bundle([creative("c1", "Operator name", "1_1")], [
        { id: "a1", name: "Ad name", creative: "c1", created_time: "2026-09-30T10:00:00+0000" },
      ]),
    );
    assert.equal(withAd[0]!.name, "Ad name");
    const noAdName = groupMetaImportCreatives(
      bundle([creative("c1", "Operator name", "1_1")], [
        { id: "a1", creative: "c1", created_time: "2026-09-30T10:00:00+0000" },
      ]),
    );
    assert.equal(noAdName[0]!.name, "Operator name");
  });

  it("an auto-name with no ad name falls back to the stripped prefix", () => {
    const groups = groupMetaImportCreatives(bundle([creative("c1", AUTO, "1_1")], []));
    assert.equal(groups[0]!.name, "Lineup");
  });

  it("the most common ad name wins; a tie goes to the first created", () => {
    const ads = [
      { id: "a1", name: "Later", creative: "c1", created_time: "2026-09-30T12:00:00+0000" },
      { id: "a2", name: "Earlier", creative: "c2", created_time: "2026-09-30T09:00:00+0000" },
    ];
    const tie = groupMetaImportCreatives(
      bundle([creative("c1", AUTO, "1_1"), creative("c2", AUTO, "1_1")], ads),
    );
    assert.equal(tie.length, 1);
    assert.equal(tie[0]!.name, "Earlier");
    assert.equal(tie[0]!.representativeId, "c2");
    const majority = groupMetaImportCreatives(
      bundle(
        [creative("c1", AUTO, "1_1"), creative("c2", AUTO, "1_1"), creative("c3", AUTO, "1_1")],
        [...ads, { id: "a3", name: "Later", creative: "c3", created_time: "2026-09-30T13:00:00+0000" }],
      ),
    );
    assert.equal(majority[0]!.name, "Later");
  });

  it("existing posts group by story id, and each group keeps its ad sets", () => {
    const b = bundle(
      [creative("c1", AUTO, "1_1"), creative("c2", AUTO, "1_1"), creative("c3", AUTO, "1_2")],
      [
        { id: "a1", name: "Feed", creative: "c1", created_time: "2026-09-30T10:00:00+0000" },
        { id: "a2", name: "Feed", creative: "c2", created_time: "2026-09-30T11:00:00+0000" },
        { id: "a3", name: "Reel", creative: "c3", created_time: "2026-09-30T12:00:00+0000" },
      ],
    );
    const draft = mapMetaLiveCampaign({
      bundle: b,
      adAccountId: "act_1",
      carry: ["c1", "c3"],
      availability: [],
    });
    assert.deepEqual(draft.creatives.map((row) => [row.name, row.sourceType, row.existingPost?.postId]), [
      ["Feed", "existing_post", "1_1"],
      ["Reel", "existing_post", "1_2"],
    ]);
    assert.deepEqual(draft.creatives[0]!.importedMeta, {
      creativeIds: ["c1", "c2"],
      adIds: ["a1", "a2"],
      adSetIds: ["as1", "as2"],
    });
    assert.deepEqual(draft.creativeAssignments, { as1: ["c1", "c3"], as2: ["c1"] });
  });
});

describe("imported creative on reload", () => {
  it("migrateDraft keeps importedMeta and nameSource file", () => {
    const draft = importAll(gdsDuplicatedBundle());
    const reloaded = migrateDraft(JSON.parse(JSON.stringify(draft)) as Record<string, unknown>);
    assert.deepEqual(reloaded.creatives[0]!.importedMeta, draft.creatives[0]!.importedMeta);
    assert.equal(reloaded.creatives[0]!.nameSource, "file");
    assert.equal(reloaded.creatives[0]!.name, "GDS - Static – Copy");
  });
});
