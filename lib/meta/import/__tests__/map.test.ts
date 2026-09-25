import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { migrateDraft } from "../../../autosave.ts";
import { validateStep } from "../../../validation.ts";
import { readMetaLiveCampaign } from "../readers.ts";
import { mapMetaLiveCampaign } from "../map.ts";
import { buildMetaImportPicker, defaultMetaImportCarry } from "../picker.ts";
import { handleMetaImport, metaImportUsageCallCount } from "../save.ts";
import type { MetaImportRecordedCall, MetaImportRequest, MetaLiveCampaignBundle } from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const IMPORT_ROOT = join(HERE, "..");
const FIXTURE = join(
  IMPORT_ROOT,
  "__fixtures__/captured/meta-import-capture-52522388611107.json",
);
const ACCOUNT = "act_1967530076312";
const OPERATOR = "b3ee4e5c-44e6-4684-acf6-efefbecd5858";

type Capture = { calls: MetaImportRecordedCall[] };

function loadCapture(): Capture {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as Capture;
}

function requestFromCapture(capture: Capture): MetaImportRequest {
  const gets = capture.calls.filter((call) => call.method === "GET");
  const posts = capture.calls.filter((call) => call.method === "POST");
  let postAt = 0;
  return {
    get: async (path, params) => {
      const after = params.after ?? "";
      const call = gets.find(
        (row) => row.path === path && String(row.params.after ?? "") === after,
      );
      if (!call) throw new Error(`no recorded GET ${path} after=${after}`);
      return call.data;
    },
    post: async () => {
      const call = posts[postAt];
      postAt += 1;
      if (!call) throw new Error("no recorded POST");
      return call.data;
    },
  };
}

async function capturedBundle(): Promise<MetaLiveCampaignBundle> {
  return readMetaLiveCampaign({
    adAccountId: ACCOUNT,
    campaignId: "52522388611107",
    token: "token",
    request: requestFromCapture(loadCapture()),
    sleep: async () => {},
  });
}

function availabilityAll(bundle: MetaLiveCampaignBundle, unavailableId: string) {
  const ids = new Set<string>();
  for (const adSet of bundle.adSets) {
    const targeting = adSet.targeting as { custom_audiences?: { id?: string }[] };
    for (const audience of targeting.custom_audiences ?? []) {
      if (audience.id) ids.add(audience.id);
    }
  }
  return [...ids].map((id) => ({ id, available: id !== unavailableId }));
}

function collectTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__fixtures__" || entry.name === "__tests__") continue;
      out.push(...collectTs(full));
    } else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("Ironworks capture maps to a draft", () => {
  const bundlePromise = capturedBundle();

  it("maps the objective through the reverse map and does not copy optimization_goal", async () => {
    const bundle = await bundlePromise;
    const unavailable = "52510222724707";
    const carry = defaultMetaImportCarry(buildMetaImportPicker(bundle));
    const draft = mapMetaLiveCampaign({
      bundle,
      adAccountId: ACCOUNT,
      carry,
      availability: availabilityAll(bundle, unavailable),
    });

    assert.equal(draft.settings.objective, "registration");
    assert.equal(draft.settings.optimisationGoal, "conversions");
    assert.equal(JSON.stringify(draft.settings).includes("OFFSITE_CONVERSIONS"), false);
    assert.equal(JSON.stringify(draft.settings).includes("promoted_object"), false);
    assert.ok(
      draft.importMeta?.dropped.some((row) => row.field === "optimization_goal" && row.value === "OFFSITE_CONVERSIONS"),
    );
    assert.ok(draft.importMeta?.dropped.some((row) => row.field === "promoted_object"));
    assert.equal(draft.adSetSuggestions.length, 33);

    const eu = draft.adSetSuggestions.find((row) => row.name.includes("Adv+ EU"));
    const uk = draft.adSetSuggestions.find((row) => row.name.includes("Adv+ UK"));
    assert.ok(eu && uk);
    assert.ok((eu.locationGroupIds?.length ?? 0) > 0);
    assert.ok((uk.locationGroupIds?.length ?? 0) > 0);
    const groups = draft.budgetSchedule.locationGroups ?? [];
    const euGroups = groups.filter((group) => eu.locationGroupIds?.includes(group.id));
    const euCountries = euGroups.flatMap((group) =>
      group.selections.filter((sel) => sel.locationType === "country").map((sel) => sel.countryCode),
    );
    assert.deepEqual(euCountries.sort(), ["DE", "ES", "FR", "IT", "PT"]);
    assert.equal(euGroups.some((group) => group.selections.some((sel) => sel.locationType === "city")), false);
    assert.equal(uk.locationGroupIds?.includes("country:GB"), true);
    assert.equal(
      groups.some((group) => group.selections.some((sel) => sel.tier != null)),
      false,
    );
    assert.equal(
      draft.adSetSuggestions.some((row) => row.locationTier != null),
      false,
    );

    const london = groups.find((group) => group.id === "city:812057:40:kilometer");
    assert.ok(london);
    const londonSel = london.selections[0];
    assert.equal(londonSel?.locationKey, "812057");
    assert.equal(londonSel?.radius, 40);
    assert.equal(londonSel?.distanceUnit, "kilometer");
    assert.equal(londonSel?.tier, undefined);

    const states = Object.values(draft.importMeta?.flexibleSpec ?? {});
    assert.equal(states.filter((row) => row.state === "absent").length, 30);
    assert.equal(states.filter((row) => row.state === "empty").length, 0);
    assert.equal(states.filter((row) => row.state === "present").length, 3);
    assert.equal(
      states.filter((row) => row.state === "absent").every((row) => row.interestIds.length === 0),
      true,
    );

    assert.equal(
      (draft.budgetSchedule.excludedLocations ?? []).length,
      0,
    );
    assert.equal(
      groups.every((group) => group.selections.every((sel) => sel.mode === "include")),
      true,
    );

    const carried = draft.audiences.customAudienceGroups.find((group) =>
      group.audienceIds.includes(unavailable),
    );
    assert.ok(carried);
    assert.equal(carried.audienceNames?.[unavailable], "Jamie Jones Pixel");
    assert.equal(
      draft.importMeta?.notCarried.some((row) => row.id === unavailable),
      false,
    );
    assert.equal(draft.creatives.every((creative) => creative.metaCreativeId), true);
    assert.equal(draft.creatives.length, carry.length);

    const kept = migrateDraft(JSON.parse(JSON.stringify(draft)) as Record<string, unknown>);
    assert.equal(kept.importMeta?.sourceCampaignId, "52522388611107");
  });

  it("puts an excluded geo in the campaign pool and leaves a zero-geo ad set for validateStep", async () => {
    const bundle = structuredClone(await bundlePromise);
    const cityAdSet = bundle.adSets.find((row) => {
      const geo = (row.targeting as { geo_locations?: { cities?: unknown[] } }).geo_locations;
      return (geo?.cities?.length ?? 0) > 0;
    });
    assert.ok(cityAdSet);
    const targeting = cityAdSet.targeting as {
      geo_locations: { cities: unknown[] };
      excluded_geo_locations?: unknown;
    };
    const city = targeting.geo_locations.cities[0];
    targeting.excluded_geo_locations = { cities: [structuredClone(city)] };

    const empty = bundle.adSets.find((row) => String(row.name).includes("Adv+ EU"));
    assert.ok(empty);
    (empty.targeting as { geo_locations: Record<string, unknown> }).geo_locations = {};
    empty.name = "Jamie Jones – Adv+ EU";

    const draft = mapMetaLiveCampaign({
      bundle,
      adAccountId: ACCOUNT,
      carry: [],
      availability: [],
    });
    const pool = draft.budgetSchedule.excludedLocations ?? [];
    assert.equal(pool.length, 1);
    assert.equal(pool[0]?.mode, "exclude");
    assert.equal(pool[0]?.locationKey, "812057");
    assert.equal(
      (draft.budgetSchedule.locationGroups ?? []).some((group) => group.id.startsWith("excl:")),
      false,
    );
    const owner = draft.adSetSuggestions.find((row) => row.id === cityAdSet.id);
    assert.deepEqual(owner?.excludedLocationIds, ["excl:city:812057:40:kilometer"]);

    const emptied = draft.adSetSuggestions.find((row) => row.name.includes("Adv+ EU"));
    assert.deepEqual(emptied?.locationGroupIds, []);
    const step = validateStep(5, { ...draft, adSetSuggestions: [emptied!] });
    assert.equal(step.valid, false);
    assert.match(step.errors.join("\n"), /Adv\+ EU/);
    assert.match(step.errors.join("\n"), /no locations/);
  });

  it("sends a creative with no resolvable asset to notCarried", async () => {
    const bundle = structuredClone(await bundlePromise);
    const [id, creative] = Object.entries(bundle.creatives)[0]!;
    delete creative.object_story_spec;
    delete creative.video_id;
    delete creative.asset_feed_spec;
    delete creative.image_hash;
    const draft = mapMetaLiveCampaign({
      bundle,
      adAccountId: ACCOUNT,
      carry: [id],
      availability: [],
    });
    assert.equal(draft.creatives.some((row) => row.id === id), false);
    assert.ok(
      draft.importMeta?.notCarried.some((row) => row.id === id && row.reason === "no_asset_reported"),
    );
  });

  it("refuses an unsupported objective instead of defaulting", async () => {
    const bundle = structuredClone(await bundlePromise);
    bundle.campaign.objective = "APP_INSTALLS";
    assert.throws(
      () =>
        mapMetaLiveCampaign({
          bundle,
          adAccountId: ACCOUNT,
          carry: [],
          availability: [],
        }),
      /not supported/,
    );
  });
});

