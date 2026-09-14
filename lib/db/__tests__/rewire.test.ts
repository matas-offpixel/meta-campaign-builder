import assert from "node:assert/strict";
import { execSync } from "node:child_process";
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
  });

  it("bulk route applies each row through applyResolvedWiring", () => {
    const src = readFileSync(
      new URL("../../../app/api/optimisation/campaigns/wiring-bulk/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(src, /applyResolvedWiring/);
    assert.doesNotMatch(src, /from\("campaign_drafts"\)\.update/);
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

  it("this branch does not touch evaluate/apply/gates or the plan freeze", () => {
    const rewire = readFileSync(new URL("../rewire.ts", import.meta.url), "utf8");
    assert.doesNotMatch(rewire, /optimisation\/evaluate|optimisation\/apply|optimisation\/gates/);
    const changed = execSync("git diff --name-only origin/main", {
      encoding: "utf8",
    });
    for (const file of [
      "lib/optimisation/evaluate.ts",
      "lib/optimisation/apply.ts",
      "lib/optimisation/gates.ts",
    ]) {
      assert.ok(!changed.split("\n").includes(file), `${file} is in this branch's diff`);
    }
    assert.ok(
      !changed.split("\n").some((file) => file.startsWith("components/plan/")),
      "components/plan is in this branch's diff",
    );
  });
});
