import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { googleAdsLibraryTab } from "../../google-ads/library-tab.ts";
import { videoPlanDeletable } from "../delete-plan.ts";
import { findVideoReimport } from "../reimport.ts";

describe("google ads library tab", () => {
  it("is Search unless the query asks for YouTube", () => {
    assert.equal(googleAdsLibraryTab(undefined), "search");
    assert.equal(googleAdsLibraryTab("search"), "search");
    assert.equal(googleAdsLibraryTab("youtube"), "youtube");
    assert.equal(googleAdsLibraryTab(["youtube"]), "youtube");
    assert.equal(googleAdsLibraryTab("nope"), "search");
  });
});

describe("delete a YouTube plan", () => {
  it("allows draft and exported, and refuses live", () => {
    assert.equal(videoPlanDeletable("draft"), true);
    assert.equal(videoPlanDeletable("exported"), true);
    assert.equal(videoPlanDeletable("live"), false);
  });

  it("the delete route removes the database row and does not call Google", () => {
    const src = readFileSync(new URL("../../../app/api/google-video/[id]/route.ts", import.meta.url), "utf8");
    assert.match(src, /export async function DELETE/);
    assert.match(src, /videoPlanDeletable/);
    assert.match(src, /\.from\("google_video_plans"\)\.delete\(\)/);
    assert.doesNotMatch(src, /googleapis|googleads\.google|mutate\(/);
  });
});

describe("re-import of the same workbook", () => {
  const existing = {
    id: "plan-1",
    name: "CamelPhat",
    event_id: "event-1",
    source_filename: "IRW0004_CamelPhat_YouTubeVideo_BuildSheet.xlsx",
  };

  it("matches the same event and filename", () => {
    assert.deepEqual(
      findVideoReimport([existing], "event-1", "IRW0004_CamelPhat_YouTubeVideo_BuildSheet.xlsx"),
      { id: "plan-1", name: "CamelPhat" },
    );
  });

  it("does not match a different event, a different filename, or a missing event", () => {
    assert.equal(findVideoReimport([existing], "event-2", existing.source_filename), null);
    assert.equal(findVideoReimport([existing], "event-1", "other.xlsx"), null);
    assert.equal(findVideoReimport([existing], null, existing.source_filename), null);
    assert.equal(findVideoReimport([existing], "event-1", null), null);
  });
});
