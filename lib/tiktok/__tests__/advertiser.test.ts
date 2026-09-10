import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchTikTokAdvertiserCurrency,
  fetchTikTokAdvertiserInfo,
} from "../advertiser.ts";
import { IRONWORKS_ADVERTISER_INFO_ROW } from "./captured-ironworks-2026-09-10.ts";

describe("fetchTikTokAdvertiserCurrency", () => {
  it("reads currency from the captured Ironworks /advertiser/info/ row", async () => {
    const currency = await fetchTikTokAdvertiserCurrency({
      advertiserId: "7639802149165301776",
      token: "token-1",
      request: async <T,>(
        path: string,
        params: Record<string, unknown>,
      ): Promise<T> => {
        assert.equal(path, "/advertiser/info/");
        assert.deepEqual(params.advertiser_ids, ["7639802149165301776"]);
        assert.deepEqual(params.fields, [
          "currency",
          "timezone",
          "display_timezone",
        ]);
        return { list: [IRONWORKS_ADVERTISER_INFO_ROW] } as T;
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
  it("reads timezone and display_timezone from the captured Ironworks row", async () => {
    const info = await fetchTikTokAdvertiserInfo({
      advertiserId: "7639802149165301776",
      token: "token-1",
      request: async <T,>(): Promise<T> =>
        ({ list: [IRONWORKS_ADVERTISER_INFO_ROW] }) as T,
    });
    assert.equal(info.timezone, "Etc/GMT");
    assert.equal(info.displayTimezone, "Europe/London");
    assert.notEqual(info.timezone, info.displayTimezone);
    assert.equal(info.currency, "GBP");
    assert.equal("advertiser_id" in IRONWORKS_ADVERTISER_INFO_ROW, false);
  });
});
