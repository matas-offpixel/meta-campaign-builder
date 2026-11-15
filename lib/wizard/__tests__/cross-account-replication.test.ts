import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import { buildMetaTargeting } from "../../meta/adset.ts";
import type { AdSetSuggestion, CampaignDraft, CustomAudienceGroup } from "../../types.ts";
import type { MetaImportMeta } from "../../meta/import/types.ts";
import { validateStep } from "../../validation.ts";
import {
  accountSwitchConfirmCopy,
  accountSwitchImpact,
  commitAccountSwitch,
  foreignAudienceLaunchLabel,
} from "../account-switch.ts";

const SOURCE = "act_968594768066330";
const NEXT = "act_713771672906815";
const NEXT_NAME = "Innellea";
const INTEREST_ID = "6003139266461";
const INTEREST_GROUP = `interests:${INTEREST_ID}`;

function suggestion(
  id: string,
  sourceType: AdSetSuggestion["sourceType"],
  sourceId: string,
  patch: Partial<AdSetSuggestion> = {},
): AdSetSuggestion {
  return {
    id,
    name: id,
    sourceType,
    sourceId,
    sourceName: id,
    ageMin: 18,
    ageMax: 54,
    budgetPerDay: 20,
    advantagePlus: false,
    enabled: true,
    importedFromAdSetId: id,
    ...patch,
  };
}

function group(
  id: string,
  audienceIds: string[],
  patch: Partial<CustomAudienceGroup> = {},
): CustomAudienceGroup {
  const audienceNames: Record<string, string> = {};
  for (const audienceId of audienceIds) audienceNames[audienceId] = `Audience ${audienceId}`;
  return { id, name: id, audienceIds, audienceNames, ...patch };
}

function importMeta(flexibleIds: string[]): MetaImportMeta {
  const flexibleSpec: MetaImportMeta["flexibleSpec"] = {};
  for (const id of flexibleIds) {
    flexibleSpec[id] = { state: "present", interestIds: [INTEREST_ID] };
  }
  return {
    sourceCampaignId: "120",
    sourceCampaignName: "Source",
    sourceAdAccountId: SOURCE,
    dropped: [],
    notCarried: [{ id: "creative-1", name: "Poster", reason: "operator_unticked" }],
    creativeCounts: { read: 1, carried: 0, notCarried: 1 },
    flexibleSpec,
    appUsageCallCount: null,
  };
}

function importedDraft(): CampaignDraft {
  const draft = createDefaultDraft();
  draft.settings.adAccountId = SOURCE;
  draft.settings.metaAdAccountId = SOURCE;
  draft.audiences.interestGroups = [
    {
      id: INTEREST_GROUP,
      name: "Techno",
      interests: [{ id: INTEREST_ID, name: "Techno", source: "search" }],
    },
  ];
  draft.audiences.customAudienceGroups = [
    group("g-shared", ["120000000000001"]),
    group("g-geo", ["120000000000003"]),
    group("g-only", ["120000000000004", "120000000000005"]),
    group("g-lal", [], {
      lookalikeAudienceIdsByRange: { "0-1%": ["120000000000006"] },
      audienceNames: { "120000000000006": "Audience 120000000000006" },
    }),
  ];
  draft.adSetSuggestions = [
    suggestion("interest", "interest_group", INTEREST_GROUP),
    suggestion("mix-1", "custom_group", "g-shared"),
    suggestion("mix-2", "custom_group", "g-shared"),
    suggestion("mix-geo", "custom_group", "g-geo", {
      geoLocations: { countries: ["GB"] },
    }),
    suggestion("ca-only", "custom_group", "g-only"),
    suggestion("lal-only", "custom_group_lookalike", "g-lal", { lookalikeRange: "0-1%" }),
  ];
  draft.importMeta = importMeta(["mix-1", "mix-2"]);
  return draft;
}

