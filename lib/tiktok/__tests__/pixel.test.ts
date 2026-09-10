import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchTikTokPixelEvents, fetchTikTokPixels } from "../pixel.ts";
import { IRONWORKS_PIXEL_LIST_ROW } from "./captured-ironworks-2026-09-10.ts";

describe("fetchTikTokPixels", () => {
  it("maps the captured Ironworks /pixel/list/ row", async () => {
    const pixels = await fetchTikTokPixels({
      advertiserId: "7639802149165301776",
      token: "token-1",
      request: async <T,>(
        path: string,
        params: Record<string, unknown>,
      ): Promise<T> => {
        assert.equal(path, "/pixel/list/");
        assert.equal(params.advertiser_id, "7639802149165301776");
        return {
          page_info: { page: 1, page_size: 20, total_number: 1, total_page: 1 },
          pixels: [IRONWORKS_PIXEL_LIST_ROW],
        } as T;
      },
    });

    assert.deepEqual(pixels, [
      {
        pixel_id: "7644201699552690194",
        pixel_name: "Ironworks Pixel",
        // Live field is activity_status. Mapper still reads status.
        // This assertion failing is the point — do not fix the mapper here.
        status: "ACTIVE",
      },
    ]);
  });
});

describe("fetchTikTokPixelEvents", () => {
  it("reads optimization_event values from the captured Ironworks events[]", async () => {
    const events = await fetchTikTokPixelEvents({
      advertiserId: "7639802149165301776",
      pixelId: "7644201699552690194",
      token: "token-1",
      request: async <T,>(
        path: string,
        params: Record<string, unknown>,
      ): Promise<T> => {
        assert.equal(path, "/pixel/list/");
        assert.equal(params.pixel_id, "7644201699552690194");
        return {
          page_info: { page: 1, page_size: 20, total_number: 1, total_page: 1 },
          pixels: [IRONWORKS_PIXEL_LIST_ROW],
        } as T;
      },
    });

    assert.equal(IRONWORKS_PIXEL_LIST_ROW.events.length, 4);
    assert.deepEqual(events, [
      {
        optimization_event: "ENGAGED_SESSION",
        name: "ENGAGED_SESSION",
      },
      {
        optimization_event: "LANDING_PAGE_VIEW",
        name: "LANDING_PAGE_VIEW",
      },
      {
        optimization_event: "ON_WEB_REGISTER",
        name: "ON_WEB_REGISTER",
      },
    ]);
  });
});
