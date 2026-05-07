import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAudienceName } from "../naming.ts";

/**
 * Mirrors the single-mode suggested name in `audience-create-form.tsx`
 * when retention or subtype inputs change.
 */
describe("audience create form naming (smoke)", () => {
  it("updates suggested name when retention changes 30 → 60", () => {
    const base = {
      scope: "event" as const,
      client: { slug: "4thefans", name: "4theFans" },
      event: { eventCode: "WC26-MANCHESTER", name: "Manchester" },
      subtype: "video_views" as const,
      threshold: 95,
      campaignNames: [] as string[],
    };
    const at30 = buildAudienceName({ ...base, retentionDays: 30 });
    const at60 = buildAudienceName({ ...base, retentionDays: 60 });
    assert.match(at30, /30d$/);
    assert.match(at60, /60d$/);
    assert.notEqual(at30, at60);
  });
});
