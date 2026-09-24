import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { canStampEvent } from "../../campaign-event-rewire.ts";

describe("rewire writes", () => {
  it("draft writes go through linkDraftToEvent and applyEventToCampaignSettings", () => {
    const rewire = readFileSync(new URL("../rewire.ts", import.meta.url), "utf8");
    const events = readFileSync(new URL("../events.ts", import.meta.url), "utf8");
    assert.match(rewire, /linkDraftToEvent/);
    assert.match(events, /applyEventToCampaignSettings/);
    assert.match(events, /updated_at/);
    assert.match(events, /if \(ownerUserId\) query = query.eq\("user_id", ownerUserId\)/);
    assert.match(rewire, /viewer.isOperator \? undefined : viewer.userId/);
    assert.doesNotMatch(events, /supabase: any = createClient/);
  });

  it("bulk applies only previewed rewires and never stamps", () => {
    const src = readFileSync(
      new URL("../../../app/api/optimisation/campaigns/wiring-bulk/route.ts", import.meta.url),
      "utf8",
    );
    const rewire = readFileSync(new URL("../rewire.ts", import.meta.url), "utf8");
    const ui = readFileSync(
      new URL("../../../components/optimisation/armed-campaign-row.tsx", import.meta.url),
      "utf8",
    );
    assert.match(src, /applyPreviewedRewires/);
    assert.match(src, /draftIds/);
    assert.doesNotMatch(src, /stamp_event/);
    assert.doesNotMatch(src, /loadArmedCampaignRows/);
    assert.doesNotMatch(src, /from\("campaign_drafts"\)\.update/);
    assert.match(rewire, /applyResolvedWiring\(supabase, draftId, "rewire"/);
    assert.match(rewire, /for \(const draftId of draftIds\)/);
    assert.doesNotMatch(rewire.slice(rewire.indexOf("export async function applyPreviewedRewires")), /\bbreak\b/);
    assert.match(ui, /wiring\?\.kind === "rewire"/);
    assert.doesNotMatch(ui, /stamp_event" && row.canWrite/);
    assert.doesNotMatch(ui, /NX26-AZYR/);
    assert.match(ui, /row.arm === "live"/);
    assert.match(ui, /draftIds: matched.map/);
  });

  it("stamp refuses an already-coded event", () => {
    const rewire = readFileSync(new URL("../rewire.ts", import.meta.url), "utf8");
    assert.match(rewire, /\.is\("event_code", null\)/);
    assert.match(rewire, /Event already has a code/);
    assert.match(rewire, /status: 409/);
  });

  it("a non-operator cannot stamp another owner's event", () => {
    assert.equal(
      canStampEvent({ userId: "owner-a", isOperator: false }, "owner-b"),
      false,
    );
    assert.equal(
      canStampEvent({ userId: "owner-a", isOperator: false }, "owner-a"),
      true,
    );
    assert.equal(
      canStampEvent({ userId: "owner-a", isOperator: true }, "owner-b"),
      true,
    );
  });

  it("rewire does not reach into the optimisation decision engine", () => {
    const rewire = readFileSync(new URL("../rewire.ts", import.meta.url), "utf8");
    assert.doesNotMatch(rewire, /optimisation\/evaluate|optimisation\/apply|optimisation\/gates/);
  });

  it("no test here asserts against a branch diff", () => {
    const self = readFileSync(new URL(import.meta.url), "utf8");
    assert.equal(self.includes(["git diff", "--name-only"].join(" ")), false);
    assert.equal(self.includes(["exec", "Sync"].join("")), false);
  });
});