describe("import save", () => {
  it("returns 400 and writes nothing when carry has no eventId", async () => {
    let saved = 0;
    const result = await handleMetaImport({
      userId: OPERATOR,
      body: { adAccountId: ACCOUNT, campaignId: "52522388611107", carry: ["1"] },
      supabase: {} as never,
      deps: {
        tokenForUser: async () => ({ token: "t" }),
        saveDraft: async () => {
          saved += 1;
        },
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "event_id is required");
    assert.equal(saved, 0);
  });

  it("carry [] saves nothing", async () => {
    let saved = 0;
    const result = await handleMetaImport({
      userId: OPERATOR,
      body: { adAccountId: ACCOUNT, campaignId: "52522388611107", carry: [] },
      supabase: {} as never,
      deps: {
        saveDraft: async () => {
          saved += 1;
        },
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.saved, false);
    assert.equal(saved, 0);
  });

  it("reports how far a zero-row read got, with app usage", async () => {
    const err = new Error("Meta import failed: /{campaign_id}/adsets returned no ad sets for 1");
    (err as Error & { metaImportProgress: unknown }).metaImportProgress = {
      adSetsRead: 0,
      adsRead: 0,
      creativesRead: 0,
    };
    const result = await handleMetaImport({
      userId: OPERATOR,
      body: { adAccountId: ACCOUNT, campaignId: "1" },
      supabase: {} as never,
      deps: {
        tokenForUser: async () => ({ token: "t" }),
        clientIdForAccount: async () => "client",
        readCampaign: async () => {
          throw err;
        },
        appUsageCallCount: () => metaImportUsageCallCount('{"call_count":40,"total_time":1,"total_cputime":1}'),
      },
    });
    assert.equal(result.status, 502);
    assert.match(String(result.body.error), /no ad sets/);
    assert.deepEqual(result.body.progress, { adSetsRead: 0, adsRead: 0, creativesRead: 0 });
    assert.equal(result.body.appUsageCallCount, 40);
  });
});

describe("importer writes nothing to Meta", () => {
  it("has no write helper and no location search", () => {
    const files = [
      ...collectTs(IMPORT_ROOT),
      join(HERE, "../../../../app/api/meta/campaigns/import/route.ts"),
    ];
    const write =
      /\b(createMeta[A-Za-z]+|createLookalikeAudience|createEngagementAudience|graphPost[A-Za-z]*)\s*\(/;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.equal(write.test(source), false, file);
      assert.equal(source.includes("location-search"), false, file);
      assert.equal(source.includes("fetchAdSetsForCampaign"), false, file);
    }
  });
});
