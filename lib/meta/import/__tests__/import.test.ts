import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { CREATIVE_BATCH_FIELDS } from "../../creative-batch-fields.ts";
import { recordingMetaGraph } from "../record.ts";
import { readMetaLiveCampaign } from "../readers.ts";
import { guardMetaImportRaw } from "../raw-guard.ts";
import {
  META_IMPORT_PATHS,
  classifyMetaImportPath,
  type MetaImportRequest,
} from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const IMPORT_ROOT = join(HERE, "..");

const ACCOUNT = "act_1967530076312";
const CAMPAIGN_ID = "52522388611107";

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function mockRequest(handlers: {
  get: MetaImportRequest["get"];
  post?: MetaImportRequest["post"];
}): MetaImportRequest {
  return {
    get: handlers.get,
    post:
      handlers.post ??
      (async () => {
        throw new Error("unexpected POST");
      }),
  };
}

const CAMPAIGN = {
  id: CAMPAIGN_ID,
  account_id: "1967530076312",
  name: "[IRW0001] Jamie Jones - Signups",
  objective: "OUTCOME_LEADS",
  status: "ACTIVE",
};

const ADSET = {
  id: "adset-1",
  name: "Streaming",
  campaign_id: CAMPAIGN_ID,
  targeting: {
    age_min: 18,
    age_max: 45,
    geo_locations: {
      cities: [{ key: "2643743", name: "London", radius: 30, distance_unit: "kilometer" }],
    },
    flexible_spec: [{ interests: [{ id: "6003107902330", name: "House music" }] }],
  },
};

const AD = {
  id: "ad-1",
  name: "JJ clip",
  adset_id: "adset-1",
  campaign_id: CAMPAIGN_ID,
  creative: { id: "cr-1" },
};

const CREATIVE = {
  id: "cr-1",
  name: "JJ clip",
  video_id: "v-1",
  object_story_spec: { video_data: { video_id: "v-1" } },
};

function liveGet(path: string): unknown {
  if (path === `/${CAMPAIGN_ID}`) return CAMPAIGN;
  if (path === `/${CAMPAIGN_ID}/adsets`) return { data: [ADSET] };
  if (path === `/${CAMPAIGN_ID}/ads`) return { data: [AD] };
  throw new Error(`unexpected GET ${path}`);
}

function livePost(): unknown {
  return [{ code: 200, body: JSON.stringify(CREATIVE) }];
}

