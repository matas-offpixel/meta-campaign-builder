import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractVideoIdsFromCreative } from "../extract-video-ids-from-creative.ts";

describe("extractVideoIdsFromCreative", () => {
  it("collects ids from root, story spec, asset_feed_spec, and platform_customizations", () => {
    const creative = {
      video_id: "v_root",
      object_story_spec: {
        video_data: { video_id: "v_story" },
      },
      asset_feed_spec: {
        videos: [{ video_id: "v_feed" }, { video_id: "v_feed2" }],
      },
      platform_customizations: {
        facebook: {
          video_data: { video_id: "v_plat" },
        },
      },
    };
    const ids = extractVideoIdsFromCreative(creative).sort();
    assert.deepEqual(ids, ["v_feed", "v_feed2", "v_plat", "v_root", "v_story"]);
  });
});
