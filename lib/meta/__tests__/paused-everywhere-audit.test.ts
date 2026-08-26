import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildAdSetPayload } from "../adset.ts";
import { buildAdPayload } from "../creative.ts";
import { resolveMetaLaunchEntityStatus } from "../launch-status.ts";
import type {
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
} from "../../types.ts";

function source(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function makeAdSet(): AdSetSuggestion {
  return {
    id: "s1",
    name: "Test Ad Set",
    sourceType: "interest_group",
    sourceId: "g1",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 10,
    advantagePlus: false,
    enabled: true,
  } as AdSetSuggestion;
}

const emptyAudiences = {
  interestGroups: [],
  customAudienceGroups: [],
  pageGroups: [],
  savedAudiences: [],
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

const emptySchedule = {
  startDate: "",
  endDate: "",
  adSets: [],
} as unknown as BudgetScheduleSettings;

describe("paused-everywhere inventory (audit D6)", () => {
  it("TikTok write mapping still creates ad groups and ads DISABLE", () => {
    const mapping = source("lib/tiktok/write/mapping.ts");
    assert.match(mapping, /operation_status:\s*["']DISABLE["']/);
    const matches = mapping.match(/operation_status:\s*["']DISABLE["']/g) ?? [];
    assert.ok(
      matches.length >= 2,
      `expected TikTok ad-group and ad payloads to set DISABLE, found ${matches.length}`,
    );
    assert.doesNotMatch(mapping, /operation_status:\s*["']ENABLE["']/);
  });

  it("Google campaign writer still creates campaign, ad group, and RSA PAUSED", () => {
    const writer = source("lib/google-ads/campaign-writer.ts");
    assert.match(writer, /status:\s*["']PAUSED["']/);
    const paused = writer.match(/status:\s*["']PAUSED["']/g) ?? [];
    assert.ok(
      paused.length >= 3,
      `expected Google campaign + ad group + RSA to be PAUSED, found ${paused.length}`,
    );
  });

  it("resolveMetaLaunchEntityStatus defaults ACTIVE and pins PAUSED for plan fan-out", () => {
    assert.equal(resolveMetaLaunchEntityStatus(), "ACTIVE");
    assert.equal(resolveMetaLaunchEntityStatus({}), "ACTIVE");
    assert.equal(resolveMetaLaunchEntityStatus({ createPaused: false }), "ACTIVE");
    assert.equal(resolveMetaLaunchEntityStatus({ createPaused: true }), "PAUSED");
  });

  it("buildAdSetPayload / buildAdPayload stay ACTIVE unless createPaused is requested", () => {
    const activeAdSet = buildAdSetPayload(
      makeAdSet(),
      "cam_001",
      emptyAudiences,
      emptySchedule,
      "conversions",
      "registration",
    );
    const pausedAdSet = buildAdSetPayload(
      makeAdSet(),
      "cam_001",
      emptyAudiences,
      emptySchedule,
      "conversions",
      "registration",
      undefined,
      undefined,
      undefined,
      undefined,
      "PAUSED",
    );
    assert.equal(activeAdSet.status, "ACTIVE");
    assert.equal(pausedAdSet.status, "PAUSED");
    assert.equal(buildAdPayload("My Ad", "cre_001", "adset_001").status, "ACTIVE");
    assert.equal(buildAdPayload("My Ad", "cre_001", "adset_001", "PAUSED").status, "PAUSED");
  });

  it("launch-campaign threads entityStatus into new creates and does not pause attach parents", () => {
    const route = source("app/api/meta/launch-campaign/route.ts");
    assert.match(route, /createPaused/);
    assert.match(route, /resolveMetaLaunchEntityStatus/);
    assert.match(route, /withMetaWriteIdempotency/);
    const adSetCalls = route.match(/buildAdSetPayload\(([\s\S]*?)\);/g) ?? [];
    assert.ok(adSetCalls.length >= 6, `expected ≥6 buildAdSetPayload sites, found ${adSetCalls.length}`);
    const missingStatus = adSetCalls.filter((call) => !/\bentityStatus\b/.test(call));
    assert.equal(
      missingStatus.length,
      0,
      `every buildAdSetPayload call must forward entityStatus:\n${missingStatus.join("\n---\n")}`,
    );
    const adCalls = route.match(/buildAdPayload\(([\s\S]*?)\);/g) ?? [];
    assert.ok(adCalls.length >= 2, `expected ≥2 buildAdPayload sites, found ${adCalls.length}`);
    const missingAdStatus = adCalls.filter((call) => !/\bentityStatus\b/.test(call));
    assert.equal(
      missingAdStatus.length,
      0,
      `every buildAdPayload call must forward entityStatus:\n${missingAdStatus.join("\n---\n")}`,
    );
    // Attach path reuses a live campaign id — it must not call createMetaCampaign
    // with PAUSED, and must not update the live parent status.
    assert.match(route, /wizardMode === "attach_campaign"/);
    assert.doesNotMatch(route, /updateCampaign\([\s\S]*PAUSED/);
  });
});
