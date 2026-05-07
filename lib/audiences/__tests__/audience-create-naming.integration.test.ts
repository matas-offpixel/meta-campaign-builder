import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

  it("updates suggested name when threshold changes 95 → 75", () => {
    const base = {
      scope: "client" as const,
      client: { slug: "4thefans", name: "4theFans" },
      event: null,
      subtype: "video_views" as const,
      retentionDays: 30,
      campaignNames: [] as string[],
    };
    const at95 = buildAudienceName({ ...base, threshold: 95 });
    const at75 = buildAudienceName({ ...base, threshold: 75 });
    assert.match(at95, /95%/);
    assert.match(at75, /75%/);
    assert.notEqual(at95, at75);
  });

  it("updates suggested name when threshold changes 95 → 50 with event scope", () => {
    const base = {
      scope: "event" as const,
      client: { slug: "4thefans", name: "4theFans" },
      event: { eventCode: "4TF26-BRISTOL", name: "Bristol" },
      subtype: "video_views" as const,
      retentionDays: 30,
      campaignNames: [] as string[],
    };
    const at95 = buildAudienceName({ ...base, threshold: 95 });
    const at50 = buildAudienceName({ ...base, threshold: 50 });
    assert.match(at95, /\[4TF26-BRISTOL\] 95% video views 30d/);
    assert.match(at50, /\[4TF26-BRISTOL\] 50% video views 30d/);
  });

  it("name contains both threshold and retention — both update independently", () => {
    const base = {
      scope: "client" as const,
      client: { slug: "offpixel", name: "Off/Pixel" },
      event: null,
      subtype: "video_views" as const,
      campaignNames: [] as string[],
    };
    const n = buildAudienceName({ ...base, threshold: 50, retentionDays: 90 });
    assert.match(n, /50%/);
    assert.match(n, /90d/);
  });
});

describe("audience create form stale-state fixes (code pattern)", () => {
  it("audience-create-form.tsx tracks userEditedName and auto-syncs suggestedName", () => {
    const form = readFileSync(
      "app/(dashboard)/audiences/[clientId]/new/audience-create-form.tsx",
      "utf8",
    );
    // userEditedName state exists
    assert.match(form, /userEditedName/);
    // effect syncs suggestedName → name when !userEditedName
    assert.match(form, /!userEditedName/);
    // handleNameChange sets userEditedName true before calling setName
    assert.match(form, /setUserEditedName\(true\)/);
    // handleResetName clears userEditedName
    assert.match(form, /setUserEditedName\(false\)/);
    // Reset link is rendered
    assert.match(form, /Reset to suggested name/);
  });

  it("source-picker.tsx clears videoIds and contextId when campaignKey changes", () => {
    const picker = readFileSync(
      "components/audiences/source-picker.tsx",
      "utf8",
    );
    // Effect that clears stale videoIds on campaignKey change
    assert.match(picker, /videoIds.*\[\].*contextId.*undefined|contextId.*undefined.*videoIds.*\[\]/s);
    // Keyed on campaignKey
    assert.match(picker, /\[campaignKey\]/);
  });
});
