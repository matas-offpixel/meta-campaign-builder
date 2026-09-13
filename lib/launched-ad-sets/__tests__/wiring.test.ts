import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

const LAUNCH = source("app/api/meta/launch-campaign/route.ts");
const CREATE = source("app/api/meta/create-adsets/route.ts");
const PATTERNS = source("lib/reporting/creative-patterns-cross-event.ts");
const ARMED = source("components/optimisation/armed-campaign-row.tsx");
const AUTOTAG = source("app/api/cron/refresh-active-creatives/route.ts");

describe("Phase 0 wiring", () => {
  it("records a launched_ad_sets row after every successful create, not on attach-existing", () => {
    assert.match(LAUNCH, /bindLaunchAdSetRecorder/);
    assert.equal(
      (LAUNCH.match(/recordCreatedAdSet\(/g) ?? []).length,
      6,
      "standard Phase 2, Phase 2b, Phase 2b salvage, MC Phase 2, MC Phase 2b, MC Phase 2b salvage",
    );
    assert.match(LAUNCH, /const cleanSuggestions = draft\.adSetSuggestions\.map/);
    const attachAll = LAUNCH.slice(
      LAUNCH.indexOf("attach_all_adsets short-circuit"),
      LAUNCH.indexOf("attach_adset short-circuit"),
    );
    assert.doesNotMatch(attachAll, /recordCreatedAdSet\(/);
    const attachAdset = LAUNCH.slice(
      LAUNCH.indexOf("if (wizardMode === \"attach_adset\")"),
      LAUNCH.indexOf("const LOOKALIKE_TYPES"),
    );
    assert.doesNotMatch(attachAdset, /recordCreatedAdSet\(/);
  });

  it("create-adsets records after Meta create succeeds", () => {
    assert.match(CREATE, /recordLaunchedAdSet/);
    const createIdx = CREATE.indexOf("createMetaAdSets(");
    const recordIdx = CREATE.indexOf("recordLaunchedAdSet(");
    assert.ok(createIdx >= 0 && recordIdx > createIdx);
  });

  it("does not change the cross-event assignment join", () => {
    assert.match(
      PATTERNS,
      /"event_id,creative_name,tag_id,tag:creative_tags!creative_tag_assignments_tag_id_fkey\(dimension,value_key,value_label\)"/,
    );
    assert.doesNotMatch(PATTERNS, /meta_ad_id/);
  });

  it("the Armed wired-to event name is a link to the event page", () => {
    assert.match(ARMED, /Wired to/);
    assert.match(ARMED, /href=\{`\/events\/\$\{row\.eventId\}`\}/);
  });

  it("autotagger stamps Meta ids when the group has them", () => {
    assert.match(AUTOTAG, /metaAdId: group\.representative_ad_id/);
    assert.match(AUTOTAG, /metaCreativeId: group\.underlying_creative_ids\[0\]/);
  });

  it("the diff does not recommend an audience", () => {
    const files = [
      "lib/launched-ad-sets/snapshot.ts",
      "lib/launched-ad-sets/record.ts",
      "lib/launched-ad-sets/backfill.ts",
      "lib/launched-ad-sets/launch-recorder.ts",
      "scripts/backfill-launched-ad-sets.mjs",
    ];
    for (const path of files) {
      assert.doesNotMatch(source(path), /suggested audience/i);
    }
  });
});
