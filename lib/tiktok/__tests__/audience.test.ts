import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractAudienceRows,
  fetchTikTokBehaviourCategories,
  fetchTikTokCustomAudiences,
  fetchTikTokHashtagRecommendations,
  fetchTikTokHashtagsByIds,
  fetchTikTokInterestCategories,
  fetchTikTokInterestKeywordRecommendations,
  fetchTikTokInterestKeywordsByIds,
  fetchTikTokLanguages,
  fetchTikTokRegions,
  fetchTikTokSavedAudiences,
} from "../audience.ts";
import { settleAudienceDimension } from "../audience-settle.ts";
import { TikTokApiError } from "../client.ts";

describe("TikTok audience read helpers", () => {
  it("maps official interest_categories rows by name and sub_category_ids", async () => {
    const rows = await fetchTikTokInterestCategories({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(): Promise<T> =>
        ({
          interest_categories: [
            {
              interest_category_id: "10",
              interest_category_name: " Music",
              level: 1,
              sub_category_ids: ["10100"],
            },
            {
              interest_category_id: "10100",
              interest_category_name: "Dance",
              level: 2,
              sub_category_ids: [],
            },
          ],
        }) as T,
    });
    const music = rows.find((row) => row.id === "10");
    const dance = rows.find((row) => row.id === "10100");
    assert.equal(music?.label, "Music");
    assert.equal(music?.parent_id, null);
    assert.equal(dance?.label, "Dance");
    assert.equal(dance?.parent_id, "10");
  });

  it("maps hierarchical interest categories from /tool/interest_category/", async () => {
    const rows = await fetchTikTokInterestCategories({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(
        path: string,
        params: Record<string, unknown>,
      ): Promise<T> => {
        assert.equal(path, "/tool/interest_category/");
        assert.equal(params.advertiser_id, "advertiser-1");
        assert.equal(params.version, 2);
        assert.equal(params.language, "en");
        assert.equal(params.placements, undefined);
        return {
          list: [
            { category_id: "music", category_name: "Music" },
            {
              category_id: "festivals",
              category_name: "Festivals",
              parent_category_id: "music",
            },
          ],
        } as T;
      },
    });

    assert.deepEqual(rows, [
      { id: "festivals", label: "Festivals", parent_id: "music" },
      { id: "music", label: "Music", parent_id: null },
    ]);
  });

  it("maps behaviours from /tool/action_category/ without version or language", async () => {
    let captured: Record<string, unknown> | null = null;
    const behaviour = await fetchTikTokBehaviourCategories({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(path: string, params: Record<string, unknown>): Promise<T> => {
        assert.equal(path, "/tool/action_category/");
        captured = params;
        return { list: [{ action_category_id: "b1", category_name: "Creators" }] } as T;
      },
    });
    assert.deepEqual(captured, { advertiser_id: "advertiser-1" });
    assert.equal(behaviour[0].label, "Creators");
  });

  it("maps custom and saved audiences", async () => {
    const custom = await fetchTikTokCustomAudiences({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(): Promise<T> =>
        ({ list: [{ custom_audience_id: "c1", audience_name: "Site visitors" }] }) as T,
    });
    const saved = await fetchTikTokSavedAudiences({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(): Promise<T> =>
        ({ list: [{ saved_audience_id: "s1", name: "Lookalike 1" }] }) as T,
    });
    assert.equal(custom[0].id, "c1");
    assert.equal(saved[0].label, "Lookalike 1");

    const savedFromRealKey = await fetchTikTokSavedAudiences({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(): Promise<T> =>
        ({
          page_info: { page: 1 },
          saved_audiences: [{ saved_audience_id: "s2", name: " Lookalike 2" }],
        }) as T,
    });
    assert.equal(savedFromRealKey[0].id, "s2");
    assert.equal(savedFromRealKey[0].label, "Lookalike 2");
  });

  it("extracts keyword recommendations from recommended_keywords", async () => {
    const rows = await fetchTikTokInterestKeywordRecommendations({
      advertiserId: "advertiser-1",
      token: "token-1",
      keyword: "house",
      request: async <T,>(): Promise<T> =>
        ({
          recommended_keywords: [{ keyword_id: "k1", keyword: " house music" }],
        }) as T,
    });
    assert.equal(rows[0]?.id, "k1");
    assert.equal(rows[0]?.name, "house music");
  });

  it("extracts keyword recommendations from each plausible key", async () => {
    for (const key of [
      "list",
      "keywords",
      "keyword_list",
      "interest_keywords",
      "recommend_list",
    ]) {
      const rows = await fetchTikTokInterestKeywordRecommendations({
        advertiserId: "advertiser-1",
        token: "token-1",
        keyword: "house",
        mode: "SEMANTIC_RECOMMEND",
        audienceType: "GENERAL_INTEREST",
        request: async <T,>(path: string, params: Record<string, unknown>): Promise<T> => {
          assert.equal(path, "/tool/interest_keyword/recommend/");
          assert.equal(params.keyword, "house");
          assert.equal(params.mode, "SEMANTIC_RECOMMEND");
          assert.equal(params.audience_type, "GENERAL_INTEREST");
          assert.equal(params.limit, 50);
          return { [key]: [{ keyword_id: "k1", keyword: "house music" }] } as T;
        },
      });
      assert.equal(rows[0]?.id, "k1", key);
      assert.equal(rows[0]?.name, "house music", key);
    }
  });

  it("returns [] for an unknown keyword recommend shape", async () => {
    const rows = await fetchTikTokInterestKeywordRecommendations({
      advertiserId: "advertiser-1",
      token: "token-1",
      keyword: "house",
      request: async <T,>(): Promise<T> => ({ unexpected: { foo: 1 } }) as T,
    });
    assert.deepEqual(rows, []);
  });

  it("caps hashtag keywords at 10 and sends operator", async () => {
    const keywords = Array.from({ length: 12 }, (_, index) => `kw${index + 1}`);
    let captured: Record<string, unknown> | null = null;
    const rows = await fetchTikTokHashtagRecommendations({
      advertiserId: "advertiser-1",
      token: "token-1",
      keywords,
      operator: "OR",
      request: async <T,>(path: string, params: Record<string, unknown>): Promise<T> => {
        assert.equal(path, "/tool/hashtag/recommend/");
        captured = params;
        return {
          hashtags: [{ keyword_id: "h1", hashtag: "housemusic" }],
        } as T;
      },
    });
    assert.equal((captured?.keywords as string[]).length, 10);
    assert.equal(captured?.operator, "OR");
    assert.equal(rows[0].id, "h1");
  });

  it("gets hashtags by keyword_ids", async () => {
    const rows = await fetchTikTokHashtagsByIds({
      advertiserId: "advertiser-1",
      token: "token-1",
      keywordIds: ["h1", "h2"],
      request: async <T,>(path: string, params: Record<string, unknown>): Promise<T> => {
        assert.equal(path, "/tool/hashtag/get/");
        assert.deepEqual(params.keyword_ids, ["h1", "h2"]);
        return { list: [{ id: "h1", name: "house" }] } as T;
      },
    });
    assert.equal(rows[0].id, "h1");
  });

  it("gets interest keywords by ids from /tool/interest_keyword/get/", async () => {
    const ids = await fetchTikTokInterestKeywordsByIds({
      advertiserId: "advertiser-1",
      token: "token-1",
      keywordIds: ["kw-live", "kw-dead"],
      request: async <T,>(path: string, params: Record<string, unknown>): Promise<T> => {
        assert.equal(path, "/tool/interest_keyword/get/");
        assert.deepEqual(params.keyword_ids, ["kw-live", "kw-dead"]);
        return {
          interest_keywords: [{ keyword_id: "kw-live", keyword: "house" }],
        } as T;
      },
    });
    assert.deepEqual([...ids], ["kw-live"]);
  });

  it("maps /tool/interest_keyword/get/ rows from keyword_list", async () => {
    const ids = await fetchTikTokInterestKeywordsByIds({
      advertiserId: "advertiser-1",
      token: "token-1",
      keywordIds: ["kw-live"],
      request: async <T,>(): Promise<T> =>
        ({
          keyword_list: [{ keyword_id: "kw-live", keyword: "house" }],
        }) as T,
    });
    assert.deepEqual([...ids], ["kw-live"]);
  });

  it("falls back to /tool/hashtag/get/ when interest_keyword/get/ is unavailable", async () => {
    const paths: string[] = [];
    const ids = await fetchTikTokInterestKeywordsByIds({
      advertiserId: "advertiser-1",
      token: "token-1",
      keywordIds: ["kw-1"],
      request: async <T,>(path: string): Promise<T> => {
        paths.push(path);
        if (path === "/tool/interest_keyword/get/") {
          throw new TikTokApiError("path not found", 40002, "req-1", 404);
        }
        assert.equal(path, "/tool/hashtag/get/");
        return { list: [{ keyword_id: "kw-1", keyword: "house" }] } as T;
      },
    });
    assert.deepEqual(paths, [
      "/tool/interest_keyword/get/",
      "/tool/hashtag/get/",
    ]);
    assert.ok(ids.has("kw-1"));
  });

  it("loads regions from /search/region/ and languages from /tool/language/", async () => {
    const regions = await fetchTikTokRegions({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(path: string, params: Record<string, unknown>): Promise<T> => {
        assert.equal(path, "/search/region/");
        assert.equal(params.language, "en");
        return {
          regions: [{ location_id: "2635167", name: "United Kingdom", country_code: "GB" }],
        } as T;
      },
    });
    const languages = await fetchTikTokLanguages({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(path: string): Promise<T> => {
        assert.equal(path, "/tool/language/");
        return { languages: [{ language_code: "en", name: "English" }] } as T;
      },
    });
    assert.equal(regions[0].id, "2635167");
    assert.equal(languages[0].id, "en");

    const regionsFromRealKey = await fetchTikTokRegions({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(): Promise<T> =>
        ({
          region_list: [
            { location_id: "2635167", name: " United Kingdom", country_code: "GB" },
          ],
        }) as T,
    });
    assert.equal(regionsFromRealKey[0].id, "2635167");
    assert.equal(regionsFromRealKey[0].name, "United Kingdom");
  });

  it("logs mapped row count alongside raw envelope counts", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(String(args[0]));
    };
    try {
      await fetchTikTokInterestCategories({
        advertiserId: "advertiser-1",
        token: "token-1",
        request: async <T,>(): Promise<T> =>
          ({
            list: [
              { category_id: "music", category_name: "Music" },
              { not_an_id: true },
            ],
          }) as T,
      });
    } finally {
      console.error = original;
    }
    const line = lines.find((entry) => entry.includes("[tiktok/audience]"));
    assert.ok(line, "expected an envelope log line");
    assert.match(line, /counts=\{list:2/);
    assert.match(line, /mapped=1/);
    assert.match(line, /rowKeys=\[category_id,category_name\]/);
    assert.equal(line.includes("Music"), false);
  });

  it("logs first-row keys only, never row values", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(String(args[0]));
    };
    try {
      await fetchTikTokSavedAudiences({
        advertiserId: "advertiser-1",
        token: "token-1",
        request: async <T,>(): Promise<T> =>
          ({
            saved_audiences: [
              {
                saved_audience_id: "s1",
                name: "alice@example.com",
                secret_email: "alice@example.com",
              },
            ],
          }) as T,
      });
    } finally {
      console.error = original;
    }
    const line = lines.find((entry) => entry.includes("[tiktok/audience]"));
    assert.ok(line, "expected an envelope log line");
    assert.match(
      line,
      /rowKeys=\[saved_audience_id,name,secret_email\]/,
    );
    assert.equal(line.includes("alice@example.com"), false);
    assert.equal(line.includes("s1"), false);
  });

  it("trims inconsistently padded TikTok labels", async () => {
    const languages = await fetchTikTokLanguages({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(): Promise<T> =>
        ({ languages: [{ language_code: "nl", name: " Dutch" }] }) as T,
    });
    assert.equal(languages[0].name, "Dutch");
  });

  it("extractAudienceRows falls back to [] on unknown shapes", () => {
    assert.deepEqual(extractAudienceRows(null, ["list"]), []);
    assert.deepEqual(extractAudienceRows({ foo: 1 }, ["list", "keywords"]), []);
    assert.deepEqual(extractAudienceRows({ keywords: [{ id: "1" }] }, ["list", "keywords"]), [
      { id: "1" },
    ]);
  });

  it("a throwing dimension does not prevent the others from returning", async () => {
    const interests = await settleAudienceDimension(async () => {
      throw new Error("interests 404");
    }, []);
    const behaviours = await settleAudienceDimension(async () => {
      return [{ id: "b1", label: "Creators", parent_id: null }];
    }, []);
    assert.equal(interests.failed, true);
    assert.deepEqual(interests.value, []);
    assert.equal(behaviours.failed, false);
    assert.equal(behaviours.value[0]?.id, "b1");
  });
});
