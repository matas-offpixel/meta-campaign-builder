import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchTikTokPixelEvents,
  fetchTikTokPixels,
  PIXEL_STATUS_CANDIDATE_KEYS,
  resolveTikTokPixelOptimizationEvent,
} from "../pixel.ts";
import { IRONWORKS_PIXEL_LIST_ROW } from "./captured-ironworks-2026-09-10.ts";
import {
  PUZZLE_PIXEL_LIST_ROW,
  PUZZLE_PIXEL_STATS,
} from "./captured-puzzle-pixel-2026-10-22.ts";

describe("fetchTikTokPixels", () => {
  it("maps status from activity_status on the captured Ironworks row", async () => {
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

    assert.equal(IRONWORKS_PIXEL_LIST_ROW.activity_status, "ACTIVE");
    assert.equal("status" in IRONWORKS_PIXEL_LIST_ROW, false);
    assert.deepEqual(pixels, [
      {
        pixel_id: "7644201699552690194",
        pixel_name: "Ironworks Pixel",
        status: "ACTIVE",
      },
    ]);
  });

  it("still maps a row that only carries the legacy status key", async () => {
    const pixels = await fetchTikTokPixels({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(): Promise<T> =>
        ({
          list: [
            { pixel_id: "px-legacy", pixel_name: "Legacy Pixel", status: "ACTIVE" },
          ],
        }) as T,
    });

    assert.deepEqual(pixels, [
      { pixel_id: "px-legacy", pixel_name: "Legacy Pixel", status: "ACTIVE" },
    ]);
  });

  it("alarms through logUnmatchedCandidates when neither status key is present", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    let pixels: Awaited<ReturnType<typeof fetchTikTokPixels>>;
    try {
      pixels = await fetchTikTokPixels({
        advertiserId: "advertiser-1",
        token: "token-1",
        request: async <T,>(): Promise<T> =>
          ({
            pixels: [{ pixel_id: "px-none", pixel_name: "No Status" }],
          }) as T,
      });
    } finally {
      console.error = original;
    }

    assert.deepEqual(pixels, [
      { pixel_id: "px-none", pixel_name: "No Status", status: null },
    ]);
    assert.equal(
      lines.some(
        (line) =>
          line ===
          `[tiktok/unmatched] /pixel/list/ status none of [${PIXEL_STATUS_CANDIDATE_KEYS.join(", ")}] matched`,
      ),
      true,
    );
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
        if (path === "/pixel/event/stats/") return { list: [] } as T;
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

  it("adds Puzzle's server Submit Form from /pixel/event/stats/ as FORM", async () => {
    const events = await fetchTikTokPixelEvents({
      advertiserId: "7691406943759499285",
      pixelId: "7691763173556371474",
      token: "token-1",
      now: Date.parse("2026-10-22T12:00:00Z"),
      request: async <T,>(path: string): Promise<T> => {
        if (path === "/pixel/event/stats/") return PUZZLE_PIXEL_STATS as T;
        return { pixels: [PUZZLE_PIXEL_LIST_ROW] } as T;
      },
    });
    assert.ok(
      events.some(
        (event) => event.optimization_event === "FORM" && event.name === "Submit form",
      ),
    );
    assert.equal(
      events.some((event) => event.optimization_event === "PAGE_VIEW"),
      false,
    );
  });

  it("keeps a list Submit Form with a blank optimization_event and drops a deprecated sibling", async () => {
    const events = await fetchTikTokPixelEvents({
      advertiserId: "7691406943759499285",
      pixelId: "7691763173556371474",
      token: "token-1",
      request: async <T,>(path: string): Promise<T> => {
        if (path === "/pixel/event/stats/") return { list: [] } as T;
        return {
          pixels: [
            {
              ...PUZZLE_PIXEL_LIST_ROW,
              events: [
                ...PUZZLE_PIXEL_LIST_ROW.events,
                {
                  deprecated: false,
                  event_code: "Lead",
                  event_type: "Lead",
                  name: "Submit form",
                  optimization_event: "",
                },
                {
                  deprecated: true,
                  event_code: "",
                  event_type: "BUTTON",
                  name: "Click button",
                  optimization_event: "BUTTON",
                },
              ],
            },
          ],
        } as T;
      },
    });
    assert.ok(events.some((event) => event.optimization_event === "FORM"));
    assert.equal(
      events.some((event) => event.optimization_event === "BUTTON"),
      false,
    );
  });

  it("maps a blank Submit Form row to FORM and still drops deprecated rows", () => {
    assert.equal(
      resolveTikTokPixelOptimizationEvent({
        name: "Submit form",
        event_code: "Lead",
        event_type: "Lead",
        optimization_event: "",
        deprecated: false,
      }),
      "FORM",
    );
    assert.equal(
      resolveTikTokPixelOptimizationEvent({
        name: "Complete Registration",
        optimization_event: null,
        deprecated: false,
      }),
      "ON_WEB_REGISTER",
    );
    assert.equal(
      resolveTikTokPixelOptimizationEvent({
        name: "Submit form",
        event_type: "Lead",
        optimization_event: "FORM",
        deprecated: true,
      }),
      null,
    );
    assert.equal(
      resolveTikTokPixelOptimizationEvent({
        event_type: "ON_WEB_ORDER",
        optimization_event: "ON_WEB_ORDER",
        deprecated: false,
      }),
      null,
    );
  });
});
