import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { migrateTikTokDraft } from "../../../tiktok-wizard/migrate-draft.ts";
import { tiktokGet } from "../../client.ts";
import { collectTikTokLaunchPreflight } from "../../write/preflight.ts";

type TikTokGet = typeof tiktokGet;

function mockGet(
  impl: (path: string, params: Record<string, unknown>) => Promise<unknown>,
): TikTokGet {
  return (async (path, params) => impl(path, params)) as TikTokGet;
}
import {
  LEGACY_CAMPAIGN_GET,
  LEGACY_SPC_GET,
  MANUAL_AD_GET,
  MANUAL_ADGROUP_GET,
  MANUAL_CAMPAIGN_GET,
  UPGRADED_AD_GET_ALL,
  UPGRADED_ADGROUP_GET,
  UPGRADED_CAMPAIGN_GET,
  UPGRADED_SMART_PLUS_AD_GET,
} from "../__fixtures__/ironworks-v1.3.ts";
import { finalizeTikTokImportDraft, mapTikTokLiveCampaignToDraft } from "../map.ts";
import {
  fetchTikTokAds,
  fetchTikTokSmartPlusAds,
  listTikTokLiveCampaigns,
  readTikTokLiveCampaign,
} from "../readers.ts";
import {
  TIKTOK_IMPORT_PATHS,
  classifyTikTokCampaign,
  formatTikTokImportCreativeCounts,
  formatTikTokImportDroppedLine,
  formatTikTokImportEnhancementLine,
} from "../types.ts";

const ACCOUNT = {
  tiktokAccountId: "acct-1",
  advertiserId: "7639802149165301776",
};

describe("classifyTikTokCampaign", () => {
  it("reads the two /campaign/get/ flags", () => {
    assert.equal(
      classifyTikTokCampaign({
        campaign_automation_type: "MANUAL",
        is_smart_performance_campaign: false,
      }),
      "manual",
    );
    assert.equal(
      classifyTikTokCampaign({
        campaign_automation_type: "UPGRADED_SMART_PLUS",
        is_smart_performance_campaign: false,
      }),
      "smart_plus",
    );
    assert.equal(
      classifyTikTokCampaign({
        campaign_automation_type: "SMART_PLUS",
        is_smart_performance_campaign: true,
      }),
      "legacy_smart_plus",
    );
    assert.equal(
      classifyTikTokCampaign({ is_smart_performance_campaign: true }),
      "legacy_smart_plus",
    );
  });
});

describe("map manual campaign", () => {
  it("keeps targeting, budget, pixel, identity, video_id and an empty dropped list", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      {
        kind: "manual",
        campaign: MANUAL_CAMPAIGN_GET,
        adGroups: [MANUAL_ADGROUP_GET],
        ads: [MANUAL_AD_GET],
        chosenAds: [MANUAL_AD_GET],
        autoAddedAds: [],
        spc: null,
      },
      "draft-manual",
      ACCOUNT,
    );
    assert.equal(mapped.campaignSetup.objective, "LEAD_GENERATION");
    assert.equal(mapped.campaignSetup.optimisationGoal, "CONVERSION");
    assert.equal(mapped.campaignSetup.bidStrategy, "LOWEST_COST");
    assert.equal(mapped.accountSetup.pixelId, "7644201699552690194");
    assert.equal(mapped.accountSetup.optimisationEvent, "ON_WEB_REGISTER");
    assert.equal(mapped.accountSetup.identityId, "identity-ironworks");
    assert.equal(mapped.accountSetup.identityType, "BC_AUTH_TT");
    assert.deepEqual(mapped.audiences.locationCodes, ["GB"]);
    assert.equal(mapped.audiences.ageMin, 18);
    assert.equal(mapped.audiences.ageMax, 34);
    assert.equal(mapped.budgetSchedule.budgetAmount, 80);
    assert.equal(mapped.budgetSchedule.adGroups[0]?.budget, 80);
    assert.equal(mapped.creatives.items[0]?.videoId, "v901");
    assert.equal(mapped.creatives.items[0]?.mode, "VIDEO_REFERENCE");
    assert.deepEqual(mapped.importMeta?.dropped, []);
    assert.equal(mapped.optimisation.smartPlusEnabled, false);
    assert.notEqual(mapped.optimisation.bidStrategy, "SMART_PLUS");
  });
});

