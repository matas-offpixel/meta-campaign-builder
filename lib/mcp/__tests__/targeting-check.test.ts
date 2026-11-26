/**
 * Matas's 26 Nov plan, item 2, on M3b's stage adds: location expansion off
 * on every ad set (targeting_automation.individual_setting.geo), retargeting
 * ad sets strict (advantage_audience 0), Wider keeps Advantage+. The stage
 * adds never make an ad set or change its targeting: they read back what
 * they reached and report each mismatch, one line per ad set.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { advantageOn, checkTargeting, isRetargeting, locationExpansion } from "../live/targeting-check.ts";
import { LIVE_FOR_DESIGN } from "../live/words.ts";
import { addAudienceToStageTool, addCreativesToStageTool } from "../tools/live-stage.ts";
import { AS_B1, AS_BROAD, AS_FANS, AUD, CODE, YES, liveCtx } from "./live-fixtures.ts";

const T = (auto: Record<string, unknown> | null) => ({ geo_locations: { cities: [{ key: "1" }] }, ...(auto ? { targeting_automation: auto } : {}) });

test("the field: individual_setting.geo 1 on, 0 off, absent not set; advantage_audience 1 is suggestions", () => {
  assert.equal(locationExpansion(T({ advantage_audience: 1, individual_setting: { age: 1, gender: 1, geo: 1 } })), 1);
  assert.equal(locationExpansion(T({ advantage_audience: 0, individual_setting: { geo: 0 } })), 0);
  assert.equal(locationExpansion(T({ advantage_audience: 1, individual_setting: { age: 1, gender: 1 } })), null);
  assert.equal(locationExpansion(T(null)), null);
  assert.equal(advantageOn(T({ advantage_audience: 1 })), true);
  assert.equal(advantageOn(T({ advantage_audience: 0 })), false);
  assert.equal(isRetargeting("Bottom", "NX27-GLITTERBOX · Retargeting"), true);
  assert.equal(isRetargeting("Retargeting · 30 days", "[NX26-DOD] ON SALE"), true);
  assert.equal(isRetargeting("Wider", "[NX27-GLITTERBOX] ON SALE"), false);
});

test("the read-back: location expansion on and a retargeting ad set on suggestions each get a line; Wider on suggestions doesn't; no geo key is counted, not told", () => {
  const out = checkTargeting(
    [
      { id: "1", name: "Wider", targeting: T({ advantage_audience: 1, individual_setting: { geo: 0 } }) },
      { id: "2", name: "Broad", targeting: T({ advantage_audience: 0, individual_setting: { geo: 1 } }) },
      { id: "3", name: "Retargeting · Bottom", targeting: T({ advantage_audience: 1, individual_setting: { geo: 1 } }) },
      { id: "4", name: "Fans", targeting: T({ advantage_audience: 0 }) },
    ],
    () => "[X] ON SALE",
  );
  assert.deepEqual([out.read, out.locationOn, out.locationUnset, out.retargetingSuggestions], [4, ["2", "3"], ["4"], ["3"]]);
  assert.deepEqual(out.lines, [
    "Untick 'Reach more people likely to respond to your ads' in Ads Manager for Broad.",
    "Untick 'Reach more people likely to respond to your ads' in Ads Manager for Retargeting · Bottom.",
    "Turn off 'Use as a suggestion' in Ads Manager for Retargeting · Bottom: a retargeting ad set keeps to its own audience.",
  ]);
  // Both lines are PENDING DESIGN.
  for (const key of ["claude.mcp.live.check.location_on", "claude.mcp.live.check.retargeting_suggestions"]) assert.ok(LIVE_FOR_DESIGN.some((w) => w.key === key), key);
});

test("add_creatives_to_stage: reads back the ad sets it reached and reports each mismatch; sends no targeting", async () => {
  const { ctx, spy } = liveCtx({ ceiling: null });
  spy.objects.get(AS_BROAD)!.targeting = T({ advantage_audience: 0, individual_setting: { geo: 1 } });
  Object.assign(spy.objects.get(AS_FANS)!, { name: "Retargeting · Mid", targeting: T({ advantage_audience: 1, individual_setting: { geo: 0 } }) });
  const out = await addCreativesToStageTool.run(ctx, { event: CODE, stage: "on_sale", draft_creative_ids: ["cr-1"], ad_set_ids: [AS_BROAD, AS_FANS], approval: YES });
  assert.deepEqual((out.data as { checks: string[] }).checks, [
    "Untick 'Reach more people likely to respond to your ads' in Ads Manager for Broad.",
    "Turn off 'Use as a suggestion' in Ads Manager for Retargeting · Mid: a retargeting ad set keeps to its own audience.",
  ]);
  assert.deepEqual(out.summary.targetingCheck, { read: 2, locationOn: [AS_BROAD], locationUnset: 0, retargetingSuggestions: [AS_FANS] });
  const body = spy.calls.find((c) => c.method === "bulkAttach")!.input.body as Record<string, unknown>;
  assert.ok(!JSON.stringify(body).includes("targeting_automation"), "a stage add never sends targeting");
  assert.ok(!spy.calls.some((c) => c.method === "setStatus" || c.method === "setBudget"), "no other write");
});

test("add_creatives_to_stage: everything keeps the rules, no lines; a read that fails leaves the add as done and tells nothing", async () => {
  {
    const { ctx, spy } = liveCtx({ ceiling: null });
    spy.objects.get(AS_BROAD)!.targeting = T({ advantage_audience: 0, individual_setting: { geo: 0 } });
    const out = await addCreativesToStageTool.run(ctx, { event: CODE, stage: "on_sale", draft_creative_ids: ["cr-1"], ad_set_ids: [AS_BROAD], approval: YES });
    assert.equal((out.data as { checks?: string[] }).checks, undefined);
    assert.deepEqual(out.summary.targetingCheck, { read: 1, locationOn: [], locationUnset: 0, retargetingSuggestions: [] });
  }
  {
    const { ctx } = liveCtx({ ceiling: null });
    const live = ctx.live!;
    let attached = false;
    const flaky = { ...live, bulkAttach: async (i: Parameters<typeof live.bulkAttach>[0]) => ((attached = true), live.bulkAttach(i)), readObjects: async (...a: Parameters<typeof live.readObjects>) => { if (attached) throw new Error("rate limited"); return live.readObjects(...a); } };
    const out = await addCreativesToStageTool.run({ ...ctx, live: flaky }, { event: CODE, stage: "on_sale", draft_creative_ids: ["cr-1"], ad_set_ids: [AS_BROAD], approval: YES });
    assert.match((out.data as { message: string }).message, /^Done: 1 ad added/);
    assert.deepEqual(out.summary.targetingCheck, { read: 0, locationOn: [], locationUnset: 0, retargetingSuggestions: [], unread: true });
  }
});

test("add_audience_to_stage: the same read-back on the ad sets written; the targeting write keeps Advantage+ as it was", async () => {
  const { ctx, spy } = liveCtx({ ceiling: null });
  Object.assign(spy.objects.get(AS_B1)!, { name: "Retargeting · 30 days", targeting: T({ advantage_audience: 1, individual_setting: { geo: 1 } }) });
  const out = await addAudienceToStageTool.run(ctx, { event: CODE, stage: "on_sale", audience_ids: [AUD], approval: YES });
  assert.deepEqual((out.data as { checks: string[] }).checks, [
    "Untick 'Reach more people likely to respond to your ads' in Ads Manager for Retargeting · 30 days.",
    "Turn off 'Use as a suggestion' in Ads Manager for Retargeting · 30 days: a retargeting ad set keeps to its own audience.",
  ]);
  const t = out.summary.targetingCheck as { read: number; locationUnset: number };
  assert.equal(t.read, 3);
  assert.equal(t.locationUnset, 2, "Broad and Fans carry no geo key");
  for (const c of spy.calls.filter((x) => x.method === "adsetAudience")) assert.ok(!JSON.stringify(c.input.body).includes("targeting_automation"), "audiences only");
});
