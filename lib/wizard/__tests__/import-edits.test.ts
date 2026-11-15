import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { migrateDraft } from "../../autosave.ts";
import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import { validateStep } from "../../validation.ts";
import { readMetaLiveCampaign } from "../../meta/import/readers.ts";
import { mapMetaLiveCampaign } from "../../meta/import/map.ts";
import { buildMetaImportPicker, defaultMetaImportCarry } from "../../meta/import/picker.ts";
import type { MetaImportRecordedCall, MetaLiveCampaignBundle } from "../../meta/import/types.ts";
import { duplicateAdSetSuggestion } from "../adset-suggestions.ts";
import { generateSuggestions } from "../generate-adset-suggestions.ts";
import {
  IMPORT_OBJECTIVE_NEW_CAMPAIGN_NOTICE,
  importedAccountProblem,
  isAbsoluteHttpUrl,
  objectivePixelProblem,
  setEveryCreativeDestinationUrl,
} from "../import-edits.ts";
import type { CampaignDraft, LocationTargetingGroup } from "../../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
const FIXTURE = join(
  ROOT,
  "lib/meta/import/__fixtures__/captured/meta-import-capture-52522388611107.json",
);
const ACCOUNT = "act_1967530076312";

function src(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

async function capturedBundle(): Promise<MetaLiveCampaignBundle> {
  const calls = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { calls: MetaImportRecordedCall[] }).calls;
  const gets = calls.filter((c) => c.method === "GET");
  const posts = calls.filter((c) => c.method === "POST");
  let postAt = 0;
  return readMetaLiveCampaign({
    adAccountId: ACCOUNT,
    campaignId: "52522388611107",
    token: "token",
    request: {
      get: async (path, params) => {
        const after = params.after ?? "";
        const call = gets.find((row) => row.path === path && String(row.params.after ?? "") === after);
        if (!call) throw new Error(`no recorded GET ${path} after=${after}`);
        return call.data;
      },
      post: async () => {
        const call = posts[postAt++];
        if (!call) throw new Error("no recorded POST");
        return call.data;
      },
    },
    sleep: async () => {},
  });
}

async function importedDraft(): Promise<CampaignDraft> {
  const bundle = await capturedBundle();
  const ids = new Set<string>();
  for (const adSet of bundle.adSets) {
    const t = adSet.targeting as { custom_audiences?: { id?: string }[] };
    for (const a of t.custom_audiences ?? []) if (a.id) ids.add(a.id);
  }
  const mapped = mapMetaLiveCampaign({
    bundle,
    adAccountId: ACCOUNT,
    carry: defaultMetaImportCarry(buildMetaImportPicker(bundle)),
    availability: [...ids].map((id) => ({ id, available: true })),
  });
  return migrateDraft(JSON.parse(JSON.stringify(mapped)));
}

const FALLBACK: LocationTargetingGroup = {
  id: "preset_gb_nationwide",
  label: "UK (nationwide)",
  source: "preset",
  selections: [
    { id: "gb", source: "preset", label: "United Kingdom", mode: "include", locationType: "country", countryCode: "GB" },
  ],
};