describe("map upgraded Smart+", () => {
  it("unwraps targeting_spec, lists Smart+-only fields, and shows both creative counts", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      {
        kind: "smart_plus",
        campaign: UPGRADED_CAMPAIGN_GET,
        adGroups: [UPGRADED_ADGROUP_GET],
        ads: UPGRADED_AD_GET_ALL,
        chosenAds: [UPGRADED_SMART_PLUS_AD_GET],
        autoAddedAds: [UPGRADED_AD_GET_ALL[2]!],
        spc: null,
      },
      "draft-upgraded",
      ACCOUNT,
    );
    assert.equal(mapped.campaignSetup.objective, "CONVERSIONS");
    assert.equal(mapped.campaignSetup.salesDestination, "WEBSITE");
    assert.deepEqual(mapped.audiences.locationCodes, ["GB"]);
    assert.equal(mapped.audiences.ageMin, 25);
    assert.equal(mapped.audiences.ageMax, 44);
    assert.equal(mapped.optimisation.smartPlusEnabled, false);
    assert.notEqual(mapped.campaignSetup.bidStrategy, "SMART_PLUS");
    const fields = (mapped.importMeta?.dropped ?? []).map((item) => item.field);
    assert.ok(fields.includes("smart_audience_enabled"));
    assert.ok(fields.includes("creative_auto_add_toggle"));
    assert.ok(fields.includes("budget_auto_adjust_strategy"));
    const audience = mapped.importMeta?.dropped.find(
      (item) => item.field === "smart_audience_enabled",
    );
    assert.equal(audience?.sourceValue, true);
    assert.equal(mapped.importMeta?.creativeCounts?.chosen, 2);
    assert.equal(mapped.importMeta?.creativeCounts?.tiktokAdded, 1);
    assert.equal(mapped.creatives.items.length, 3);
    assert.ok(mapped.creatives.items.some((item) => item.videoId === "v-chosen-1"));
    assert.ok(mapped.creatives.items.some((item) => item.videoId === "v-auto-1"));
    assert.match(
      formatTikTokImportDroppedLine(mapped.importMeta?.dropped ?? []) ?? "",
      /automatic audience expansion \(was on\)/,
    );
    assert.equal(
      formatTikTokImportCreativeCounts(mapped.importMeta!.creativeCounts!),
      "2 creatives you chose, 1 TikTok added.",
    );
    assert.match(
      formatTikTokImportEnhancementLine(mapped.importMeta!.sourceEnhancements),
      /enhancements ON \(is_aco true on 3 of 3\)/,
    );
  });
});

describe("map legacy Smart+", () => {
  it("reads the single /campaign/spc/get/ object", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      {
        kind: "legacy_smart_plus",
        campaign: LEGACY_CAMPAIGN_GET,
        adGroups: [],
        ads: [],
        chosenAds: [],
        autoAddedAds: [],
        spc: LEGACY_SPC_GET,
      },
      "draft-legacy",
      ACCOUNT,
    );
    assert.equal(mapped.campaignSetup.objective, "TRAFFIC");
    assert.equal(mapped.campaignSetup.optimisationGoal, "CLICK");
    assert.equal(mapped.creatives.items[0]?.videoId, "v-legacy-1");
    assert.equal(mapped.creatives.items[1]?.videoId, "v-legacy-2");
    assert.equal(mapped.creatives.items[0]?.title, "Legacy title one");
    const dropped = (mapped.importMeta?.dropped ?? []).map((item) => item.field);
    assert.ok(dropped.includes("spc_audience_age"));
    assert.ok(dropped.includes("smart_audience_enabled"));
    assert.equal(mapped.optimisation.smartPlusEnabled, false);
  });
});

