import { classifyTikTokCampaign } from "./types.ts";
import type {
  TikTokAdGetRow,
  TikTokAdGroupGetRow,
  TikTokCampaignGetRow,
  TikTokImportLibraryVideo,
  TikTokImportLiveBundle,
  TikTokSmartPlusAdRow,
  TikTokSpcGetRow,
} from "./readers.ts";

type RawCall = {
  path?: string;
  data?: {
    list?: unknown[];
    page_info?: { page?: number; total_page?: number; total_number?: number };
  } | null;
};

/**
 * Rebuild a `TikTokImportLiveBundle` from a raw-route capture.
 *
 * CAPTURED 2026-09-15, advertiser 7639802149165301776, operator session,
 * deployed #945. Library rows had `preview_url`, `video_cover_url`,
 * `signature`, `preview_url_expire_time` removed (signed, expiring);
 * every other key is verbatim.
 *
 * VERIFIED: documented `/smart_plus/ad/get/` shape;
 * `smart_plus_creative_id === /ad/get/ ad_id` on 45/45;
 * `/ad/get/` omits empty keys (no `is_aco` on Smart+);
 * library `page_info` present (122 videos, 2 pages);
 * `/adgroup/get/` accepts the 35-name field list.
 *
 * FALSIFIED: `video_id` in `/file/video/ad/search/` ⇔ an original the
 * operator uploaded. TikTok writes variants into the library
 * (`create_time` 2026-09-12) and nine inline-uploaded originals are
 * absent. Prefer a library `video_id` when two copies share a stem —
 * an inline-upload id referenced from a new ad is unknown until a
 * launch tries it.
 */
export function bundleFromRawCapture(raw: unknown): TikTokImportLiveBundle {
  const record = raw as {
    campaignId?: string;
    calls?: RawCall[];
  };
  const calls = record.calls ?? [];
  const lists = (path: string): unknown[] =>
    calls
      .filter((call) => call.path === path)
      .flatMap((call) => (Array.isArray(call.data?.list) ? call.data!.list! : []));

  const campaigns = lists("/campaign/get/") as TikTokCampaignGetRow[];
  const campaign =
    campaigns.find((row) => row.campaign_id === record.campaignId) ?? campaigns[0];
  if (!campaign?.campaign_id) {
    throw new Error("capture has no /campaign/get/ row");
  }
  const kind = classifyTikTokCampaign(campaign);
  const libraryVideos = (lists("/file/video/ad/search/") as Array<Record<string, unknown>>)
    .map(libraryVideoFromRow)
    .filter((row): row is TikTokImportLibraryVideo => Boolean(row));
  const libraryVideoIds = libraryVideos.map((row) => row.video_id);

  if (kind === "legacy_smart_plus") {
    const spc = (lists("/campaign/spc/get/")[0] ?? null) as TikTokSpcGetRow | null;
    return {
      kind,
      campaign,
      adGroups: [],
      ads: [],
      smartPlusAds: [],
      spc,
      libraryVideoIds,
      libraryVideos,
    };
  }

  if (kind === "smart_plus") {
    return {
      kind,
      campaign,
      adGroups: lists("/smart_plus/adgroup/get/") as TikTokAdGroupGetRow[],
      ads: lists("/ad/get/") as TikTokAdGetRow[],
      smartPlusAds: lists("/smart_plus/ad/get/") as TikTokSmartPlusAdRow[],
      spc: null,
      libraryVideoIds,
      libraryVideos,
    };
  }

  return {
    kind,
    campaign,
    adGroups: lists("/adgroup/get/") as TikTokAdGroupGetRow[],
    ads: lists("/ad/get/") as TikTokAdGetRow[],
    smartPlusAds: [],
    spc: null,
    libraryVideoIds,
    libraryVideos,
  };
}

function libraryVideoFromRow(
  row: Record<string, unknown>,
): TikTokImportLibraryVideo | null {
  const videoId = typeof row.video_id === "string" ? row.video_id.trim() : "";
  if (!videoId) return null;
  return {
    video_id: videoId,
    file_name: typeof row.file_name === "string" ? row.file_name : null,
    duration: typeof row.duration === "number" ? row.duration : null,
    width: typeof row.width === "number" ? row.width : null,
    height: typeof row.height === "number" ? row.height : null,
    video_cover_url:
      typeof row.video_cover_url === "string" ? row.video_cover_url : null,
  };
}
