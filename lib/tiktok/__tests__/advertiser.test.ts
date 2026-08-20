import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchTikTokAdvertiserCurrency } from "../advertiser.ts";

describe("fetchTikTokAdvertiserCurrency", () => {
  it("reads currency from /advertiser/info/", async () => {
    const currency = await fetchTikTokAdvertiserCurrency({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(
        path: string,
        params: Record<string, unknown>,
      ): Promise<T> => {
        assert.equal(path, "/advertiser/info/");
        assert.deepEqual(params.advertiser_ids, ["advertiser-1"]);
        return {
          list: [{ advertiser_id: "advertiser-1", currency: "gbp" }],
        } as T;
      },
    });
    assert.equal(currency, "GBP");
  });

  it("returns null when TikTok omits currency", async () => {
    const currency = await fetchTikTokAdvertiserCurrency({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(): Promise<T> => ({ list: [] }) as T,
    });
    assert.equal(currency, null);
  });
});