describe("§0 imported ad sets carry their source ad set id", () => {
  it("every mapped row carries the id it was read from; a manual row does not", async () => {
    const draft = await importedDraft();
    assert.ok(draft.adSetSuggestions.length > 0);
    for (const row of draft.adSetSuggestions) {
      assert.match(row.importedFromAdSetId ?? "", /^\d+$/, row.name);
      assert.equal(row.importedFromAdSetId, row.id);
      assert.equal(row.metaAdSetId, undefined, "the deprecated launch field stays empty");
    }
    const manual = generateSuggestions(
      { ...draft.audiences, customAudienceGroups: [{ id: "new", name: "New", audienceIds: ["1"] }], pageGroups: [], interestGroups: [], savedAudiences: { audienceIds: [] } } as CampaignDraft["audiences"],
      100,
      [],
      FALLBACK,
    );
    assert.ok(manual.length > 0);
    for (const row of manual) assert.equal(row.importedFromAdSetId, undefined);
  });

  it("a duplicated imported row is not marked as imported", async () => {
    const draft = await importedDraft();
    const next = duplicateAdSetSuggestion(draft.adSetSuggestions, draft.adSetSuggestions[0].id);
    assert.equal(next.length, draft.adSetSuggestions.length + 1);
    const copy = next.find((s) => !draft.adSetSuggestions.some((o) => o.id === s.id));
    assert.ok(copy);
    assert.equal(copy.importedFromAdSetId, undefined);
  });

  it("migrateDraft keeps the field (no migration needed)", async () => {
    const draft = await importedDraft();
    const round = migrateDraft(JSON.parse(JSON.stringify(draft)));
    assert.deepEqual(
      round.adSetSuggestions.map((s) => s.importedFromAdSetId),
      draft.adSetSuggestions.map((s) => s.importedFromAdSetId),
    );
  });

  it("Step 5 renders a badge only where the id is set", () => {
    const source = src("components/steps/budget-schedule.tsx");
    assert.match(source, /s\.importedFromAdSetId \? \(/);
    assert.match(source, /title=\{importedAdSetTitle\(s\.importedFromAdSetId\)\}/);
    assert.match(source, /\{IMPORTED_AD_SET_BADGE\} · \{s\.importedFromAdSetId\}/);
  });
});

describe("§1 adding audiences leaves imported rows alone", () => {
  it("the Audiences step writes audiences and never Step 5", () => {
    const step = src("components/steps/audiences/audiences-step.tsx");
    assert.match(step, /onChange: \(audiences: AudienceSettings\) => void/);
    assert.doesNotMatch(step, /onSuggestionsChange/);
    const shell = src("components/wizard/wizard-shell.tsx");
    const block = shell.slice(shell.indexOf("<AudiencesStep"), shell.indexOf("<Creatives"));
    assert.match(block, /onChange=\{updateAudiences\}/);
    assert.doesNotMatch(block, /updateAdSetSuggestions/);
    const doctrine = src("lib/wizard/import-edits.ts");
    assert.match(doctrine, /never touches/);
    assert.match(doctrine, /replaces every row/);
  });

  it("Generate replaces the suggestion list instead of keeping imported rows", () => {
    const budget = src("components/steps/budget-schedule.tsx");
    assert.doesNotMatch(budget, /mergeGeneratedWithImported/);
    assert.match(
      budget,
      /applyWithUndo\(generateRebuiltNotice\(next\.length, adSetSuggestions\.length\), next\)/,
    );
  });

  it("an account change after import does not block", async () => {
    const draft = await importedDraft();
    assert.equal(importedAccountProblem(draft), null);
    const moved = { ...draft, settings: { ...draft.settings, metaAdAccountId: "act_42", adAccountId: "act_42" } };
    assert.equal(importedAccountProblem(moved), null);
    assert.equal(validateStep(0, moved).errors.some((error) => /re-import/.test(error)), false);
    assert.equal(validateStep(0, moved).valid, true);
  });
});

describe("§2 objective change re-derives", () => {
  function withObjective(draft: CampaignDraft, objective: CampaignDraft["settings"]["objective"], pixel: string) {
    return {
      ...draft,
      settings: { ...draft.settings, objective, optimisationGoal: "conversions" as const, metaPixelId: pixel, pixelId: pixel },
    };
  }

  it("Purchase with no pixel blocks and names the objective", async () => {
    const draft = withObjective(await importedDraft(), "purchase", "");
    const problem = objectivePixelProblem(draft);
    assert.equal(problem, "Purchase optimises for a pixel conversion event: no pixel configured for this ad account.");
    assert.ok(validateStep(1, draft).errors.includes(problem!));
  });

  it("with a pixel it does not block; traffic never needs one", async () => {
    const base = await importedDraft();
    assert.equal(objectivePixelProblem(withObjective(base, "purchase", "33782234934753151")), null);
    assert.equal(
      objectivePixelProblem({ ...base, settings: { ...base.settings, objective: "traffic", optimisationGoal: "link_clicks", metaPixelId: "", pixelId: "" } }),
      null,
    );
  });

  it("the check calls adset.ts's derivation rather than copying anything from the source", () => {
    const source = src("lib/wizard/import-edits.ts");
    assert.match(source, /resolveOptimisationGoal\(/);
    assert.match(source, /buildPromotedObject\(/);
    assert.equal(/custom_event_type|OFFSITE_CONVERSIONS/.test(source), false);
    assert.equal(/\/stats|adspixels/.test(source), false, "no claim to verify the event fired");
  });

  it("the objective card says launch creates a new campaign, in text not a tooltip", () => {
    const source = src("components/steps/campaign-setup.tsx");
    assert.match(source, /\{IMPORT_OBJECTIVE_NEW_CAMPAIGN_NOTICE\}/);
    assert.match(IMPORT_OBJECTIVE_NEW_CAMPAIGN_NOTICE, /new campaign/);
    assert.match(IMPORT_OBJECTIVE_NEW_CAMPAIGN_NOTICE, /keeps running and keeps spending/);
    assert.match(src("components/plan/meta-drawer-details.tsx"), /importedFrom=\{draft\.importMeta \?\? null\}/);
  });
});

describe("§3 URLs", () => {
  it("set every creative changes an imported creative's destinationUrl", async () => {
    const draft = await importedDraft();
    assert.ok(draft.creatives.length > 0);
    const old = draft.creatives[0].destinationUrl;
    const url = "https://ironworks.example/on-sale";
    assert.notEqual(old, url);
    const next = setEveryCreativeDestinationUrl(draft.creatives, `  ${url} `);
    assert.equal(next[0].destinationUrl, url);
    assert.ok(next.every((c) => c.destinationUrl === url));
    assert.equal(next[0].id, draft.creatives[0].id);
  });

  it("Step 4 wires the control to the helper", () => {
    const source = src("components/steps/creatives.tsx");
    assert.match(source, /onChange\(setEveryCreativeDestinationUrl\(creatives, everyUrl\)\)/);
    assert.match(source, /disabled=\{!everyUrlValid\}/);
  });

  it("a relative URL blocks launch", () => {
    assert.equal(isAbsoluteHttpUrl("/tickets"), false);
    assert.equal(isAbsoluteHttpUrl("ftp://x.com"), false);
    assert.equal(isAbsoluteHttpUrl("https://x.com/t"), true);
    const draft = createDefaultDraft();
    draft.creatives = [{ ...createDefaultCreative(), name: "A", destinationUrl: "/tickets" }];
    const errors = validateStep(4, draft).errors;
    assert.ok(errors.some((e) => /URL/i.test(e)), JSON.stringify(errors));
  });
});

function collectTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "__fixtures__") continue;
      out.push(...collectTs(full));
    } else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("launching an imported draft makes a new campaign", () => {
  it("the import is a new-mode draft that points at no existing campaign", async () => {
    const draft = await importedDraft();
    assert.equal(draft.settings.wizardMode ?? "new", "new");
    assert.equal(draft.settings.existingMetaCampaign, undefined);
    assert.equal(draft.settings.existingMetaCampaigns, undefined);
    assert.ok(draft.importMeta?.sourceCampaignId);
  });

  it("no launch-path file reads the source campaign or the imported marker", () => {
    const files = [
      join(ROOT, "app/api/meta/launch-campaign/route.ts"),
      ...collectTs(join(ROOT, "lib/meta")).filter((f) => !f.includes("/lib/meta/import/")),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.equal(/importMeta|sourceCampaignId|importedFromAdSetId/.test(source), false, file);
    }
  });

  it("the edit helpers write nothing to Meta", () => {
    const source = src("lib/wizard/import-edits.ts");
    assert.equal(/\b(graphPost[A-Za-z]*|createMeta[A-Za-z]+|fetch)\s*\(/.test(source), false);
  });
});
