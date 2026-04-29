import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchTikTokPixels } from "../pixel.ts";

describe("fetchTikTokPixels", () => {
  it("maps TikTok pixel list responses into sorted options", async () => {
    const pixels = await fetchTikTokPixels({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(
        path: string,
        params: Record<string, unknown>,
      ): Promise<T> => {
        assert.equal(path, "/pixel/list/");
        assert.equal(params.advertiser_id, "advertiser-1");
        return {
          list: [
            { pixel_id: "px-2", pixel_name: "Website B", status: "ACTIVE" },
            { pixel_id: "px-1", name: "Website A" },
            { pixel_name: "Missing id" },
          ],
        } as T;
      },
    });

    assert.deepEqual(pixels, [
      { pixel_id: "px-1", pixel_name: "Website A", status: null },
      { pixel_id: "px-2", pixel_name: "Website B", status: "ACTIVE" },
    ]);
  });
});
