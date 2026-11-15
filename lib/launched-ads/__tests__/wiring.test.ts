import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

const LAUNCH = source("app/api/meta/launch-campaign/route.ts");
const BULK = source("app/api/meta/bulk-attach-ads/route.ts");
const CREATE = source("app/api/meta/create-creatives-and-ads/route.ts");
const SQL = source("supabase/migrations/184_launched_ads.sql");

function balanced(sql: string): boolean {
  const body = sql.replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");
  let depth = 0;
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0 && (body.match(/\$\$/g) ?? []).length % 2 === 0;
}

describe("migration 184 launched_ads", () => {
  it("parses as the expected table, checks, indexes and own-row RLS", () => {
    assert.ok(balanced(SQL));
    assert.match(SQL, /create table if not exists launched_ads/);
    assert.match(SQL, /meta_ad_id\s+text not null unique/);
    assert.match(SQL, /draft_id\s+uuid references campaign_drafts\(id\) on delete set null/);
    assert.match(SQL, /client_id\s+uuid references clients\(id\)/);
    assert.match(SQL, /event_id\s+uuid references events\(id\)/);
    assert.doesNotMatch(SQL, /meta_adset_id\s+text\s+references/);
    assert.match(SQL, /check \(channel in \('meta'\)\)/);
    assert.match(SQL, /check \(descriptor_source in \('launch', 'backfill_from_launch_summary'\)\)/);
    assert.match(SQL, /asset_content_hashes\s+jsonb not null default '\[\]'::jsonb/);
    for (const idx of [/\(draft_id\)/, /\(event_id\)/, /\(client_id, launched_at desc\)/, /\(meta_adset_id\)/]) {
      assert.match(SQL, idx);
    }
    assert.match(SQL, /enable row level security/);
    assert.match(SQL, /using \(user_id = auth\.uid\(\)\)/);
    assert.match(SQL, /notify pgrst, 'reload schema';\s*$/);
  });
});

describe("launched_ads wiring", () => {
  it("launch-campaign records after each Meta ad create, standard and multi-campaign", () => {
    assert.match(LAUNCH, /bindLaunchAdRecorder\(/);
    assert.match(LAUNCH, /\.catch\(\(err\) => \{\s*console\.error\("\[launched_ads\] bind failed"/);
    assert.equal((LAUNCH.match(/await recordCreatedAd\(\{/g) ?? []).length, 2);
    const phase4 = LAUNCH.indexOf("creativeEntry.ads.push({ adSetName, metaAdId: adRes.id");
    assert.ok(phase4 > 0 && LAUNCH.indexOf("await recordCreatedAd({", phase4) > phase4);
    assert.match(LAUNCH, /metaCampaignId: attachCampaignIdByMetaAdSetId\.get\(metaAdSetId\) \?\? metaCampaignId/);
    assert.match(LAUNCH, /metaCampaignId: nextCampaign\.id,\s*\}\);/);
    assert.match(LAUNCH, /attachCampaignIdByMetaAdSetId\.set\(r\.metaAdSetId, r\.campaignId\)/);
    assert.match(LAUNCH, /attachCampaignIdByMetaAdSetId\.set\(liveAdSet\.id, liveAdSet\.campaign_id\)/);
  });

  it("bulk-attach and create-creatives-and-ads record after createMetaAd, filling from launched_ad_sets", () => {
    for (const route of [BULK, CREATE]) {
      assert.match(route, /bindLaunchAdRecorder\(\{[\s\S]*?fillFromLaunchedAdSets: true/);
      assert.match(route, /\.catch\(\(\) => noopRecordCreatedAd\)/);
      const create = route.indexOf("await createMetaAd(");
      assert.ok(create > 0 && route.indexOf("await recordCreatedAd({", create) > create);
    }
    assert.match(BULK, /metaCampaignId: campaignId,/);
  });
});
