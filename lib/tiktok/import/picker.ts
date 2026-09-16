import { fetchTikTokVideoInfo } from "../creative.ts";
import { TikTokApiError, tiktokGet } from "../client.ts";
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

export type TikTokImportPickerRowKind = "video" | "spark";

/**
 * Provenance of a picker row. There is no third origin for ads TikTok
 * added on its own: no documented split would assign one, and a dead
 * union member invites the label back without the rule. Unmatched
 * `/ad/get/` rows stay `"unjoined"`.
 */
export type TikTokImportPickerRowOrigin = "chosen" | "unjoined";

export type TikTokImportPickerRow = {
  /** `video_id` or `tiktok_item_id` — the key `POST …/import` `carry` sends. */
  key: string;
  kind: TikTokImportPickerRowKind;
  origin: TikTokImportPickerRowOrigin;
  name: string;
  thumbnailUrl: string | null;
  thumbnailError: boolean;
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
  /**
   * `/ad/get/` rows that matched no `creative_list` row on any of the
   * three join keys. Always counted. Shown once each; not a carry
   * decision.
   */
  unjoined: number;
  /** `creative_list` rows that matched an `/ad/get/` row. */
  chosenJoined: number;
  /** Every `creative_list` row TikTok reported as explicitly selected. */
  chosenTotal: number;
};

/** Same batch size as `fetchVideoInfo` in `lib/tiktok/share-render.ts`. */
export const TIKTOK_IMPORT_VIDEO_INFO_CHUNK = 60;

export const TIKTOK_IMPORT_VIDEO_INFO_PATH = "/file/video/ad/info/";

export function formatTikTokImportUnjoinedLine(unjoined: number): string | null {
  if (unjoined <= 0) return null;
  return `${unjoined} source ads could not be matched to a creative TikTok says you selected — shown once each`;
}

/**
 * When TikTok's selected set and the `/ad/get/` join disagree, say so
 * with both numbers. That is the header; the row's `origin` is the
 * per-row claim.
 */
export function formatTikTokImportJoinLine(
  chosenJoined: number,
  chosenTotal: number,
): string | null {
  if (chosenTotal <= 0) return null;
  if (chosenJoined === chosenTotal) return null;
  return `${chosenJoined} of ${chosenTotal} creatives TikTok says you selected matched a source ad`;
}

export function formatTikTokImportRowOriginBadge(
  origin: TikTokImportPickerRowOrigin,
): string | null {
  if (origin !== "unjoined") return null;
  return "TikTok couldn't confirm you selected this";
}

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

/**
 * TikTok's parameter-validation error on this endpoint: one member of
 * `video_ids` is not a video TikTok will describe. That is the only
 * failure that is about an id, so it is the only one that splits.
 * Message match keeps the existing tests (a plain Error with
 * "not acceptable"); 40002 is the live code for the same shape.
 */
function isUnacceptableVideoIdError(err: unknown): boolean {
  if (err instanceof TikTokApiError && err.code === 40002) return true;
  const message = err instanceof Error ? err.message : "";
  return /not acceptable/i.test(message);
}

async function loadVideoInfoChunk(input: {
  chunk: readonly string[];
  advertiserId: string;
  token: string;
  request?: TikTokGet;
  byId: Map<string, { thumbnail_url: string | null }>;
  failed: Set<string>;
  retried?: boolean;
}): Promise<"ok" | "abandoned"> {
  if (input.chunk.length === 0) return "ok";
  try {
    const info = await fetchTikTokVideoInfo({
      advertiserId: input.advertiserId,
      token: input.token,
      videoIds: [...input.chunk],
      request: input.request,
    });
    for (const row of info) {
      input.byId.set(row.video_id, { thumbnail_url: row.thumbnail_url });
    }
    return "ok";
  } catch (err) {
    if (isUnacceptableVideoIdError(err)) {
      if (input.chunk.length === 1) {
        input.failed.add(input.chunk[0]!);
        return "ok";
      }
      const mid = Math.floor(input.chunk.length / 2);
      const left = await loadVideoInfoChunk({
        ...input,
        chunk: input.chunk.slice(0, mid),
        retried: false,
      });
      if (left === "abandoned") return "abandoned";
      return loadVideoInfoChunk({
        ...input,
        chunk: input.chunk.slice(mid),
        retried: false,
      });
    }
    if (!input.retried) {
      return loadVideoInfoChunk({ ...input, retried: true });
    }
    return "abandoned";
  }
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
        // A blocked row's `key` is the `/ad/get/` ad_id, not a video_id.
        // Posting it here cannot resolve, and "thumbnail unavailable" would
        // read as a fetch that failed when the row has no video.
        .filter((row) => row.kind === "video" && !row.disabled && !row.thumbnailUrl)
        .map((row) => row.key),
    ),
  ];
  if (videoIds.length === 0) return input.rows;

  const byId = new Map<string, { thumbnail_url: string | null }>();
  const failed = new Set<string>();
  for (let i = 0; i < videoIds.length; i += TIKTOK_IMPORT_VIDEO_INFO_CHUNK) {
    const result = await loadVideoInfoChunk({
      chunk: videoIds.slice(i, i + TIKTOK_IMPORT_VIDEO_INFO_CHUNK),
      advertiserId: input.advertiserId,
      token: input.token,
      request: input.request,
      byId,
      failed,
    });
    if (result === "abandoned") break;
  }

  return input.rows.map((row) => {
    if (row.thumbnailUrl) return row;
    if (failed.has(row.key)) {
      return { ...row, thumbnailUrl: null, thumbnailError: true };
    }
    const hit = byId.get(row.key);
    if (!hit?.thumbnail_url) return row;
    return { ...row, thumbnailUrl: hit.thumbnail_url, thumbnailError: false };
  });
}
