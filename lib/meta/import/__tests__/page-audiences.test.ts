import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { migrateDraft } from "../../../autosave.ts";
import { generateSuggestions } from "../../../wizard/generate-adset-suggestions.ts";
import { mergeGeneratedWithImported } from "../../../wizard/import-edits.ts";
import { buildMetaTargeting } from "../../adset.ts";
import { mapMetaLiveCampaign } from "../map.ts";
import {
  customAudienceChips,
  importedPageDerivedSentence,
  pageDerivedBadge,
  pageDerivedFromName,
} from "../page-audiences.ts";
import { readMetaLiveCampaign } from "../readers.ts";
import type { MetaImportRecordedCall, MetaImportRequest, MetaLiveCampaignBundle } from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURED = join(HERE, "../__fixtures__/captured");
const ACCOUNT = "act_968594768066330";
const CAMPAIGN_ID = "120249957259050453";

async function dhbBundle(): Promise<MetaLiveCampaignBundle> {
  const capture = JSON.parse(
    readFileSync(join(CAPTURED, `meta-import-capture-${CAMPAIGN_ID}.json`), "utf8"),
  ) as { calls: MetaImportRecordedCall[] };
  const gets = capture.calls.filter((call) => call.method === "GET");
  const posts = capture.calls.filter((call) => call.method === "POST");
  let postAt = 0;
  const request: MetaImportRequest = {
    get: async (path, params) => {
      const after = params.after ?? "";
      const call = gets.find((row) => row.path === path && String(row.params.after ?? "") === after);
      if (!call) throw new Error(`no GET ${path}`);
      return call.data;
    },
    post: async () => {
      const call = posts[postAt % posts.length];
      postAt += 1;
      return call!.data;
    },
  };
  return readMetaLiveCampaign({
    adAccountId: ACCOUNT,
    campaignId: CAMPAIGN_ID,
    token: "token",
    request,
    sleep: async () => {},
  });
}

function allAvailable(bundle: MetaLiveCampaignBundle) {
  const ids = new Set<string>();
  for (const adSet of bundle.adSets) {
    const targeting = adSet.targeting as { custom_audiences?: { id?: string }[] };
    for (const audience of targeting.custom_audiences ?? []) {
      if (audience.id) ids.add(audience.id);
    }
  }
  return [...ids].map((id) => ({ id, available: true }));
}

describe("audience names from the read", () => {
  it("a custom group carries the names Meta returned", async () => {
    const bundle = await dhbBundle();
    const draft = mapMetaLiveCampaign({
      bundle,
      adAccountId: ACCOUNT,
      carry: [],
      availability: allAvailable(bundle),
    });
    const group = draft.audiences.customAudienceGroups.find((row) => row.name.includes("DHB Primary"));
    assert.ok(group);
    assert.equal(group.audienceNames?.["120249428134180453"], "Ahmed Spins  FB Engagement 365d");
    assert.equal(Object.keys(group.audienceNames ?? {}).length, group.audienceIds.length);
  });

  it("a draft saved before audienceNames loads with the field absent", () => {
    const migrated = migrateDraft({
      audiences: {
        customAudienceGroups: [{ id: "g", name: "Old", audienceIds: ["1234567890"] }],
      },
    });
    assert.equal(migrated.audiences.customAudienceGroups[0]?.audienceNames, undefined);
    assert.deepEqual(migrated.audiences.customAudienceGroups[0]?.audienceIds, ["1234567890"]);
  });
});

describe("page-derived names", () => {
  it("badges the sanitised engagement name and names the page", () => {
    assert.deepEqual(pageDerivedFromName("Ahmed Spins  FB Engagement 365d"), {
      page: "Ahmed Spins",
      engagement: "FB Engagement 365d",
    });
    assert.equal(pageDerivedBadge("Ahmed Spins — IG Followers"), "page-derived · Ahmed Spins");
    assert.equal(pageDerivedFromName("Ankhoï [FBE365]"), null);
    assert.equal(pageDerivedFromName("DHB Pixel"), null);
    assert.equal(pageDerivedFromName("Lookalike (1%) - People who like Ahmed Spins"), null);
  });
});

