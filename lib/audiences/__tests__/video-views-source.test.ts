import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveVideoViewsSourceId } from "../video-views-source.ts";

describe("resolveVideoViewsSourceId", () => {
  it("throws when campaigns selected but no video ids", () => {
    assert.throws(
      () =>
        resolveVideoViewsSourceId({
          videoIds: [],
          campaignIds: ["c1"],
        }),
      /No video creatives selected/,
    );
  });

  it("succeeds when video ids are present regardless of empty flat sourceId", () => {
    assert.equal(
      resolveVideoViewsSourceId({
        flatSourceId: "",
        videoIds: ["v1"],
        campaignIds: ["c1"],
      }),
      "v1",
    );
  });

  it("joins multiple video ids", () => {
    assert.equal(
      resolveVideoViewsSourceId({
        videoIds: ["v1", "v2"],
        campaignIds: [],
      }),
      "v1,v2",
    );
  });

  it("falls back to flat source id when videoIds empty", () => {
    assert.equal(
      resolveVideoViewsSourceId({
        flatSourceId: "x,y",
        videoIds: [],
        campaignIds: [],
      }),
      "x,y",
    );
  });
});
