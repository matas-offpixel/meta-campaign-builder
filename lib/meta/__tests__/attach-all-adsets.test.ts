/**
 * Unit tests for buildAttachAllAdSetsMap — the multi-campaign ad-set pooling
 * helper behind `attach_all_adsets` (task #114). Verifies ad sets are pooled
 * across every selected campaign (not just the first), the shared cap is
 * respected, blocked-status ad sets are excluded, and one campaign's fetch
 * failure doesn't abort pooling for the rest.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAttachAllAdSetsMap,
  type AttachAllAdSetsCampaignRef,
  type AttachAllAdSetsFetchResult,
} from "../attach-all-adsets.ts";
import { attachedAdSetKey } from "../../types.ts";

function campaign(id: string, name: string): AttachAllAdSetsCampaignRef {
  return { id, name };
}

/** Builds a fetcher that returns `count` live ad sets per campaign, IDs
 * namespaced by campaign so cross-campaign collisions are impossible. */
function fixedCountFetcher(count: number) {
  return async (campaignId: string): Promise<AttachAllAdSetsFetchResult> => ({
    data: Array.from({ length: count }, (_, i) => ({
      id: `${campaignId}_as${i}`,
      name: `${campaignId} ad set ${i}`,
      effective_status: "ACTIVE",
    })),
  });
}

describe("buildAttachAllAdSetsMap", () => {
  it("pools ad sets across 3 campaigns × 5 ad sets each into one map of 15", async () => {
    const campaigns = [
      campaign("cmp_traffic", "Traffic Campaign"),
      campaign("cmp_sales", "Sales Campaign"),
      campaign("cmp_awareness", "Awareness Campaign"),
    ];
    const result = await buildAttachAllAdSetsMap(campaigns, fixedCountFetcher(5), 25);

    assert.equal(result.adSetMetaIds.size, 15);
    assert.equal(result.registered.length, 15);
    assert.equal(result.fetchErrors.length, 0);
    // Every campaign contributed exactly 5, and each keeps its own campaign id/name.
    for (const c of campaigns) {
      const own = result.registered.filter((r) => r.campaignId === c.id);
      assert.equal(own.length, 5, `${c.id} should contribute 5 ad sets`);
      assert.ok(own.every((r) => r.campaignName === c.name));
    }
  });

  it("registers under the synthetic attachedAdSetKey format Phase 4 expects", async () => {
    const result = await buildAttachAllAdSetsMap(
      [campaign("cmp_a", "Campaign A")],
      fixedCountFetcher(2),
      25,
    );
    assert.equal(result.adSetMetaIds.get(attachedAdSetKey("cmp_a_as0")), "cmp_a_as0");
    assert.equal(result.adSetMetaIds.get(attachedAdSetKey("cmp_a_as1")), "cmp_a_as1");
  });

  it("stops pooling once the shared cap is reached, across campaigns", async () => {
    const campaigns = [
      campaign("cmp_a", "Campaign A"),
      campaign("cmp_b", "Campaign B"),
      campaign("cmp_c", "Campaign C"),
    ];
    const result = await buildAttachAllAdSetsMap(campaigns, fixedCountFetcher(5), 8);
    assert.equal(result.adSetMetaIds.size, 8);
    // First campaign fully consumed (5), second contributes the remaining 3, third contributes 0.
    assert.equal(result.registered.filter((r) => r.campaignId === "cmp_a").length, 5);
    assert.equal(result.registered.filter((r) => r.campaignId === "cmp_b").length, 3);
    assert.equal(result.registered.filter((r) => r.campaignId === "cmp_c").length, 0);
  });

  it("excludes ARCHIVED and DELETED ad sets", async () => {
    const fetcher = async (): Promise<AttachAllAdSetsFetchResult> => ({
      data: [
        { id: "as_active", name: "Active", effective_status: "ACTIVE" },
        { id: "as_paused", name: "Paused", effective_status: "PAUSED" },
        { id: "as_archived", name: "Archived", effective_status: "ARCHIVED" },
        { id: "as_deleted", name: "Deleted", effective_status: "DELETED" },
      ],
    });
    const result = await buildAttachAllAdSetsMap([campaign("cmp_a", "Campaign A")], fetcher, 25);
    assert.equal(result.adSetMetaIds.size, 2);
    assert.ok(result.adSetMetaIds.has(attachedAdSetKey("as_active")));
    assert.ok(result.adSetMetaIds.has(attachedAdSetKey("as_paused")));
    assert.ok(!result.adSetMetaIds.has(attachedAdSetKey("as_archived")));
    assert.ok(!result.adSetMetaIds.has(attachedAdSetKey("as_deleted")));
  });

  it("records a per-campaign fetch failure but keeps pooling the rest", async () => {
    const campaigns = [
      campaign("cmp_bad", "Broken Campaign"),
      campaign("cmp_good", "Healthy Campaign"),
    ];
    const fetcher = async (campaignId: string): Promise<AttachAllAdSetsFetchResult> => {
      if (campaignId === "cmp_bad") throw new Error("Meta API timeout");
      return { data: [{ id: "as_good", name: "Good ad set", effective_status: "ACTIVE" }] };
    };
    const result = await buildAttachAllAdSetsMap(campaigns, fetcher, 25);
    assert.equal(result.adSetMetaIds.size, 1);
    assert.equal(result.fetchErrors.length, 1);
    assert.equal(result.fetchErrors[0].campaignId, "cmp_bad");
    assert.match(result.fetchErrors[0].error, /Meta API timeout/);
  });

  it("returns an empty map for an empty campaign list", async () => {
    const result = await buildAttachAllAdSetsMap([], fixedCountFetcher(5), 25);
    assert.equal(result.adSetMetaIds.size, 0);
    assert.equal(result.registered.length, 0);
  });
});
