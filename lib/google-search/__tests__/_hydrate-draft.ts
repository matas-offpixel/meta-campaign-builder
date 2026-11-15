/**
 * Test helpers: the Ironworks build-sheet fixtures, and a parsed draft tree with ids the way
 * `createGoogleSearchPlanTreeFromDraft` does, without a database.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { parseGoogleSearchPlanXlsx } from "../xlsx-import.ts";
import type {
  GoogleSearchNegative,
  GoogleSearchPlanDraftTree,
  GoogleSearchPlanTree,
  GoogleSearchStructureMode,
} from "../types.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);

export const JAMIE_JONES = "IRW0001_JamieJones_GoogleSearch_BuildSheet.xlsx";
export const CAMELPHAT = "IRW0004_CamelPhat_GoogleSearch_BuildSheet.xlsx";
export const APPETITE = "IRW0005_AppetiteHalloween_GoogleSearch_BuildSheet.xlsx";

export function parseFixture(file: string, structureMode: GoogleSearchStructureMode) {
  return parseGoogleSearchPlanXlsx(new Uint8Array(readFileSync(new URL(file, FIXTURES))), { structureMode });
}

/** Give a parsed draft ids the way createGoogleSearchPlanTreeFromDraft does. */
export function hydrate(draft: GoogleSearchPlanDraftTree): GoogleSearchPlanTree {
  const now = "2026-10-08T00:00:00Z";
  const campaignIds = new Map<string, string>();
  const adGroupIds = new Map<string, string>();
  const campaigns = draft.campaigns.map((c, ci) => {
    const id = `c-${ci}`;
    campaignIds.set(c.name, id);
    return {
      ...c,
      id,
      plan_id: "plan-1",
      pushed_resource_name: null,
      created_at: now,
      negatives: [] as GoogleSearchNegative[],
      ad_groups: c.ad_groups.map((ag, ai) => {
        const agId = `${id}-ag-${ai}`;
        adGroupIds.set(`${c.name}::${ag.name}`, agId);
        return {
          ...ag,
          id: agId,
          campaign_id: id,
          pushed_resource_name: null,
          created_at: now,
          keywords: ag.keywords.map((k, ki) => ({
            ...k,
            id: `${agId}-kw-${ki}`,
            ad_group_id: agId,
            pushed_resource_name: null,
            created_at: now,
          })),
          rsas: ag.rsas.map((r, ri) => ({
            ...r,
            id: `${agId}-rsa-${ri}`,
            ad_group_id: agId,
            pushed_resource_name: null,
            created_at: now,
          })),
        };
      }),
    };
  });
  const planNegatives: GoogleSearchNegative[] = [];
  draft.negatives.forEach((n, i) => {
    const { scope, ...rest } = n;
    const base = { ...rest, id: `neg-${i}`, plan_id: "plan-1", pushed_resource_name: null, created_at: now };
    if (scope.kind === "plan") {
      planNegatives.push({ ...base, campaign_id: null, ad_group_id: null });
      return;
    }
    const campaignId = campaignIds.get(scope.campaign_name);
    assert.ok(campaignId, `negative scoped to unknown campaign ${scope.campaign_name}`);
    const adGroupId =
      scope.kind === "ad_group" ? adGroupIds.get(`${scope.campaign_name}::${scope.ad_group_name}`) : null;
    if (scope.kind === "ad_group") assert.ok(adGroupId, `unknown ad group ${scope.ad_group_name}`);
    campaigns
      .find((c) => c.id === campaignId)!
      .negatives.push({ ...base, campaign_id: campaignId, ad_group_id: adGroupId ?? null });
  });
  return {
    plan: {
      ...draft.plan,
      id: "plan-1",
      user_id: "user-1",
      event_id: null,
      google_ads_account_id: "acct-1",
      status: "draft",
      pushed_at: null,
      created_at: now,
      updated_at: now,
    },
    campaigns,
    plan_negatives: planNegatives,
    sitelinks: [],
  };
}
