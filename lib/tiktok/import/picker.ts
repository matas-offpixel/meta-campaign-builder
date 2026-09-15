import { fetchTikTokVideoInfo } from "../creative.ts";
import { tiktokGet } from "../client.ts";
import type { TikTokLiveCampaignKind, TikTokImportNotCarriedReason } from "./types.ts";

type TikTokGet = typeof tiktokGet;

/**
 * Names TikTok writes onto creatives it generated. Evidence: Ironworks
 * advertiser 7639802149165301776, capture
 * `tiktok-import-capture-1876044101888033.json`, 2026-09-15.
 *
 * The remix ids on the wire are `v10033g50000da2tkln…_1200101-N`, not
 * digit-only after `g` — the last pattern follows the capture, not the
 * sketch `^v\d{5}g\d+_\d+-\d+$`.
 *
 * A match is a suggestion. It never removes a row from the picker.
 */
export const TIKTOK_IMPORT_GENERATED_NAME_PATTERNS: readonly {
  id: string;
  source: string;
  test: RegExp;
}[] = [
  {
    id: "ai_generated_video",
    source: "^AI Generated Video-\\d+",
    test: /^AI Generated Video-\d+/,
  },
  {
    id: "music_refresh",
    source: "-Music_Refresh-\\d+-\\d+",
    test: /-Music_Refresh-\d+-\d+/,
  },
  {
    id: "new_hook",
    source: "-New_Hook-\\d+-\\d+",
    test: /-New_Hook-\d+-\d+/,
  },
  {
    id: "auto_carousel",
    source: "^auto carousel generation_",
    test: /^auto carousel generation_/,
  },
  {
    id: "remix_cut",
    source: "^v\\d{5}g[0-9a-z]+_\\d+-\\d+$",
    test: /^v\d{5}g[0-9a-z]+_\d+-\d+$/,
  },
];

export function matchTikTokGeneratedName(stem: string): string | null {
  for (const pattern of TIKTOK_IMPORT_GENERATED_NAME_PATTERNS) {
    if (pattern.test.test(stem)) return pattern.id;
  }
  return null;
}

/**
 * `ad_name` with the trailing `_<asset group ad_name>` removed.
 * Longest group name first so `Feed : JJ` does not leave a suffix.
 */
export function stemFromAdName(
  adName: string,
  assetGroupNames: readonly string[],
): string {
  const sorted = [...assetGroupNames].sort((a, b) => b.length - a.length);
  for (const group of sorted) {
    const suffix = `_${group}`;
    if (adName.endsWith(suffix) && adName.length > suffix.length) {
      return adName.slice(0, -suffix.length);
    }
  }
  return adName;
}

export type TikTokImportPickerRow = {
  /** `video_id` or `tiktok_item_id` — the key `POST …/import` `carry` sends. */
  key: string;
  name: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  assetGroups: string[];
  copies: number;
  inLibrary: boolean;
  defaultTicked: boolean;
  disabled: boolean;
  suggestionReason: string | null;
  unsupportedReason: TikTokImportNotCarriedReason | null;
  suggestionLabel: string | null;
};

export type TikTokImportPickerPayload = {
  campaign: {
    id: string;
    name: string;
    kind: TikTokLiveCampaignKind;
  };
  rows: TikTokImportPickerRow[];
};

export function defaultCarryKeys(
  picker: TikTokImportPickerPayload,
): string[] {
  return picker.rows.filter((row) => row.defaultTicked && !row.disabled).map((row) => row.key);
}

export function suggestionLabelFor(
  row: Pick<TikTokImportPickerRow, "disabled" | "unsupportedReason" | "suggestionReason">,
): string | null {
  if (row.disabled && row.unsupportedReason === "unsupported_ad_format") {
    return "carousel — no draft equivalent";
  }
  if (row.disabled && row.unsupportedReason === "image_ad_unsupported") {
    return "image ad — the TikTok draft has no image creative mode";
  }
  if (row.disabled && row.unsupportedReason === "no_asset_reported") {
    return "TikTok reported no video, image or post";
  }
  if (row.suggestionReason) {
    return "looks TikTok-generated — untick suggested, not decided";
  }
  return null;
}

export async function hydratePickerThumbnails(input: {
  rows: TikTokImportPickerRow[];
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokImportPickerRow[]> {
  const videoIds = [
    ...new Set(
      input.rows
        .filter((row) => !row.thumbnailUrl && row.key.startsWith("v"))
        .map((row) => row.key),
    ),
  ];
  if (videoIds.length === 0) return input.rows;
  const info = await fetchTikTokVideoInfo({
    advertiserId: input.advertiserId,
    token: input.token,
    videoIds,
    request: input.request,
  });
  const byId = new Map(info.map((row) => [row.video_id, row]));
  return input.rows.map((row) => {
    if (row.thumbnailUrl) return row;
    const hit = byId.get(row.key);
    if (!hit?.thumbnail_url) return row;
    return { ...row, thumbnailUrl: hit.thumbnail_url };
  });
}
