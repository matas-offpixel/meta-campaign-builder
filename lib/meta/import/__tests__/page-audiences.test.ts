import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { migrateDraft } from "../../../autosave.ts";
import type { GraphBatchSubResponse } from "../../graph-multi-get-parse.ts";
import { mapMetaLiveCampaign } from "../map.ts";
import { readMetaLiveCampaign } from "../readers.ts";
import {
  AUDIENCE_RULE_BATCH_SIZE,
  applyResolvedPageAudiences,
  pageDerivedBadge,
  pageDerivedFromName,
  readCustomAudienceRules,
  resolvePageAudience,
  type AudienceRuleRead,
} from "../page-audiences.ts";
import type { MetaImportRecordedCall, MetaImportRequest, MetaLiveCampaignBundle } from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURED = join(HERE, "../__fixtures__/captured");
const ACCOUNT = "act_968594768066330";
const CAMPAIGN_ID = "120249957259050453";

type AudienceCapture = {
  calls: { ids: string[]; data: GraphBatchSubResponse[] }[];
};

function loadAudienceCapture(): AudienceCapture {
  return JSON.parse(
    readFileSync(join(CAPTURED, `../meta-import-audiences-${CAMPAIGN_ID}.json`), "utf8"),
  ) as AudienceCapture;
}

function readsFromCapture(capture: AudienceCapture): AudienceRuleRead[] {
  const reads: AudienceRuleRead[] = [];
  for (const call of capture.calls) {
    for (const sub of call.data) {
      const body = JSON.parse(sub.body ?? "null") as { id?: string; name?: string; subtype?: string; rule?: unknown };
      if (!body?.id) continue;
      reads.push({
        id: body.id,
        name: body.name ?? null,
        subtype: body.subtype ?? null,
        rule: body.rule ?? null,
      });
    }
  }
  return reads;
}

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

describe("DHB audience rules", () => {
  const capture = loadAudienceCapture();
  const reads = readsFromCapture(capture);

  it("issues one call per 25 ids", async () => {
    let calls = 0;
    const result = await readCustomAudienceRules({
      ids: capture.calls.flatMap((call) => call.ids),
      postBatch: async (batch) => {
        const call = capture.calls[calls];
        calls += 1;
        assert.ok(batch.length <= AUDIENCE_RULE_BATCH_SIZE);
        assert.equal(batch.length, call?.ids.length);
        return { responses: call?.data ?? [], usageHeader: null };
      },
    });
    assert.equal(calls, 3);
    assert.equal(result.calls, 3);
    assert.equal(result.reads.length, 68);
    assert.equal(result.stopped, null);
  });

  it("stops before the next call when app usage is hot", async () => {
    let calls = 0;
    const result = await readCustomAudienceRules({
      ids: capture.calls.flatMap((call) => call.ids),
      postBatch: async () => {
        const call = capture.calls[calls];
        calls += 1;
        return {
          responses: call?.data ?? [],
          usageHeader: '{"call_count":90,"total_time":1,"total_cputime":1}',
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.stopped, "usage");
    assert.equal(result.reads.length, 25);
  });

  it("moves page-resolved audiences onto page groups and out of Custom", async () => {
    const bundle = await dhbBundle();
    const draft = applyResolvedPageAudiences(
      mapMetaLiveCampaign({
        bundle,
        adAccountId: ACCOUNT,
        carry: [],
        availability: allAvailable(bundle),
      }),
      reads,
    );

    const resolved = reads.map(resolvePageAudience).filter((row) => row != null);
    assert.equal(resolved.length, 31);

    const ahmed = resolved.find((row) => row.audienceId === "120249428134180453");
    assert.deepEqual(
      { pageId: ahmed?.pageId, type: ahmed?.engagementType },
      { pageId: "170368522824409", type: "fb_engagement_365d" },
    );
    const pageGroup = draft.audiences.pageGroups.find((group) => group.pageIds.includes("170368522824409"));
    assert.ok(pageGroup);
    assert.equal(pageGroup.name, "Ahmed Spins");
    assert.ok(pageGroup.engagementTypes.includes("fb_engagement_365d"));
    assert.ok(pageGroup.engagementAudienceIds?.includes("120249428134180453"));

    const customIds = new Set(
      draft.audiences.customAudienceGroups.flatMap((group) => group.audienceIds),
    );
    assert.equal(customIds.has("120249428134180453"), false);
    assert.equal(customIds.has("120214018938930453"), true);

    const ig = draft.audiences.customAudienceGroups
      .flatMap((group) => group.audienceIds.map((id) => ({ id, name: group.audienceNames?.[id] })))
      .find((row) => row.id === "120249428134740453");
    assert.equal(pageDerivedBadge(ig?.name), "page-derived · Ahmed Spins");
    assert.equal(resolvePageAudience(reads.find((row) => row.id === "120249428134740453")!), null);

    const derived = new Set(draft.audiences.pageGroups.flatMap((group) => group.engagementAudienceIds ?? []));
    for (const id of derived) assert.equal(customIds.has(id), false);
    assert.equal(derived.size, 31);
  });
});
