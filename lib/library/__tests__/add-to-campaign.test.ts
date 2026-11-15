import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import {
  ADD_SUBMODE_REQUIRED,
  addToCampaignHref,
  decideAddToCampaign,
  seedAddToCampaignDraft,
  type LiveCampaignForAdd,
} from "../add-to-campaign.ts";
import { archivedCampaignRefusal } from "../../meta/launch-error-classify.ts";
import { getVisibleSteps, type AdCreativeDraft, type CampaignDraft } from "../../types.ts";
import { validateStep } from "../../validation.ts";

const NOW = "2026-09-30T08:00:00.000Z";
const CAMPAIGN_ID = "120249428134610453";

const LIVE: LiveCampaignForAdd = {
  id: CAMPAIGN_ID,
  name: "Ahmed Spins",
  objective: "OUTCOME_SALES",
  status: "ACTIVE",
  effectiveStatus: "ACTIVE",
  buyingType: "AUCTION",
};

function publishedDraft(): CampaignDraft {
  const draft = createDefaultDraft();
  draft.id = "published-draft";
  draft.status = "published";
  draft.metaCampaignId = CAMPAIGN_ID;
  draft.launchSummary = {
    launchRunId: "run-1",
    metaCampaignId: CAMPAIGN_ID,
  };
  draft.settings.campaignName = "Ahmed Spins";
  draft.settings.objective = "purchase";
  draft.settings.optimisationGoal = "conversions";
  const first = createDefaultCreative();
  first.name = "Feed";
  first.identity = {
    pageId: "page-1",
    instagramAccountId: "ig-1",
    instagramActorId: "actor-1",
  };
  first.captions = [{ id: "cap-1", text: "On sale Friday" }];
  first.headline = "Ahmed Spins";
  first.description = "London";
  first.destinationUrl = "https://tickets.example/ahmed";
  first.cta = "book_now";
  first.metaCreativeId = "creative-old";
  first.metaAdIds = ["ad-old"];
  first.assetVariations = [
    {
      id: "var-1",
      name: "Variation 1",
      assets: [
        {
          id: "asset-1",
          aspectRatio: "4:5",
          uploadStatus: "uploaded",
          uploadedUrl: "https://cdn.example/feed.jpg",
          assetHash: "hash-1",
          videoId: "video-1",
          fileName: "feed.jpg",
        },
      ],
    },
  ];
  const second: AdCreativeDraft = {
    ...createDefaultCreative(),
    name: "Story",
    headline: "Do not copy me",
  };
  draft.creatives = [first, second];
  draft.adSetSuggestions = [
    {
      id: "set-1",
      name: "Prospecting",
      sourceType: "blank",
      sourceId: "",
      sourceName: "",
      ageMin: 18,
      ageMax: 65,
      budgetPerDay: 20,
      advantagePlus: false,
      enabled: true,
      metaAdSetId: "adset-old",
    },
  ];
  return draft;
}

describe("decideAddToCampaign", () => {
  it("accepts a live auction campaign and locks the snapshot", () => {
    const decision = decideAddToCampaign(LIVE, NOW);
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.objective, "purchase");
    assert.equal(decision.snapshot.id, CAMPAIGN_ID);
    assert.equal(decision.snapshot.name, "Ahmed Spins");
    assert.equal(decision.snapshot.effectiveStatus, "ACTIVE");
    assert.equal(decision.snapshot.objective, "OUTCOME_SALES");
    assert.equal(decision.snapshot.locked, true);
  });

  it("refuses an archived campaign with the #985 message", () => {
    const decision = decideAddToCampaign(
      { ...LIVE, effectiveStatus: "ARCHIVED" },
      NOW,
    );
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.message, archivedCampaignRefusal(CAMPAIGN_ID));
    assert.match(decision.message, /Unarchive it in Ads Manager/);
  });

  it("refuses a deleted campaign and an unsupported objective", () => {
    const deleted = decideAddToCampaign({ ...LIVE, effectiveStatus: "DELETED" }, NOW);
    assert.equal(deleted.ok, false);
    const odd = decideAddToCampaign({ ...LIVE, objective: "OUTCOME_APP_PROMOTION" }, NOW);
    assert.equal(odd.ok, false);
  });
});

