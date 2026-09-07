import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  fetchTikTokSparkPosts,
  formatTikTokSparkAuthExpired,
  isTikTokSparkAuthExpired,
  sparkPostPreviewCause,
  TIKTOK_SPARK_POST_COPY,
  TIKTOK_SPARK_POSTS_PATH,
} from "../spark-posts.ts";

const LIVE_ROW = {
  user_info: {
    tiktok_name: "nxloves",
    identity_id: "auth-identity-1",
    identity_type: "AUTH_CODE",
  },
  item_info: {
    item_id: "7540693385208872978",
    text: "Folamour in the room",
    status: "HESITATE_RECOMMEND",
    item_type: "VIDEO",
    auth_code: "code-1",
    carousel_info: null,
    anchor_list: [],
  },
  auth_info: {
    ad_auth_status: "AUTHORIZED",
    auth_start_time: "2025-11-18 14:39:06",
    auth_end_time: "2026-11-18 14:39:06",
    invite_start_time: "2025-11-18 14:39:06",
  },
  video_info: {
    duration: 55.667,
    preview_url: "https://cdn.example/preview.mp4",
    poster_url: "https://cdn.example/poster.jpg",
    bit_rate: 1,
    height: 1920,
    width: 1080,
    signature: "abc",
    size: 100,
  },
};

describe("fetchTikTokSparkPosts", () => {
  it("lists VIDEO spark posts on the confirmed path", async () => {
    const result = await fetchTikTokSparkPosts({
      advertiserId: "advertiser-1",
      token: "token-1",
      page: 1,
      pageSize: 20,
      now: new Date("2026-09-07T21:00:00.000Z"),
      request: async <T,>(path: string, params: Record<string, unknown>): Promise<T> => {
        assert.equal(path, TIKTOK_SPARK_POSTS_PATH);
        assert.equal(path, "/tt_video/list/");
        assert.deepEqual(params, {
          advertiser_id: "advertiser-1",
          item_types: ["VIDEO"],
          page: 1,
          page_size: 20,
        });
        return {
          list: [LIVE_ROW],
          page_info: { page: 1, page_size: 20, total_number: 1, total_page: 1 },
        } as T;
      },
    });
    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0]!.item_id, "7540693385208872978");
    assert.equal(result.posts[0]!.identity_type, "AUTH_CODE");
    assert.equal(result.posts[0]!.identity_id, "auth-identity-1");
    assert.equal(result.posts[0]!.text, "Folamour in the room");
    assert.equal(result.posts[0]!.poster_url, "https://cdn.example/poster.jpg");
    assert.equal(result.totalNumber, 1);
  });

  it("treats an empty list as empty, not a failed path", async () => {
    const result = await fetchTikTokSparkPosts({
      advertiserId: "empty",
      token: "token-1",
      request: async <T,>(path: string): Promise<T> => {
        assert.equal(path, "/tt_video/list/");
        return {
          list: [],
          page_info: { page: 1, page_size: 20, total_number: 0, total_page: 0 },
        } as T;
      },
    });
    assert.deepEqual(result.posts, []);
    assert.equal(result.totalNumber, 0);
  });

  it("drops carousel rows even if the API returns one", async () => {
    const result = await fetchTikTokSparkPosts({
      advertiserId: "adv",
      token: "token",
      request: async <T,>(): Promise<T> =>
        ({
          list: [
            {
              ...LIVE_ROW,
              item_info: { ...LIVE_ROW.item_info, item_id: "carousel-1", item_type: "CAROUSEL" },
            },
            LIVE_ROW,
          ],
          page_info: { page: 1, page_size: 20, total_number: 2, total_page: 1 },
        }) as T,
    });
    assert.deepEqual(
      result.posts.map((post) => post.item_id),
      ["7540693385208872978"],
    );
  });
});

describe("Spark post states", () => {
  it("disables a post past auth_end_time and names the date", () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    assert.equal(
      isTikTokSparkAuthExpired(
        { ad_auth_status: "EXPIRED", auth_end_time: "2025-05-29 15:29:20" },
        now,
      ),
      true,
    );
    assert.equal(
      formatTikTokSparkAuthExpired("2022-07-22 11:26:45"),
      "authorisation expired 22 Jul",
    );
  });

  it("names an empty preview as not public when auth is still live", () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    assert.equal(
      sparkPostPreviewCause(
        {
          status: "ONLY_AUTHOR_SEE",
          preview_url: null,
          ad_auth_status: "AUTHORIZED",
          auth_end_time: "2026-11-18 14:39:06",
        },
        now,
      ),
      "not_public",
    );
  });
});

describe("source-guards — TikTok spark post picker", () => {
  it("lists posts through the session advertiser, never advertiser_ids[0]", () => {
    const route = readFileSync("app/api/tiktok/creative/spark-posts/route.ts", "utf8");
    assert.match(route, /readTikTokAccountCredentials/);
    assert.match(route, /fetchTikTokSparkPosts/);
    assert.doesNotMatch(route, /advertiser_ids\[0\]/);
    const helper = readFileSync("lib/tiktok/spark-posts.ts", "utf8");
    assert.match(helper, /\/tt_video\/list\//);
    assert.match(helper, /\["VIDEO"\]/);
    assert.doesNotMatch(helper, /CAROUSEL/);
    assert.doesNotMatch(helper, /tt_video\/authorize/);
  });

  it("surfaces choose-from-feed and the empty-authorisation sentence on both creatives mounts", () => {
    const creatives = readFileSync(
      "components/tiktok-wizard/steps/creatives.tsx",
      "utf8",
    );
    assert.match(creatives, /TikTokSparkPostPicker/);
    const drawer = readFileSync("components/plan/tiktok-drawer.tsx", "utf8");
    assert.match(drawer, /CreativesStep/);
    const picker = readFileSync(
      "components/tiktok-wizard/tiktok-spark-post-picker.tsx",
      "utf8",
    );
    assert.equal(TIKTOK_SPARK_POST_COPY.choose, "choose a post from the feed");
    assert.equal(
      TIKTOK_SPARK_POST_COPY.empty,
      "no authorised posts on this account — authorise one in TikTok Ads Manager first",
    );
    assert.match(picker, /TIKTOK_SPARK_POST_COPY\.empty/);
    assert.match(picker, /TIKTOK_SPARK_POST_COPY\.notPublic/);
  });
});
