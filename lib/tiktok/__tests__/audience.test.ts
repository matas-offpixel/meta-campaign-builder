import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchTikTokBehaviourCategories,
  fetchTikTokCustomAudiences,
  fetchTikTokInterestCategories,
  fetchTikTokSavedAudiences,
} from "../audience.ts";

describe("TikTok audience read helpers", () => {
  it("maps hierarchical interest categories", async () => {
    const rows = await fetchTikTokInterestCategories({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(
        path: string,
        params: Record<string, unknown>,
      ): Promise<T> => {
        assert.equal(path, "/tools/category/");
        assert.equal(params.advertiser_id, "advertiser-1");
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

  it("maps behaviours, custom audiences, and saved audiences", async () => {
    const behaviour = await fetchTikTokBehaviourCategories({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(): Promise<T> =>
        ({ list: [{ action_category_id: "b1", category_name: "Creators" }] }) as T,
    });
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

    assert.equal(behaviour[0].label, "Creators");
    assert.equal(custom[0].id, "c1");
    assert.equal(saved[0].label, "Lookalike 1");
  });
});