describe("cross-account replication", () => {
  it("Imported draft with custom_group + interest ad sets, account changed → no validateStep error; interest rows untouched; mixed rows keep interests and lose the CA; CA-only rows disabled with the subtitle; notCarried[] has one row per removed audience", () => {
    const draft = importedDraft();
    const interestBefore = draft.adSetSuggestions.find((row) => row.id === "interest");
    const interestsBefore = draft.audiences.interestGroups;
    const impact = accountSwitchImpact(draft);
    const copy = accountSwitchConfirmCopy(impact, SOURCE, NEXT_NAME);
    assert.match(copy, /3 ad sets lose a custom audience, 2 ad sets disabled/);

    const next = commitAccountSwitch(draft, NEXT, "confirm", { nextAccountName: NEXT_NAME });
    const step = validateStep(0, next);
    assert.equal(step.valid, true);
    assert.equal(step.errors.some((error) => /re-import|Switch back/.test(error)), false);

    assert.equal(next.adSetSuggestions.find((row) => row.id === "interest"), interestBefore);
    assert.equal(next.audiences.interestGroups, interestsBefore);
    assert.deepEqual(next.audiences.interestGroups[0]?.interests, interestsBefore[0]?.interests);

    for (const id of ["mix-1", "mix-2"]) {
      const row = next.adSetSuggestions.find((item) => item.id === id)!;
      assert.equal(row.enabled, true);
      assert.equal(row.sourceType, "interest_group");
      assert.equal(row.sourceId, INTEREST_GROUP);
      assert.equal(row.sourceName, `${id} · custom audience removed`);
      const targeting = buildMetaTargeting(row, next.audiences);
      assert.deepEqual(targeting.interests, [{ id: INTEREST_ID, name: "Techno" }]);
      assert.equal(targeting.custom_audiences, undefined);
    }

    const geo = next.adSetSuggestions.find((row) => row.id === "mix-geo")!;
    assert.equal(geo.enabled, true);
    assert.equal(geo.sourceType, "custom_group");
    assert.equal(geo.sourceId, "g-geo");
    assert.deepEqual(geo.geoLocations, { countries: ["GB"] });
    assert.equal(geo.sourceName, "mix-geo · custom audience removed");
    assert.equal(buildMetaTargeting(geo, next.audiences).custom_audiences, undefined);

    const unavailable = `Custom audience from ${SOURCE} — not available on ${NEXT_NAME}`;
    for (const id of ["ca-only", "lal-only"]) {
      const row = next.adSetSuggestions.find((item) => item.id === id)!;
      assert.equal(row.enabled, false);
      assert.equal(row.name, id);
      assert.equal(row.sourceName, unavailable);
    }
    assert.equal(buildMetaTargeting(
      next.adSetSuggestions.find((row) => row.id === "ca-only")!,
      next.audiences,
    ).custom_audiences, undefined);
    assert.equal(buildMetaTargeting(
      next.adSetSuggestions.find((row) => row.id === "lal-only")!,
      next.audiences,
    ).custom_audiences, undefined);

    const removed = (next.importMeta?.notCarried ?? []).filter(
      (row) => row.reason === "custom_audience_other_account",
    );
    assert.deepEqual(
      removed.map((row) => row.id).sort(),
      [
        "120000000000001",
        "120000000000003",
        "120000000000004",
        "120000000000005",
        "120000000000006",
      ],
    );
    assert.equal(next.importMeta?.notCarried[0]?.reason, "operator_unticked");
    assert.equal(
      next.audiences.customAudienceGroups.find((row) => row.id === "g-only")?.foreignAccountById?.[
        "120000000000004"
      ],
      SOURCE,
    );
    assert.equal(foreignAudienceLaunchLabel(SOURCE), `⚠ from ${SOURCE} — removed on launch`);
    const panel = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../components/steps/audiences/custom-audiences-panel.tsx"),
      "utf8",
    );
    assert.match(panel, /foreignAudienceLaunchLabel/);
  });

  it("Draft with no custom audiences → account change is silent (as #1011)", () => {
    const draft = createDefaultDraft();
    draft.settings.adAccountId = SOURCE;
    draft.settings.metaAdAccountId = SOURCE;
    draft.audiences.interestGroups = [
      {
        id: INTEREST_GROUP,
        name: "Techno",
        interests: [{ id: INTEREST_ID, name: "Techno", source: "search" }],
      },
    ];
    draft.adSetSuggestions = [suggestion("interest", "interest_group", INTEREST_GROUP)];
    draft.importMeta = importMeta([]);

    const impact = accountSwitchImpact(draft);
    assert.equal(impact.needsConfirm, false);
    assert.equal(impact.adSetsLosingCustomAudience, 0);
    assert.equal(impact.adSetsDisabled, 0);
    const next = commitAccountSwitch(draft, NEXT, "confirm", { nextAccountName: NEXT_NAME });
    assert.equal(next.adSetSuggestions, draft.adSetSuggestions);
    assert.equal(next.audiences, draft.audiences);
    assert.equal(next.importMeta, draft.importMeta);
    assert.equal(next.settings.metaAdAccountId, NEXT);
    assert.equal(next.settings.metaPixelId, undefined);
  });

  it("importedAccountProblem no longer referenced by validation", () => {
    const validation = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../validation.ts"),
      "utf8",
    );
    assert.equal(validation.includes("importedAccountProblem"), false);
  });
});
