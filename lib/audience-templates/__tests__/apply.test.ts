/**
 * "Add to this draft": the made audiences into the draft, by Meta id. No
 * Meta call, no database.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HOUSE_DISCO, RC_E_DATA, RC_E_KNOWN, RC_E_PENDING, SU_C_HELD_DATA, SU_C_HELD_TEMPLATE } from "../../../scripts/plan-frames/audience-templates-fixtures.ts";
import type { AudienceSettings } from "../../types.ts";
import { addTemplateToDraft, templateGroupId } from "../apply.ts";
import { resolveTemplate } from "../resolve.ts";

const EMPTY: AudienceSettings = { pageGroups: [], customAudienceGroups: [], savedAudiences: { audienceIds: [] }, interestGroups: [], selectedPagesLookalikeGroups: [] };
const nx = resolveTemplate([...HOUSE_DISCO.items, ...RC_E_PENDING], RC_E_DATA.accountId, RC_E_KNOWN, RC_E_DATA.pixelId);

describe("addTemplateToDraft", () => {
  const res = addTemplateToDraft(EMPTY, "House & disco", nx);


  it("one custom group of Meta ids named after the template, and one interest group", () => {
    const g = res.audiences.customAudienceGroups.find((x) => x.id === templateGroupId("House & disco"))!;
    assert.equal(g.name, "House & disco");
    assert.deepEqual(g.audienceIds, [
      "9000000000000001",
      "9000000000000002",
      "9000000000000003",
      "9000000000000004",
      "9000000000000005",
      "9000000000000006",
      "9000000000000007",
      "9000000000000008",
    ]);
    assert.equal(g.audienceNames?.["9000000000000001"], "Tech house buyers");
    const i = res.audiences.interestGroups.find((x) => x.id === templateGroupId("House & disco"))!;
    assert.deepEqual(i.interests.map((x) => x.name), ["House music", "Disco", "Defected Records"]);
  });

  it("never an audience from another account, nor a list held elsewhere", () => {
    const all = res.audiences.customAudienceGroups.flatMap((g) => g.audienceIds);
    assert.ok(!all.includes("9000000000000009"));
    const sheffield = resolveTemplate(SU_C_HELD_TEMPLATE.items, SU_C_HELD_DATA.accountId, SU_C_HELD_DATA.known, SU_C_HELD_DATA.pixelId);
    const s = addTemplateToDraft(EMPTY, "House & disco", sheffield);
    assert.equal(s.audiences.customAudienceGroups.length, 0, "nothing made in Sheffield but interests");
    assert.equal(s.audiences.interestGroups.length, 1);
  });

  it("adding twice changes nothing, and other groups are left as they are", () => {
    const own = { ...EMPTY, customAudienceGroups: [{ id: "mine", name: "Mine", audienceIds: ["1"] }] };
    const once = addTemplateToDraft(own, "House & disco", nx).audiences;
    const twice = addTemplateToDraft(once, "House & disco", nx).audiences;
    assert.deepEqual(twice, once);
    assert.deepEqual(twice.customAudienceGroups[0], { id: "mine", name: "Mine", audienceIds: ["1"] });
    assert.equal(twice.customAudienceGroups.length, 2);
  });
});
