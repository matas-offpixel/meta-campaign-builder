/**
 * The shape of campaign 120250869474230239 on act_1073273492854557 (Girls
 * Don't Sync, duplicated in Ads Manager on 30 Sep 2026 from our launch
 * 120250867045210239), read 7 Oct 2026. Ids, hashes and poster files are
 * stand-ins; the counts and the structure are the read's:
 *
 * - 16 ad sets, 77 ads, 77 AdCreative objects (one per ad), every object
 *   auto-named `<title> YYYY-MM-DD-<32 hex>`.
 * - Every object is `asset_feed_spec` with `object_story_spec`
 *   `{ page_id, instagram_user_id }`; every one has a resolvable asset.
 * - Static objects share two image hashes (feed + story). ES and GDS share
 *   the same two hashes and differ in copy and Instagram account.
 * - Every video entry has its own `video_id` (77 distinct ids). The poster
 *   file in `thumbnail_url` is shared within a creative.
 * - Ad names: ES - Static ×16, ES - Video ×16, GDS - Static ×1 +
 *   GDS - Static – Copy ×14, GDS - Video ×1 + GDS - Video – Copy ×14,
 *   GDS Video (With Text) ×15.
 */

import type { MetaLiveCampaignBundle } from "../types.ts";

export const GDS_CAMPAIGN_ID = "120250869474230239";
export const GDS_ACCOUNT = "act_1073273492854557";

const PAGE = "769954239540040";
const IG_ES = "17841477444707301";
const IG_GDS = "17841446423173902";
const FEED_HASH = "d891bb87b56ffd8e2a1d871cd9f8c14d";
const STORY_HASH = "1ba49be5381ed332dd3f499db8ebbbb2";
const LINK =
  "https://girlsdontsync-halloween.com/?ref=meta&utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{adset.name}}&utm_term={{ad.name}}&placement={{placement}}";

const ES_COPY = { bodies: [{ text: "Electric Studios. Halloween." }] };
const GDS_COPY = {
  bodies: [{ text: "Girls Don't Sync. Halloween." }],
  titles: [{ text: "Tickets on sale now" }],
};

function poster(file: string, n: number): string {
  return `https://scontent.xx.fbcdn.net/v/t15.5256-10/${file}?stp=dst-jpg&_nc_sid=${n}&oh=00_sig${n}`;
}

type Kind = "static" | "video" | "video_text";

function autoName(n: number): string {
  return `Girls Don't Sync · Electric Studios · Sat 31 Oct 2026-09-30-${n.toString(16).padStart(32, "0")}`;
}

function feedSpec(kind: Kind, copy: typeof ES_COPY | typeof GDS_COPY, n: number) {
  const base = {
    ...copy,
    call_to_action_types: ["LEARN_MORE"],
    link_urls: [{ website_url: LINK }],
    asset_customization_rules: [{}, {}],
  };
  if (kind === "static") {
    return {
      ...base,
      ad_formats: ["SINGLE_IMAGE"],
      images: [
        { hash: FEED_HASH, adlabels: [{ name: "feed_asset" }] },
        { hash: STORY_HASH, adlabels: [{ name: "story_asset" }] },
      ],
    };
  }
  if (kind === "video_text") {
    return {
      ...base,
      ad_formats: ["SINGLE_VIDEO"],
      videos: [
        {
          video_id: `9100${n}`,
          thumbnail_url: poster("828507125_1401958288809817_n.jpg", n),
          adlabels: [{ name: "feed_asset" }, { name: "story_asset" }],
        },
      ],
    };
  }
  return {
    ...base,
    ad_formats: ["SINGLE_VIDEO"],
    videos: [
      {
        video_id: `9200${n}`,
        thumbnail_url: poster("831155400_1104248188741602_n.jpg", n),
        adlabels: [{ name: "feed_asset" }],
      },
      {
        video_id: `9300${n}`,
        thumbnail_url: poster("831341712_2598913240535684_n.jpg", n),
        adlabels: [{ name: "story_asset" }],
      },
    ],
  };
}

/** [ad name, kind, brand, how many, first created_time] */
const PLAN: [string, Kind, "es" | "gds", number, string][] = [
  ["GDS - Static", "static", "gds", 1, "2026-09-30T16:32:32+0100"],
  ["GDS - Video", "video", "gds", 1, "2026-09-30T16:32:32+0100"],
  ["ES - Static", "static", "es", 16, "2026-09-30T16:34:07+0100"],
  ["ES - Video", "video", "es", 16, "2026-09-30T16:34:07+0100"],
  ["GDS - Static – Copy", "static", "gds", 14, "2026-09-30T16:34:07+0100"],
  ["GDS - Video – Copy", "video", "gds", 14, "2026-09-30T16:34:07+0100"],
  ["GDS Video (With Text)", "video_text", "gds", 15, "2026-10-05T13:28:57+0100"],
];

export function gdsDuplicatedBundle(): MetaLiveCampaignBundle {
  const adSets = Array.from({ length: 16 }, (_, i) => ({
    id: `2385000000000${String(i + 1).padStart(2, "0")}`,
    name: i === 0 ? "GDS Primary" : `Ad set ${i + 1}`,
    status: "ACTIVE",
  }));
  const ads: Record<string, unknown>[] = [];
  const creatives: MetaLiveCampaignBundle["creatives"] = {};
  let n = 0;
  for (const [adName, kind, brand, count, createdTime] of PLAN) {
    // The two originals sit in the first ad set; the copies fill the other 15.
    const offset = count === 1 ? 0 : count === 16 ? 0 : 1;
    for (let i = 0; i < count; i++) {
      n += 1;
      const creativeId = `1200000000${String(n).padStart(3, "0")}`;
      creatives[creativeId] = {
        id: creativeId,
        name: autoName(n),
        thumbnail_url: `https://external.xx.fbcdn.net/emg1/v/t13/${n}?url=x`,
        effective_object_story_id: `${PAGE}_${8800000 + n}`,
        object_story_spec: { page_id: PAGE, instagram_user_id: brand === "es" ? IG_ES : IG_GDS },
        asset_feed_spec: feedSpec(kind, brand === "es" ? ES_COPY : GDS_COPY, n),
      };
      ads.push({
        id: `1202508694${String(n).padStart(5, "0")}`,
        name: adName,
        adset_id: adSets[offset + i]!.id,
        campaign_id: GDS_CAMPAIGN_ID,
        status: "ACTIVE",
        creative: { id: creativeId },
        created_time: createdTime,
      });
    }
  }
  return {
    campaign: {
      id: GDS_CAMPAIGN_ID,
      account_id: GDS_ACCOUNT.replace("act_", ""),
      name: "[GDS-HALLOWEEN] Girls Don't Sync — Halloween",
      objective: "OUTCOME_SALES",
    },
    adSets,
    ads,
    creatives,
  };
}