describe("seedAddToCampaignDraft", () => {
  it("prefills copy from the first creative and leaves both mode cards unchosen", () => {
    const next = seedAddToCampaignDraft(publishedDraft(), LIVE, {
      id: "new-draft",
      now: NOW,
    });
    assert.equal(next.id, "new-draft");
    assert.equal(next.status, "draft");
    assert.equal(next.metaCampaignId, undefined);
    assert.equal(next.launchSummary, undefined);
    assert.equal(next.settings.wizardMode, "attach_campaign");
    assert.equal(next.settings.attachSubmodePending, true);
    assert.equal(next.settings.existingMetaCampaigns?.length, 1);
    assert.equal(next.settings.existingMetaCampaigns?.[0]?.locked, true);
    assert.equal(next.creatives.length, 1);
    const creative = next.creatives[0]!;
    assert.equal(creative.captions[0]?.text, "On sale Friday");
    assert.equal(creative.headline, "Ahmed Spins");
    assert.equal(creative.description, "London");
    assert.equal(creative.destinationUrl, "https://tickets.example/ahmed");
    assert.equal(creative.cta, "book_now");
    assert.equal(creative.identity.pageId, "page-1");
    assert.equal(creative.identity.instagramAccountId, "ig-1");
    assert.equal(creative.identity.instagramActorId, "actor-1");
    assert.equal(creative.metaCreativeId, undefined);
    assert.equal(creative.metaAdIds, undefined);
    assert.equal(creative.assetVariations[0]?.assets[0]?.uploadedUrl, undefined);
    assert.equal(creative.assetVariations[0]?.assets[0]?.assetHash, undefined);
    assert.equal(creative.assetVariations[0]?.assets[0]?.videoId, undefined);
    assert.equal(creative.assetVariations[0]?.assets[0]?.uploadStatus, "pending");
    assert.equal(creative.assetVariations[0]?.assets[0]?.aspectRatio, "4:5");
    assert.equal(next.adSetSuggestions[0]?.metaAdSetId, undefined);
    assert.equal(addToCampaignHref(next.id), "/campaign/new-draft");
    assert.equal(addToCampaignHref(next.id).includes("?"), false);
    assert.equal(addToCampaignHref(next.id).includes("mode"), false);

    const pending = validateStep(1, next);
    assert.equal(pending.valid, false);
    assert.ok(pending.errors.includes(ADD_SUBMODE_REQUIRED));

    const createNew = {
      ...next,
      settings: { ...next.settings, attachSubmodePending: false, wizardMode: "attach_campaign" as const },
    };
    assert.equal(validateStep(1, createNew).valid, true);
    assert.deepEqual(getVisibleSteps("attach_campaign"), [0, 1, 2, 3, 4, 5, 6, 7]);

    const attachAll = {
      ...next,
      settings: { ...next.settings, attachSubmodePending: false, wizardMode: "attach_all_adsets" as const },
    };
    assert.equal(validateStep(1, attachAll).valid, true);
    assert.deepEqual(getVisibleSteps("attach_all_adsets"), [0, 1, 4, 7]);
  });

  it("seeds one empty creative when the published draft has none", () => {
    const source = publishedDraft();
    source.creatives = [];
    const next = seedAddToCampaignDraft(source, LIVE, { id: "empty", now: NOW });
    assert.equal(next.creatives.length, 1);
    assert.equal(next.creatives[0]?.captions[0]?.text, "");
    assert.equal(next.creatives[0]?.assetVariations[0]?.assets[0]?.uploadStatus, "pending");
    assert.equal(next.creatives[0]?.assetVariations[0]?.assets[0]?.uploadedUrl, undefined);
  });

  it("does not seed an archived campaign", () => {
    assert.throws(
      () =>
        seedAddToCampaignDraft(
          publishedDraft(),
          { ...LIVE, effectiveStatus: "ARCHIVED" },
          { id: "nope", now: NOW },
        ),
      /archived in Meta/,
    );
  });
});

describe("Add to campaign wiring", () => {
  const root = join(import.meta.dirname, "..", "..", "..");
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");

  it("puts one Add to campaign button on published rows and no mode query", () => {
    const rows = read("components/library/library-rows.tsx");
    assert.match(rows, /c\.status === "published" && onAddToCampaign/);
    assert.match(rows, /label: "Add to campaign"/);
    assert.equal((rows.match(/label: "Add to campaign"/g) ?? []).length, 1);
    assert.doesNotMatch(rows, /Add to campaign ▾/);
    assert.doesNotMatch(rows, /mode=/);
    const library = read("components/library/campaign-library.tsx");
    assert.match(library, /addToCampaignHref\(next\.id\)/);
    assert.match(library, /\/api\/meta\/campaigns\/\$\{encodeURIComponent\(metaId\)\}/);
    assert.doesNotMatch(library, /[?&]mode=/);
    const wizard = read("components/wizard/wizard-shell.tsx");
    assert.match(wizard, /attachSubmodePending/);
    assert.match(wizard, /setStep\(1\)/);
    const launch = read("app/api/meta/launch-campaign/route.ts");
    assert.equal(launch.includes("attachSubmodePending"), false);
    const setup = read("components/steps/campaign-setup.tsx");
    assert.match(setup, /if \(next === mode && !submodePending\) return/);
    assert.match(setup, /camp\.locked \? null/);
  });

  it("renders the Selected campaign block from the live read with both cards unselected", () => {
    const script = join(import.meta.dirname, "render-add-to-campaign.ts");
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", script],
      { cwd: root, encoding: "utf8" },
    );
    const report = JSON.parse(out) as {
      name: boolean;
      objective: boolean;
      status: boolean;
      id: boolean;
      raw: boolean;
      createUnselected: boolean;
      attachAllUnselected: boolean;
      bothLabels: boolean;
      locked: boolean;
      picker: boolean;
    };
    assert.equal(report.name, true);
    assert.equal(report.objective, true);
    assert.equal(report.status, true);
    assert.equal(report.id, true);
    assert.equal(report.raw, true);
    assert.equal(report.createUnselected, true);
    assert.equal(report.attachAllUnselected, true);
    assert.equal(report.bothLabels, true);
    assert.equal(report.locked, true);
    assert.equal(report.picker, true);
  });
});
