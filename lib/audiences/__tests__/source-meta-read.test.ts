import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { migrateAudienceSourceMetaRead } from "../source-meta-read.ts";

describe("migrateAudienceSourceMetaRead", () => {
  it("coerces legacy string urlContains to string[]", () => {
    const out = migrateAudienceSourceMetaRead({
      subtype: "website_pixel",
      pixelEvent: "ViewContent",
      urlContains: "/ticket",
    }) as { urlContains: string[] };
    assert.deepEqual(out.urlContains, ["/ticket"]);
  });

  it("maps empty legacy string to empty array", () => {
    const out = migrateAudienceSourceMetaRead({
      subtype: "website_pixel",
      pixelEvent: "PageView",
      urlContains: "",
    }) as { urlContains: string[] };
    assert.deepEqual(out.urlContains, []);
  });

  it("leaves non-pixel meta unchanged", () => {
    const meta = { subtype: "video_views", videoIds: ["v1"], threshold: 50 };
    assert.strictEqual(migrateAudienceSourceMetaRead(meta), meta);
  });
});