describe("finalizeTikTokImportDraft", () => {
  it("goes through duplicateTikTokDraftState: empty publishedIds, relaunch name, healed schedule", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      {
        kind: "manual",
        campaign: MANUAL_CAMPAIGN_GET,
        adGroups: [MANUAL_ADGROUP_GET],
        ads: [MANUAL_AD_GET],
        chosenAds: [MANUAL_AD_GET],
        autoAddedAds: [],
        spc: null,
      },
      "mapped",
      ACCOUNT,
    );
    mapped.publishedIds = {
      campaignId: "do-not-keep",
      adgroupIds: ["x"],
      adIds: ["y"],
      launchedAt: "2026-01-01T00:00:00.000Z",
    };
    const now = new Date("2026-09-14T12:00:00.000Z");
    const copy = finalizeTikTokImportDraft(mapped, "copy-1", [], now);
    assert.equal(copy.id, "copy-1");
    assert.equal(copy.publishedIds, null);
    assert.equal(copy.campaignSetup.campaignName, "[IRW] Manual fixture — relaunch");
    assert.equal(copy.optimisation.smartPlusEnabled, false);
    assert.ok(copy.importMeta);
    assert.equal(copy.status, "draft");
    assert.notEqual(
      copy.budgetSchedule.scheduleStartAt,
      MANUAL_ADGROUP_GET.schedule_start_time,
    );
  });

  it("keeps importMeta through migrateTikTokDraft", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      {
        kind: "smart_plus",
        campaign: UPGRADED_CAMPAIGN_GET,
        adGroups: [UPGRADED_ADGROUP_GET],
        ads: UPGRADED_AD_GET_ALL,
        chosenAds: [UPGRADED_SMART_PLUS_AD_GET],
        autoAddedAds: [UPGRADED_AD_GET_ALL[2]!],
        spc: null,
      },
      "mapped-up",
      ACCOUNT,
    );
    const copy = finalizeTikTokImportDraft(mapped, "copy-up");
    const migrated = migrateTikTokDraft(JSON.parse(JSON.stringify(copy)));
    assert.equal(migrated.importMeta?.sourceKind, "smart_plus");
    assert.ok((migrated.importMeta?.dropped.length ?? 0) > 0);
  });

  it("does not set SMART_PLUS so preflight's Smart+ blockers stay closed", () => {
    const mapped = mapTikTokLiveCampaignToDraft(
      {
        kind: "smart_plus",
        campaign: UPGRADED_CAMPAIGN_GET,
        adGroups: [UPGRADED_ADGROUP_GET],
        ads: UPGRADED_AD_GET_ALL,
        chosenAds: [UPGRADED_SMART_PLUS_AD_GET],
        autoAddedAds: [],
        spc: null,
      },
      "mapped-preflight",
      ACCOUNT,
    );
    const copy = finalizeTikTokImportDraft(mapped, "copy-preflight");
    copy.eventId = "00000000-0000-0000-0000-000000000002";
    copy.accountSetup.timezone = "Europe/London";
    copy.accountSetup.currency = "GBP";
    const { issues } = collectTikTokLaunchPreflight(copy, {
      now: new Date("2026-09-14T12:00:00.000Z"),
    });
    assert.equal(
      issues.some(
        (issue) => issue.id === "smart-plus" || issue.id === "smart-plus-bid",
      ),
      false,
    );
  });
});