describe("guardMetaImportRaw", () => {
  it("returns 401 without a session", () => {
    const result = guardMetaImportRaw({
      adAccountId: ACCOUNT,
      campaignId: CAMPAIGN_ID,
      userId: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
  });

  it("returns 403 for a user off the allowlist", () => {
    const result = guardMetaImportRaw({
      adAccountId: ACCOUNT,
      campaignId: CAMPAIGN_ID,
      userId: "00000000-0000-0000-0000-000000000000",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it("returns 400 when ids are missing", () => {
    const result = guardMetaImportRaw({
      adAccountId: null,
      campaignId: CAMPAIGN_ID,
      userId: "b3ee4e5c-44e6-4684-acf6-efefbecd5858",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  });
});

describe("recording request", () => {
  it("records path, params and verbatim data in call order", async () => {
    const { request, calls } = recordingMetaGraph(
      mockRequest({
        get: async (path) => ({ path }),
      }),
    );
    await request.get("/1", { fields: "id" }, "token");
    await request.get("/1/adsets", { fields: "id" }, "token");
    assert.deepEqual(
      calls.map((call) => call.path),
      ["/1", "/1/adsets"],
    );
    assert.equal(calls[0]?.ok, true);
    assert.deepEqual(calls[0]?.data, { path: "/1" });
  });

  it("records a rejected request and rethrows", async () => {
    const { request, calls } = recordingMetaGraph(
      mockRequest({
        get: async () => {
          throw new Error("fields: targeting is not valid");
        },
      }),
    );
    await assert.rejects(() => request.get("/1", { fields: "x" }, "token"));
    assert.equal(calls[0]?.ok, false);
    assert.match(calls[0]?.error?.message ?? "", /targeting is not valid/);
  });
});

describe("readMetaLiveCampaign", () => {
  const noSleep = async () => {};

  it("returns campaign, ad sets, ads and creatives without mapping", async () => {
    const bundle = await readMetaLiveCampaign({
      adAccountId: ACCOUNT,
      campaignId: CAMPAIGN_ID,
      token: "token",
      request: mockRequest({ get: async (path) => liveGet(path), post: async () => livePost() }),
      sleep: noSleep,
    });
    assert.equal(bundle.campaign.name, CAMPAIGN.name);
    assert.equal(bundle.adSets.length, 1);
    assert.deepEqual(bundle.adSets[0]?.targeting, ADSET.targeting);
    assert.equal(bundle.ads.length, 1);
    assert.equal(bundle.creatives["cr-1"]?.video_id, "v-1");
  });

  it("throws when ad sets are empty", async () => {
    await assert.rejects(
      () =>
        readMetaLiveCampaign({
          adAccountId: ACCOUNT,
          campaignId: CAMPAIGN_ID,
          token: "token",
          request: mockRequest({
            get: async (path) => {
              if (path.endsWith("/adsets")) return { data: [] };
              return liveGet(path);
            },
          }),
          sleep: noSleep,
        }),
      /returned no ad sets/,
    );
  });

  it("throws when ads are empty", async () => {
    await assert.rejects(
      () =>
        readMetaLiveCampaign({
          adAccountId: ACCOUNT,
          campaignId: CAMPAIGN_ID,
          token: "token",
          request: mockRequest({
            get: async (path) => {
              if (path.endsWith("/ads")) return { data: [] };
              return liveGet(path);
            },
          }),
          sleep: noSleep,
        }),
      /returned no ads/,
    );
  });

  it("throws when the campaign is on a different account", async () => {
    await assert.rejects(
      () =>
        readMetaLiveCampaign({
          adAccountId: "act_999",
          campaignId: CAMPAIGN_ID,
          token: "token",
          request: mockRequest({ get: async (path) => liveGet(path) }),
          sleep: noSleep,
        }),
      /not 999/,
    );
  });

  it("records only allowlisted paths", async () => {
    const { request, calls } = recordingMetaGraph(
      mockRequest({ get: async (path) => liveGet(path), post: async () => livePost() }),
    );
    await readMetaLiveCampaign({
      adAccountId: ACCOUNT,
      campaignId: CAMPAIGN_ID,
      token: "token",
      request,
      sleep: noSleep,
    });
    const allowed = new Set<string>(META_IMPORT_PATHS);
    for (const call of calls) {
      const classified = classifyMetaImportPath(call.path);
      assert.ok(classified && allowed.has(classified), call.path);
    }
    assert.ok(calls.some((call) => call.method === "POST" && call.path === "/"));
  });
});

describe("raw capture route", () => {
  const source = [
    readFileSync(join(HERE, "../../../../app/api/meta/campaigns/import/raw/route.ts"), "utf8"),
    readFileSync(join(HERE, "../raw.ts"), "utf8"),
  ].join("\n");

  it("is a GET and writes no draft", () => {
    assert.match(source, /export async function GET\(/);
    assert.equal(source.includes("export async function POST"), false);
  });

  it("writes no draft and maps nothing", () => {
    for (const forbidden of [
      "createMetaCampaign",
      "createMetaAdSet",
      "createMetaAd",
      "upsertDraft",
      "mapMetaLiveCampaign",
      "fetchAdSetsForCampaign",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });

  it("returns what was captured before a throw", () => {
    assert.match(source, /readError/);
    assert.match(source, /calls,/);
  });
});

describe("import path allowlist", () => {
  it("mentions only the named Meta paths under lib/meta/import", () => {
    const files = collectTsFiles(IMPORT_ROOT).filter(
      (file) => !file.includes("/__tests__/") && !file.includes("/__fixtures__/"),
    );
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.equal(
        source.includes("fetchAdSetsForCampaign"),
        false,
        `${file} must not use the picker ad-set read`,
      );
      for (const match of source.matchAll(/"(\/[^"]+)"/g)) {
        const path = match[1]!;
        if (!path.startsWith("/")) continue;
        if (path.includes("campaign_id") || path === "/") {
          assert.ok(
            (META_IMPORT_PATHS as readonly string[]).includes(path),
            `${file} has ${path}`,
          );
        }
      }
    }
  });

  it("reuses CREATIVE_BATCH_FIELDS rather than a second list", () => {
    const readers = readFileSync(join(IMPORT_ROOT, "readers.ts"), "utf8");
    assert.match(readers, /CREATIVE_BATCH_FIELDS/);
    assert.match(readers, /creative-batch-fields/);
    assert.equal(readers.includes("thumbnail_url"), false);
    assert.ok(CREATIVE_BATCH_FIELDS.includes("object_story_spec"));
    assert.ok(CREATIVE_BATCH_FIELDS.includes("asset_feed_spec"));
  });

  it("does not import write helpers", () => {
    const files = collectTsFiles(IMPORT_ROOT).filter(
      (file) => !file.includes("/__tests__/"),
    );
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const helper of ["createMetaCampaign", "createMetaAdSet", "createMetaAd", "createMetaCreative"]) {
        assert.equal(source.includes(helper), false, `${file} ${helper}`);
      }
    }
  });
});

describe("fixture provenance", () => {
  const capturedDir = join(IMPORT_ROOT, "__fixtures__/captured");

  it("keeps the live capture under __fixtures__/captured with a dated _note", () => {
    const captured = readdirSync(capturedDir);
    assert.ok(captured.includes("meta-import-capture-52522388611107.json"));
    for (const file of captured) {
      if (!file.endsWith(".json")) continue;
      const parsed = JSON.parse(readFileSync(join(capturedDir, file), "utf8")) as {
        _note?: string;
        ok?: boolean;
      };
      assert.match(
        parsed._note ?? "",
        /CAPTURED \d{4}-\d{2}-\d{2}/,
        `${file} needs a _note with the capture date`,
      );
      assert.match(parsed._note ?? "", /thumbnail_url/);
      assert.equal(parsed.ok, true);
    }
  });

  it("the live capture's cities have key, and flexible_spec is an array with interest ids", () => {
    const cap = JSON.parse(
      readFileSync(
        join(capturedDir, "meta-import-capture-52522388611107.json"),
        "utf8",
      ),
    ) as {
      calls: Array<{
        path: string;
        data?: { data?: Array<{ targeting?: Record<string, unknown> }> };
      }>;
    };
    const adSets = cap.calls
      .filter((call) => call.path.endsWith("/adsets"))
      .flatMap((call) => call.data?.data ?? []);
    assert.ok(adSets.length > 1);

    let citiesWithKey = 0;
    let citiesWithoutKey = 0;
    let flexibleWithIds = 0;
    for (const row of adSets) {
      const geo = row.targeting?.geo_locations as
        | { cities?: Array<{ key?: unknown; name?: unknown }> }
        | undefined;
      for (const city of geo?.cities ?? []) {
        if (typeof city.key === "string" && city.key.length > 0) citiesWithKey += 1;
        else citiesWithoutKey += 1;
      }
      const flex = row.targeting?.flexible_spec;
      if (Array.isArray(flex) && JSON.stringify(flex).includes('"id"')) {
        flexibleWithIds += 1;
      }
    }
    assert.ok(citiesWithKey > 0, "expected at least one city with key");
    assert.equal(citiesWithoutKey, 0);
    assert.ok(flexibleWithIds > 0, "expected at least one flexible_spec with ids");
  });
});