describe("custom audience chips", () => {
  it("adds the id only where two ids share a name, and falls back to the id", () => {
    const names: Record<string, string> = {
      "1111111111": "Fans",
      "2222222222": "Fans",
      "3333333333": "Buyers",
    };
    assert.deepEqual(
      customAudienceChips(["1111111111", "2222222222", "3333333333", "4444444444"], (id) => names[id]),
      [
        { id: "1111111111", label: "Fans · 1111111111", derived: null },
        { id: "2222222222", label: "Fans · 2222222222", derived: null },
        { id: "3333333333", label: "Buyers", derived: null },
        { id: "4444444444", label: "4444444444", derived: null },
      ],
    );
  });

  it("the Selected chips use customAudienceChips, keyed by id", () => {
    const panel = readFileSync(join(HERE, "../../../../components/steps/audiences/custom-audiences-panel.tsx"), "utf8");
    assert.match(panel, /customAudienceChips\(\s*group\.audienceIds/);
    assert.match(panel, /<Badge key=\{id\} variant="primary"/);
  });
});

function customAudiences(adSet: MetaLiveCampaignBundle["adSets"][number]) {
  const targeting = adSet.targeting as { custom_audiences?: { id?: string }[] };
  return (targeting.custom_audiences ?? []).flatMap((row) => (row.id ? [row.id] : []));
}

describe("DHB audiences stay as the ad set targeted them", () => {
  it("one custom group per ad set, including one of 60, and Pages stays empty", async () => {
    const bundle = await dhbBundle();
    const draft = mapMetaLiveCampaign({
      bundle,
      adAccountId: ACCOUNT,
      carry: [],
      availability: [{ id: "120249428134180453", available: false }],
    });

    assert.equal(draft.audiences.pageGroups.length, 0);
    assert.equal(draft.adSetSuggestions.length, bundle.adSets.length);
    assert.equal(
      draft.adSetSuggestions.filter((row) => row.enabled).length,
      bundle.adSets.filter((row) => row.status === "ACTIVE").length,
    );
    assert.equal(
      draft.adSetSuggestions.some((row) => row.sourceType === "page_group"),
      false,
    );

    const sourced = bundle.adSets.filter((row) => customAudiences(row).length > 0);
    assert.equal(draft.audiences.customAudienceGroups.length, sourced.length);
    const groupIds = new Set<string>();
    for (const adSet of sourced) {
      const group = draft.audiences.customAudienceGroups.find((row) => row.id === `custom:${adSet.id}`);
      assert.ok(group, String(adSet.name));
      assert.equal(groupIds.has(group.id), false);
      groupIds.add(group.id);
      assert.deepEqual([...group.audienceIds].sort(), [...customAudiences(adSet)].sort());
      const suggestion = draft.adSetSuggestions.find((row) => row.importedFromAdSetId === adSet.id);
      assert.equal(suggestion?.sourceType, "custom_group");
      assert.equal(suggestion?.sourceId, group.id);
    }

    const launched = draft.adSetSuggestions.find((row) => row.name === "All customs 2");
    assert.ok(launched);
    const launchedGroup = draft.audiences.customAudienceGroups.find((row) => row.id === launched.sourceId);
    assert.equal(launchedGroup?.audienceIds.length, 60);
    assert.equal(launchedGroup?.audienceIds.includes("120245969090890453"), true);
    assert.equal(
      launchedGroup?.audienceNames?.["120245969090890453"],
      "Ahmed Spins  FB Engagement 365d",
    );
    assert.equal(
      pageDerivedBadge(launchedGroup?.audienceNames?.["120245969090890453"]),
      "page-derived · Ahmed Spins",
    );

    const primary = draft.audiences.customAudienceGroups.find((row) => row.name === "DHB Primary");
    assert.equal(primary?.audienceIds.length, 10);
    assert.equal(primary?.audienceIds.includes("120249428134180453"), true);
    assert.equal(
      primary?.audienceNames?.["120249428134180453"],
      "Ahmed Spins  FB Engagement 365d",
    );
    assert.equal(
      draft.importMeta?.notCarried.some((row) => row.id === "120249428134180453"),
      false,
    );

    assert.equal(
      importedPageDerivedSentence(draft.audiences.customAudienceGroups),
      "61 page-derived audiences are in Custom, as the source ad sets targeted them.",
    );
    assert.equal(importedPageDerivedSentence([]), null);

    const locations = draft.budgetSchedule.locationGroups ?? [];
    assert.ok(locations[0]);
    const generated = generateSuggestions(draft.audiences, 500, locations, locations[0]);
    assert.equal(generated.some((row) => row.sourceType === "page_group"), false);
    const merged = mergeGeneratedWithImported(draft.adSetSuggestions, generated, draft.audiences).suggestions;
    assert.equal(
      merged.filter((row) => row.importedFromAdSetId).length,
      bundle.adSets.length,
    );
    assert.equal(merged.some((row) => row.sourceType === "page_group"), false);
  });

  it("DHB Primary – USA holds ten ids once each, four pairs sharing a name", async () => {
    const bundle = await dhbBundle();
    const draft = mapMetaLiveCampaign({
      bundle,
      adAccountId: ACCOUNT,
      carry: [],
      availability: allAvailable(bundle),
    });

    for (const group of draft.audiences.customAudienceGroups) {
      assert.equal(new Set(group.audienceIds).size, group.audienceIds.length, group.name);
    }

    const adSet = bundle.adSets.find((row) => row.name === "DHB Primary – USA");
    assert.ok(adSet);
    assert.equal(adSet.id, "120249960783160453");
    const raw = customAudiences(adSet);
    assert.equal(raw.length, 10);
    assert.equal(new Set(raw).size, 10);

    const group = draft.audiences.customAudienceGroups.find((row) => row.id === `custom:${adSet.id}`);
    assert.ok(group);
    assert.deepEqual([...group.audienceIds].sort(), [...raw].sort());

    const pairs: [string, string, string][] = [
      ["Ahmed Spins  IG Followers", "120249428134610453", "120249955627300453"],
      ["Ahmed Spins  IG Engagement 365d", "120249428134740453", "120249955627560453"],
      ["Deep House Bible  IG Followers", "120249428143410453", "120249955628440453"],
      ["Deep House Bible  IG Engagement 365d", "120249428143720453", "120249955628580453"],
    ];
    for (const [name, first, second] of pairs) {
      assert.equal(group.audienceNames?.[first], name);
      assert.equal(group.audienceNames?.[second], name);
    }

    const chips = customAudienceChips(group.audienceIds, (id) => group.audienceNames?.[id]);
    assert.equal(chips.length, 10);
    assert.equal(new Set(chips.map((chip) => chip.label)).size, 10);
    for (const [name, first, second] of pairs) {
      assert.equal(chips.find((chip) => chip.id === first)?.label, `${name} · ${first}`);
      assert.equal(chips.find((chip) => chip.id === second)?.label, `${name} · ${second}`);
    }
    const unique = chips.find((chip) => chip.id === "120249428134180453");
    assert.equal(unique?.label, "Ahmed Spins  FB Engagement 365d");
    assert.equal(unique?.derived, "page-derived · Ahmed Spins");
    assert.equal(
      chips.find((chip) => chip.id === "120249955627300453")?.derived,
      "page-derived · Ahmed Spins",
    );

    const suggestion = draft.adSetSuggestions.find((row) => row.importedFromAdSetId === adSet.id);
    assert.ok(suggestion);
    const sent = (buildMetaTargeting(suggestion, draft.audiences, draft.budgetSchedule.locationGroups).custom_audiences ?? [])
      .map((row) => row.id);
    assert.equal(sent.length, raw.length);
    assert.deepEqual([...sent].sort(), [...raw].sort());
  });

  it("the Pages tab says the page-derived audiences stayed in Custom", () => {
    const step = readFileSync(join(HERE, "../../../../components/steps/audiences/audiences-step.tsx"), "utf8");
    assert.match(step, /importedPageDerivedSentence/);
    assert.match(step, /ImportedPageDerivedLine/);
    const wizard = readFileSync(join(HERE, "../../../../components/wizard/wizard-shell.tsx"), "utf8");
    const drawer = readFileSync(join(HERE, "../../../../components/plan/meta-drawer.tsx"), "utf8");
    assert.match(wizard, /imported=\{draft\.importMeta != null\}/);
    assert.match(drawer, /imported=\{draft\.importMeta != null\}/);
  });
});
