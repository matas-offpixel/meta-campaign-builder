import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  extractTikTokVideoId,
  fetchTikTokVideoInfo,
  fetchTikTokVideoLibrary,
  nameCreativeVariations,
  TIKTOK_VIDEO_LIBRARY_COPY,
  TIKTOK_VIDEO_LIBRARY_PATH,
} from "../creative.ts";
import { IRONWORKS_VIDEO_AD_INFO_ROW } from "./captured-ironworks-2026-09-10.ts";

describe("TikTok creative helpers", () => {
  it("extracts video ids from URLs and raw ids", () => {
    assert.equal(extractTikTokVideoId("735123456789"), "735123456789");
    assert.equal(
      extractTikTokVideoId("https://www.tiktok.com/@brand/video/735123456789"),
      "735123456789",
    );
    assert.equal(
      extractTikTokVideoId("https://example.com/?video_id=abc_123"),
      "abc_123",
    );
    assert.equal(extractTikTokVideoId("not a url"), null);
  });

  it("auto-suffixes creative variation names", () => {
    assert.deepEqual(nameCreativeVariations("Hero", 3), [
      "Hero · v1",
      "Hero · v2",
      "Hero · v3",
    ]);
  });

  it("maps the captured Ironworks /file/video/ad/info/ row", async () => {
    assert.equal("thumbnail_url" in IRONWORKS_VIDEO_AD_INFO_ROW, false);
    const videos = await fetchTikTokVideoInfo({
      advertiserId: "7639802149165301776",
      token: "token-1",
      videoIds: [IRONWORKS_VIDEO_AD_INFO_ROW.video_id],
      request: async <T,>(
        path: string,
        params: Record<string, unknown>,
      ): Promise<T> => {
        assert.equal(path, "/file/video/ad/info/");
        assert.deepEqual(params.video_ids, [
          IRONWORKS_VIDEO_AD_INFO_ROW.video_id,
        ]);
        return { list: [IRONWORKS_VIDEO_AD_INFO_ROW] } as T;
      },
    });

    assert.deepEqual(videos, [
      {
        video_id: IRONWORKS_VIDEO_AD_INFO_ROW.video_id,
        thumbnail_url: IRONWORKS_VIDEO_AD_INFO_ROW.video_cover_url,
        preview_url_expire_time:
          IRONWORKS_VIDEO_AD_INFO_ROW.preview_url_expire_time,
        duration_seconds: IRONWORKS_VIDEO_AD_INFO_ROW.duration,
        title: IRONWORKS_VIDEO_AD_INFO_ROW.file_name,
      },
    ]);
  });

  it("searches the confirmed ad video library path with paging", async () => {
    const result = await fetchTikTokVideoLibrary({
      advertiserId: "advertiser-1",
      token: "token-1",
      page: 2,
      pageSize: 20,
      request: async <T,>(
        path: string,
        params: Record<string, unknown>,
      ): Promise<T> => {
        assert.equal(path, TIKTOK_VIDEO_LIBRARY_PATH);
        assert.equal(path, "/file/video/ad/search/");
        assert.deepEqual(params, {
          advertiser_id: "advertiser-1",
          page: 2,
          page_size: 20,
        });
        return {
          list: [
            {
              video_id: "v9",
              video_cover_url: "https://example.com/cover.jpg",
              preview_url: "https://example.com/preview.mp4",
              preview_url_expire_time: 1_800_000_000,
              duration: 18,
              file_name: "hero.mp4",
            },
          ],
          page_info: {
            page: 2,
            page_size: 20,
            total_number: 169,
            total_page: 9,
          },
        } as T;
      },
    });

    assert.deepEqual(result, {
      videos: [
        {
          video_id: "v9",
          thumbnail_url: "https://example.com/cover.jpg",
          preview_url_expire_time: 1_800_000_000,
          duration_seconds: 18,
          title: "hero.mp4",
        },
      ],
      page: 2,
      pageSize: 20,
      totalNumber: 169,
      totalPage: 9,
    });
  });

  it("treats an empty library list as empty, not a failed path", async () => {
    const result = await fetchTikTokVideoLibrary({
      advertiserId: "advertiser-empty",
      token: "token-1",
      request: async <T,>(path: string): Promise<T> => {
        assert.equal(path, "/file/video/ad/search/");
        return {
          list: [],
          page_info: {
            page: 1,
            page_size: 20,
            total_number: 0,
            total_page: 0,
          },
        } as T;
      },
    });
    assert.deepEqual(result.videos, []);
    assert.equal(result.totalNumber, 0);
  });
});

describe("source-guards — TikTok video library picker", () => {
  it("lists videos through the session advertiser, never advertiser_ids[0]", () => {
    const route = readFileSync("app/api/tiktok/creative/videos/route.ts", "utf8");
    assert.match(route, /readTikTokAccountCredentials/);
    assert.match(route, /fetchTikTokVideoLibrary/);
    assert.doesNotMatch(route, /advertiser_ids\[0\]/);
    const helper = readFileSync("lib/tiktok/creative.ts", "utf8");
    assert.match(helper, /\/file\/video\/ad\/search\//);
    assert.doesNotMatch(helper, /identity\/video\/get/);
  });

  it("surfaces choose-from-account and the empty-library sentence", () => {
    const creatives = readFileSync(
      "components/tiktok-wizard/steps/creatives.tsx",
      "utf8",
    );
    assert.match(creatives, /TikTokVideoLibrary/);
    assert.match(creatives, /variationCount: 1/);
    const picker = readFileSync(
      "components/tiktok-wizard/tiktok-video-library.tsx",
      "utf8",
    );
    assert.match(picker, /TIKTOK_VIDEO_LIBRARY_COPY/);
    assert.match(picker, /page_size/);
    assert.equal(TIKTOK_VIDEO_LIBRARY_COPY.choose, "choose from this account");
    assert.equal(
      TIKTOK_VIDEO_LIBRARY_COPY.empty,
      "no videos in this account yet — upload one above",
    );
    assert.match(picker, /TIKTOK_VIDEO_LIBRARY_COPY\.empty/);
  });
});