describe("readers", () => {
  it("lists campaigns from /campaign/get/ with the two flags", async () => {
    const calls: Array<{ path: string; params: Record<string, unknown> }> = [];
    const rows = await listTikTokLiveCampaigns({
      advertiserId: ACCOUNT.advertiserId,
      token: "token",
      request: mockGet(async (path, params) => {
        calls.push({ path, params });
        assert.equal(path, "/campaign/get/");
        return {
          list: [MANUAL_CAMPAIGN_GET, UPGRADED_CAMPAIGN_GET, LEGACY_CAMPAIGN_GET],
          page_info: { page: 1, total_page: 1 },
        };
      }),
    });
    assert.deepEqual(
      rows.map((row) => row.kind),
      ["manual", "smart_plus", "legacy_smart_plus"],
    );
    assert.ok(
      (calls[0]?.params.fields as string[]).includes("campaign_automation_type"),
    );
    assert.ok(
      (calls[0]?.params.fields as string[]).includes("is_smart_performance_campaign"),
    );
  });

  it("never sends ad_ids_v2 and pages /smart_plus/ad/get/ at 100", async () => {
    const calls: Array<{ path: string; params: Record<string, unknown> }> = [];
    await fetchTikTokSmartPlusAds({
      advertiserId: ACCOUNT.advertiserId,
      campaignId: "upgraded-campaign-1",
      token: "token",
      request: mockGet(async (path, params) => {
        calls.push({ path, params });
        return { list: [], page_info: { page: 1, total_page: 1 } };
      }),
    });
    assert.equal(calls[0]?.path, "/smart_plus/ad/get/");
    assert.equal(calls[0]?.params.page_size, 100);
    assert.equal("ad_ids_v2" in (calls[0]?.params ?? {}), false);
    await fetchTikTokAds({
      advertiserId: ACCOUNT.advertiserId,
      campaignId: "upgraded-campaign-1",
      token: "token",
      filtering: { campaign_automation_type: "UPGRADED_SMART_PLUS" },
      request: mockGet(async (path, params) => {
        calls.push({ path, params });
        return { list: [], page_info: { page: 1, total_page: 1 } };
      }),
    });
    const adGet = calls.find((call) => call.path === "/ad/get/");
    assert.ok(adGet);
    assert.equal("ad_ids_v2" in adGet.params, false);
    assert.equal(
      (adGet.params.filtering as { campaign_automation_type?: string })
        .campaign_automation_type,
      "UPGRADED_SMART_PLUS",
    );
  });

  it("routes the three generations onto the six allowed paths only", async () => {
    const seen: string[] = [];
    const request = mockGet(async (path) => {
      seen.push(path);
      if (path === "/campaign/get/") {
        return {
          list: [UPGRADED_CAMPAIGN_GET],
          page_info: { page: 1, total_page: 1 },
        };
      }
      return { list: [], page_info: { page: 1, total_page: 1 } };
    });
    await readTikTokLiveCampaign({
      advertiserId: ACCOUNT.advertiserId,
      campaignId: "upgraded-campaign-1",
      token: "token",
      request,
    });
    for (const path of seen) {
      assert.ok(
        (TIKTOK_IMPORT_PATHS as readonly string[]).includes(path),
        `unexpected path ${path}`,
      );
    }
    assert.ok(seen.includes("/smart_plus/adgroup/get/"));
    assert.ok(seen.includes("/smart_plus/ad/get/"));
    assert.ok(seen.includes("/ad/get/"));
  });
});

describe("import path allowlist", () => {
  it("mentions only the six named TikTok paths under lib/tiktok/import", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const files = collectTsFiles(root).filter(
      (file) => !file.includes("/__tests__/") && !file.includes("/__fixtures__/"),
    );
    const allowed = new Set(TIKTOK_IMPORT_PATHS);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/"(\/[a-z0-9_/]+\/)"/g)) {
        const path = match[1]!;
        if (!path.includes("/")) continue;
        if (
          path.startsWith("/campaign/") ||
          path.startsWith("/ad") ||
          path.startsWith("/smart_plus/") ||
          path.startsWith("/file/") ||
          path.startsWith("/tools/") ||
          path.startsWith("/identity/") ||
          path.startsWith("/pixel/")
        ) {
          assert.ok(allowed.has(path as (typeof TIKTOK_IMPORT_PATHS)[number]), `${file} has ${path}`);
        }
      }
    }
  });

  it("does not edit lib/tiktok/write — import only reads mapping tables", () => {
    const writeDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../write",
    );
    const importMentions = collectTsFiles(writeDir).filter((file) =>
      readFileSync(file, "utf8").includes("tiktok/import"),
    );
    assert.deepEqual(importMentions, []);
  });
});

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}
