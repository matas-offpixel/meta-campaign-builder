import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchTikTokAdvertiserCurrency,
  fetchTikTokAdvertiserInfo,
} from "../advertiser.ts";

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
        assert.deepEqual(params.fields, [
          "currency",
          "timezone",
          "display_timezone",
        ]);
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

describe("fetchTikTokAdvertiserInfo", () => {
  it("reads timezone and does not fall back to display_timezone", async () => {
    const info = await fetchTikTokAdvertiserInfo({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(): Promise<T> =>
        ({
          list: [
            {
              advertiser_id: "advertiser-1",
              currency: "USD",
              timezone: "America/New_York",
              display_timezone: "Europe/London",
            },
          ],
        }) as T,
    });
    assert.equal(info.timezone, "America/New_York");
    assert.equal(info.displayTimezone, "Europe/London");
    assert.notEqual(info.timezone, info.displayTimezone);
  });
});
