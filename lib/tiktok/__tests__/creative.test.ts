import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractTikTokVideoId,
  fetchTikTokVideoInfo,
  nameCreativeVariations,
} from "../creative.ts";

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

  it("maps TikTok video info responses", async () => {
    const videos = await fetchTikTokVideoInfo({
      advertiserId: "advertiser-1",
      token: "token-1",
      videoIds: ["v1"],
      request: async <T,>(path, params): Promise<T> => {
        assert.equal(path, "/file/video/ad/info/");
        assert.deepEqual(params.video_ids, ["v1"]);
        return {
          list: [
            {
              video_id: "v1",
              thumbnail_url: "https://example.com/thumb.jpg",
              duration: 12,
              title: "Hero video",
            },
          ],
        } as T;
      },
    });

    assert.deepEqual(videos, [
      {
        video_id: "v1",
        thumbnail_url: "https://example.com/thumb.jpg",
        duration_seconds: 12,
        title: "Hero video",
      },
    ]);
  });
});
