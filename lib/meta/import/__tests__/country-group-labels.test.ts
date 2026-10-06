/**
 * Country-group names on the save path. DHB26-DUBAI's "DHB Primary – EU"
 * and "Wide – EU" target `country_groups: ["europe"]`. Every search
 * response here is a test stub, not a captured Meta payload.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import type { CampaignDraft, LocationSelection } from "../../../types.ts";
import { locationSearchQuery } from "../../location-search.ts";
import { mapMetaLiveCampaign } from "../map.ts";
import { buildMetaImportPicker, defaultMetaImportCarry } from "../picker.ts";
import { readMetaLiveCampaign } from "../readers.ts";
import {
  countryGroupKeysOf,
  defaultCountryGroupLabels,
  handleMetaImport,
  type MetaImportHandleDeps,
} from "../save.ts";
import type {
  MetaImportGraphGet,
  MetaImportRecordedCall,
  MetaImportRequest,
  MetaLiveCampaignBundle,
} from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURED = join(HERE, "../__fixtures__/captured");
const CAMPAIGN_ID = "120249957259050453";
const ACCOUNT = "act_968594768066330";
const OPERATOR = "b3ee4e5c-44e6-4684-acf6-efefbecd5858";
const EU_AD_SETS = {
  "120249960774180453": "DHB Primary – EU",
  "120249960739030453": "Wide – EU",
} as const;
const STUB_NAME = "Europe (stub hit)";
const STUB_CODES = ["AT", "BE", "FR"];

type Capture = { calls: MetaImportRecordedCall[] };

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
      const call = posts[postAt % posts.length];
      postAt += 1;
      if (!call) throw new Error("no recorded POST");
      return call.data;
    },
  };
}

const bundlePromise: Promise<MetaLiveCampaignBundle> = readMetaLiveCampaign({
  adAccountId: ACCOUNT,
  campaignId: CAMPAIGN_ID,
  token: "token",
  request: requestFromCapture(
    JSON.parse(
      readFileSync(join(CAPTURED, `meta-import-capture-${CAMPAIGN_ID}.json`), "utf8"),
    ) as Capture,
  ),
  sleep: async () => {},
});

type SearchCall = { path: string; params: Record<string, string>; token: string };

function stubSearch(respond: (params: Record<string, string>) => unknown): {
  get: MetaImportGraphGet;
  calls: SearchCall[];
} {
  const calls: SearchCall[] = [];
  return {
    calls,
    get: async (path, params, token) => {
      calls.push({ path, params, token });
      return respond(params);
    },
  };
}

const europeHit = () => ({
  data: [
    { key: "europe", name: STUB_NAME, type: "country_group", country_codes: STUB_CODES },
    { key: "eea", name: "European Economic Area", type: "country_group" },
  ],
});

async function importWith(
  bundle: MetaLiveCampaignBundle,
  extra: MetaImportHandleDeps,
): Promise<{ status: number; body: Record<string, unknown>; draft: CampaignDraft | null }> {
  let draft: CampaignDraft | null = null;
  const result = await handleMetaImport({
    userId: OPERATOR,
    body: {
      adAccountId: ACCOUNT,
      campaignId: CAMPAIGN_ID,
      carry: defaultMetaImportCarry(buildMetaImportPicker(bundle)),
      eventId: "e1",
    },
    supabase: {} as never,
    deps: {
      tokenForUser: async () => ({ token: "t" }),
      clientIdForAccount: async () => "client",
      loadEvent: async () =>
        ({ id: "e1", client_id: "client", meta_ad_account_id: ACCOUNT }) as never,
      readCampaign: async () => bundle,
      imageSizes: async () => ({}),
      saveDraft: async (saved) => {
        draft = saved;
      },
      ...extra,
    },
  });
  return { ...result, draft };
}

function graphWith(get: MetaImportGraphGet): MetaImportRequest {
  return {
    get,
    post: async () => {
      throw new Error("the importer must not POST");
    },
  };
}

function euSelection(draft: CampaignDraft, adSetName: string): LocationSelection {
  const row = draft.adSetSuggestions.find((item) => item.name === adSetName);
  assert.ok(row, adSetName);
  const groups = (draft.budgetSchedule.locationGroups ?? []).filter((group) =>
    row.locationGroupIds?.includes(group.id),
  );
  assert.equal(groups.length, 1, adSetName);
  const sel = groups[0]!.selections[0];
  assert.ok(sel, adSetName);
  return sel;
}

function unresolvedNames(draft: CampaignDraft): string[] {
  return (draft.importMeta?.dropped ?? [])
    .filter((row) => row.field === "label_unresolved")
    .map((row) => row.adSetName ?? "")
    .sort();
}

function assertUnresolvedEurope(draft: CampaignDraft) {
  for (const name of Object.values(EU_AD_SETS)) {
    const sel = euSelection(draft, name);
    assert.equal(sel.locationKey, "europe");
    assert.equal(sel.label, "europe");
    assert.equal(sel.memberCountryCodes, undefined);
  }
  assert.deepEqual(unresolvedNames(draft), Object.values(EU_AD_SETS).slice().sort());
}

describe("country-group keys", () => {
  it("dedupes keys across ad sets, included and excluded", async () => {
    const bundle = structuredClone(await bundlePromise);
    assert.deepEqual(countryGroupKeysOf(bundle), ["europe"]);

    const wide = bundle.adSets.find((row) => row.id === "120249960739030453");
    assert.ok(wide);
    (wide.targeting as Record<string, unknown>).excluded_geo_locations = {
      country_groups: [{ key: "eea" }, "europe"],
    };
    assert.deepEqual(countryGroupKeysOf(bundle).sort(), ["eea", "europe"]);
  });

  it("the DHB EU ad sets are the only country-group ad sets", async () => {
    const bundle = await bundlePromise;
    const withGroups = bundle.adSets.filter((row) => {
      const geo = (row.targeting as { geo_locations?: { country_groups?: unknown } } | undefined)
        ?.geo_locations;
      return Array.isArray(geo?.country_groups) && geo.country_groups.length > 0;
    });
    assert.deepEqual(
      Object.fromEntries(withGroups.map((row) => [row.id, row.name])),
      EU_AD_SETS,
    );
  });
});

describe("country-group labels on the save path", () => {
  it("two ad sets on europe → one search, both named from the hit", async () => {
    const bundle = await bundlePromise;
    const search = stubSearch(europeHit);
    const result = await importWith(bundle, { graph: graphWith(search.get) });

    assert.equal(result.status, 200);
    assert.equal(result.body.saved, true);
    assert.equal(search.calls.length, 1);
    assert.equal(search.calls[0]!.path, "/search");
    assert.deepEqual(search.calls[0]!.params, locationSearchQuery("europe", ["country_group"]));
    assert.equal(search.calls[0]!.token, "t");

    const draft = result.draft!;
    for (const name of Object.values(EU_AD_SETS)) {
      const sel = euSelection(draft, name);
      assert.equal(sel.locationType, "country_group");
      assert.equal(sel.locationKey, "europe");
      assert.notEqual(sel.label, "europe");
      assert.equal(sel.label, STUB_NAME);
      assert.deepEqual(sel.memberCountryCodes, STUB_CODES);
    }
    assert.deepEqual(unresolvedNames(draft), []);
  });

  it("an injected lookup is called once with every distinct key", async () => {
    const bundle = await bundlePromise;
    const seen: string[][] = [];
    const result = await importWith(bundle, {
      countryGroupLabels: async (keys) => {
        seen.push(keys);
        return { europe: { name: STUB_NAME, countryCodes: STUB_CODES } };
      },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(seen, [["europe"]]);
    assert.equal(euSelection(result.draft!, "Wide – EU").label, STUB_NAME);
  });

  it("a key the search does not return keeps the key and reports label_unresolved", async () => {
    const bundle = await bundlePromise;
    const search = stubSearch(() => ({
      data: [
        { key: "eea", name: "European Economic Area", type: "country_group" },
        { key: "europe_other", name: "Europe", type: "country_group" },
        { key: "europe", name: "Europe", type: "country" },
      ],
    }));
    const result = await importWith(bundle, { graph: graphWith(search.get) });
    assert.equal(result.status, 200);
    assert.equal(result.body.saved, true);
    assert.equal(search.calls.length, 1);
    assertUnresolvedEurope(result.draft!);
  });

  it("an empty search response keeps the key", async () => {
    const labels = await defaultCountryGroupLabels(
      ["europe"],
      "t",
      stubSearch(() => ({ data: [] })).get,
    );
    assert.deepEqual(labels, {});
  });

  it("a throwing search leaves the key unresolved and still saves", async () => {
    const bundle = await bundlePromise;
    const search = stubSearch(() => {
      throw new Error("(#17) User request limit reached");
    });
    const result = await importWith(bundle, { graph: graphWith(search.get) });
    assert.equal(result.status, 200);
    assert.equal(result.body.saved, true);
    assert.equal(search.calls.length, 1);
    assertUnresolvedEurope(result.draft!);
  });

  it("a rejecting injected lookup still saves", async () => {
    const bundle = await bundlePromise;
    const result = await importWith(bundle, {
      countryGroupLabels: async () => {
        throw new Error("lookup down");
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.saved, true);
    assertUnresolvedEurope(result.draft!);
  });

  it("one key failing does not stop the next key", async () => {
    const search = stubSearch((params) => {
      if (params.q === "eea") throw new Error("boom");
      return europeHit();
    });
    const labels = await defaultCountryGroupLabels(["eea", "europe", "europe"], "t", search.get);
    assert.equal(search.calls.length, 2);
    assert.deepEqual(labels, { europe: { name: STUB_NAME, countryCodes: STUB_CODES } });
  });
});

describe("DHB import with a europe hit", () => {
  function stripVolatile(draft: CampaignDraft): Record<string, unknown> {
    const copy = structuredClone(draft);
    delete copy.id;
    delete copy.createdAt;
    delete copy.updatedAt;
    if (copy.importMeta) delete copy.importMeta.eventAttachment;
    return copy as unknown as Record<string, unknown>;
  }

  it("names the two EU ad sets and matches the no-label import everywhere else", async () => {
    const bundle = await bundlePromise;
    const search = stubSearch(europeHit);
    const result = await importWith(bundle, { graph: graphWith(search.get) });
    assert.equal(result.status, 200);
    const labelled = result.draft!;

    const baseline = mapMetaLiveCampaign({
      bundle,
      adAccountId: ACCOUNT,
      carry: defaultMetaImportCarry(buildMetaImportPicker(bundle)),
      availability: [],
      appUsageCallCount: null,
      clientId: "client",
      eventId: "e1",
      imageSizes: {},
    });
    assertUnresolvedEurope(baseline);

    for (const name of Object.values(EU_AD_SETS)) {
      const sel = euSelection(labelled, name);
      assert.notEqual(sel.label, "europe");
      assert.equal(sel.label, STUB_NAME);
      assert.deepEqual(sel.memberCountryCodes, STUB_CODES);
    }
    assert.deepEqual(unresolvedNames(labelled), []);

    const v2 = labelled.adSetSuggestions.find((item) => item.name === "Wide – V2");
    assert.ok(v2);
    assert.deepEqual(
      (labelled.budgetSchedule.locationGroups ?? [])
        .filter((group) => v2.locationGroupIds?.includes(group.id))
        .flatMap((group) => group.selections.map((sel) => [sel.locationType, sel.countryCode])),
      [["country", "AE"]],
    );

    const expected = structuredClone(baseline);
    for (const group of expected.budgetSchedule.locationGroups ?? []) {
      if (group.id !== "country_group:europe") continue;
      group.label = STUB_NAME;
      for (const sel of group.selections) {
        sel.label = STUB_NAME;
        sel.memberCountryCodes = STUB_CODES;
      }
    }
    expected.importMeta!.dropped = expected.importMeta!.dropped.filter(
      (row) => row.field !== "label_unresolved",
    );
    assert.deepEqual(stripVolatile(labelled), stripVolatile(expected));
  });
});
