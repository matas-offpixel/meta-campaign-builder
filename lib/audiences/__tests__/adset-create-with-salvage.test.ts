import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  prepareAdSetPayloadForCreate,
  createAdSetWithSalvage,
  type CreateAdSetWithSalvageDeps,
} from "../adset-create-with-salvage.ts";
import { DELETED_CUSTOM_AUDIENCE_SUBCODE } from "../ca-availability-recovery.ts";
import type { AdSetSuggestion, PageAudienceGroup } from "../../types.ts";
import type { MetaAdSetPayload } from "../../meta/adset.ts";
import type { AudienceReadinessWaitResult } from "../../meta/client.ts";

/**
 * lib/audiences/__tests__/adset-create-with-salvage.test.ts
 *
 * task #125 — unit coverage for the shared ad-set-create salvage ladder
 * extracted from `launch-campaign/route.ts`'s standard Phase 2 so the
 * multi-campaign bulk-attach path can run the exact same logic. See the
 * module doc in `adset-create-with-salvage.ts` for the tier breakdown
 * (1359207 loop + "meta lies" recreate fallback, 1870196, 1870227,
 * fallthrough diagnostic).
 *
 * These fixtures deliberately use non-numeric custom-audience ids (`ca_*`)
 * so `parseOffendingCustomAudienceIds`'s "(ID: 123)" pattern never matches —
 * every drop decision below is driven through the availability-check path
 * (`fetchCustomAudienceAvailability`), which is the common case in
 * production (Meta's 1359207 wording rarely names ids verbatim — see
 * `ca-availability-recovery.ts`'s own doc comment).
 */

function adSet(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "as_1",
    name: "Similar Pages",
    sourceType: "page_group",
    sourceId: "pg_1",
    sourceName: "Similar Pages",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 20,
    advantagePlus: true,
    enabled: true,
    ...overrides,
  } as AdSetSuggestion;
}

function payload(customAudienceIds: string[], overrides: Partial<MetaAdSetPayload> = {}): MetaAdSetPayload {
  return {
    name: "Similar Pages",
    campaign_id: "camp_1",
    daily_budget: 2000,
    billing_event: "IMPRESSIONS",
    optimization_goal: "REACH",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: {
      custom_audiences: customAudienceIds.map((id) => ({ id })),
      geo_locations: { countries: ["GB"] },
    },
    ...overrides,
  } as MetaAdSetPayload;
}

function deletedCaError(message = "This ad set is using one or more custom audiences, which are no longer available.") {
  const err = new Error(message) as Error & { code: number; subcode: number };
  err.code = 100;
  err.subcode = DELETED_CUSTOM_AUDIENCE_SUBCODE;
  return err;
}

function invalidTargetingAutomationError() {
  const err = new Error("targeting automation type passed is invalid") as Error & {
    code: number;
    subcode: number;
  };
  err.code = 100;
  err.subcode = 1870196;
  return err;
}

function missingAdvantageAudienceFlagError() {
  const err = new Error("advantage_audience must be set") as Error & { code: number; subcode: number };
  err.code = 100;
  err.subcode = 1870227;
  return err;
}

function baseDeps(overrides: Partial<CreateAdSetWithSalvageDeps> = {}): CreateAdSetWithSalvageDeps {
  return {
    createMetaAdSet: async () => {
      throw new Error("createMetaAdSet not stubbed for this test");
    },
    fetchCustomAudienceAvailability: async (ids) => ids.map((id) => ({ id, available: true })),
    recreateEngagementAudiencesForGroup: async () => ({ ids: [], created: [], failed: [] }),
    formatError: (err) => (err instanceof Error ? err.message : String(err)),
    ...overrides,
  };
}

// ─── prepareAdSetPayloadForCreate ───────────────────────────────────────────

describe("prepareAdSetPayloadForCreate", () => {
  it("throws a clear operator error when daily_budget is 0 or missing (Meta subcode 1885272)", async () => {
    const deps = baseDeps();
    await assert.rejects(
      prepareAdSetPayloadForCreate(
        {
          adSet: adSet({ sourceType: "blank", sourceId: "" }),
          payload: payload([], { daily_budget: 0 }),
          freshlyCreatedEngagementAudienceIds: new Set(),
          audienceNameById: new Map(),
          getOrWaitAudienceReady: async (id) => ({ id, ready: true, timedOut: false, finalCode: null, finalDescription: null }),
          logPrefix: "Phase 2",
        },
        deps,
      ),
      /has no daily budget/,
    );
  });

  it("names a lifetime budget when lifetime_budget is present but not positive", async () => {
    const deps = baseDeps();
    await assert.rejects(
      prepareAdSetPayloadForCreate(
        {
          adSet: adSet({ sourceType: "blank", sourceId: "" }),
          payload: payload([], { daily_budget: undefined, lifetime_budget: 0 }),
          freshlyCreatedEngagementAudienceIds: new Set(),
          audienceNameById: new Map(),
          getOrWaitAudienceReady: async (id) => ({ id, ready: true, timedOut: false, finalCode: null, finalDescription: null }),
          logPrefix: "Phase 2",
        },
        deps,
      ),
      /has no lifetime budget/,
    );
  });

  it("waits on freshly-created audiences before returning the payload", async () => {
    const waited: string[] = [];
    const result = await prepareAdSetPayloadForCreate(
      {
        adSet: adSet(),
        payload: payload(["ca_fresh"]),
        freshlyCreatedEngagementAudienceIds: new Set(["ca_fresh"]),
        audienceNameById: new Map([["ca_fresh", "Similar Pages — Page Engaged"]]),
        getOrWaitAudienceReady: async (id) => {
          waited.push(id);
          return { id, ready: true, timedOut: false, finalCode: null, finalDescription: null };
        },
        logPrefix: "Phase 2",
      },
      baseDeps(),
    );
    assert.deepEqual(waited, ["ca_fresh"]);
    assert.equal(result.freshReadinessResults.get("ca_fresh")?.ready, true);
    assert.deepEqual(result.payload.targeting.custom_audiences, [{ id: "ca_fresh" }]);
  });

  it("runs a preflight availability check and drops unavailable REUSED audiences above the threshold (task #123)", async () => {
    const reusedIds = Array.from({ length: 21 }, (_, i) => `ca_reused_${i}`);
    const deps = baseDeps({
      fetchCustomAudienceAvailability: async (ids) =>
        ids.map((id) => ({ id, available: id !== "ca_reused_5" })),
    });
    const result = await prepareAdSetPayloadForCreate(
      {
        adSet: adSet(),
        payload: payload(reusedIds),
        freshlyCreatedEngagementAudienceIds: new Set(),
        audienceNameById: new Map(),
        getOrWaitAudienceReady: async (id) => ({ id, ready: true, timedOut: false, finalCode: null, finalDescription: null }),
        logPrefix: "Phase 2",
      },
      deps,
    );
    const keptIds = (result.payload.targeting.custom_audiences ?? []).map((a) => a.id);
    assert.equal(keptIds.includes("ca_reused_5"), false);
    assert.equal(keptIds.length, 20);
    assert.equal(result.preflightDroppedCount, 1);
    assert.ok(result.preflightDroppedNote);
  });

  it("trusts same-launch receipts without an availability lookup — DJ EZ class", async () => {
    const receiptIds = Array.from({ length: 32 }, (_, i) => `12025156297${String(1780755 + i)}`);
    let fetchCalled = false;
    const deps = baseDeps({
      fetchCustomAudienceAvailability: async (ids) => {
        fetchCalled = true;
        return ids.map((id) => ({ id, available: false }));
      },
    });
    const result = await prepareAdSetPayloadForCreate(
      {
        adSet: adSet({ name: "Garage Audience" }),
        payload: payload(receiptIds),
        freshlyCreatedEngagementAudienceIds: new Set(),
        receiptAudienceIds: new Set(receiptIds),
        audienceNameById: new Map(),
        getOrWaitAudienceReady: async (id) => ({
          id,
          ready: false,
          timedOut: true,
          finalCode: 441,
          finalDescription: "You can start running ads with this audience straight away.",
        }),
        logPrefix: "Phase 2",
      },
      deps,
    );
    assert.equal(fetchCalled, false);
    assert.deepEqual(
      (result.payload.targeting.custom_audiences ?? []).map((a) => a.id),
      receiptIds,
    );
    assert.equal(result.preflightDroppedCount, 0);
  });

  it("does NOT run the preflight check below the reused-audience threshold", async () => {
    let called = false;
    const deps = baseDeps({
      fetchCustomAudienceAvailability: async (ids) => {
        called = true;
        return ids.map((id) => ({ id, available: true }));
      },
    });
    await prepareAdSetPayloadForCreate(
      {
        adSet: adSet(),
        payload: payload(["ca_1", "ca_2"]),
        freshlyCreatedEngagementAudienceIds: new Set(),
        audienceNameById: new Map(),
        getOrWaitAudienceReady: async (id) => ({ id, ready: true, timedOut: false, finalCode: null, finalDescription: null }),
        logPrefix: "Phase 2",
      },
      deps,
    );
    assert.equal(called, false);
  });
});

// ─── createAdSetWithSalvage — Tier 1: 1359207 loop ──────────────────────────

describe("createAdSetWithSalvage — subcode 1359207 (deleted custom audience)", () => {
  it("salvages a single-pass refusal by dropping the unavailable audience and retrying", async () => {
    let createCalls = 0;
    const deps = baseDeps({
      fetchCustomAudienceAvailability: async (ids) =>
        ids.map((id) => ({ id, available: id !== "ca_stale" })),
      createMetaAdSet: async (_acc, p) => {
        createCalls++;
        const ids = (p.targeting.custom_audiences ?? []).map((a) => a.id);
        assert.equal(ids.includes("ca_stale"), false);
        return { id: "meta_as_1" };
      },
    });

    const res = await createAdSetWithSalvage(
      {
        adSet: adSet(),
        initialPayload: payload(["ca_stale", "ca_good"]),
        initialError: deletedCaError(),
        adAccountId: "act_1",
        logPrefix: "Phase 2",
        asStart: Date.now(),
        freshReadinessResults: new Map(),
        preflightDroppedCount: 0,
        audienceNameById: new Map(),
        pageGroups: [],
      },
      deps,
    );

    assert.equal(res.metaAdSetId, "meta_as_1");
    assert.equal(createCalls, 1);
    assert.match(res.note ?? "", /1 unavailable audience/);
    // Meta's own refusal is carried next to the note.
    assert.equal(res.metaError?.code, 100);
    assert.equal(res.metaError?.subcode, DELETED_CUSTOM_AUDIENCE_SUBCODE);
    assert.match(res.metaError?.message ?? "", /no longer available/);
  });

  it("loops multiple passes when Meta reveals a new batch of stale audiences on each retry (task #123/#757)", async () => {
    let fetchCalls = 0;
    let createCalls = 0;
    const deps = baseDeps({
      // pass 1 checks [ca_1, ca_2, ca_good] and finds ca_1 stale;
      // pass 2 checks the survivors [ca_2, ca_good] and finds ca_2 stale.
      fetchCustomAudienceAvailability: async (ids) => {
        fetchCalls++;
        const staleThisPass = fetchCalls === 1 ? "ca_1" : "ca_2";
        return ids.map((id) => ({ id, available: id !== staleThisPass }));
      },
      createMetaAdSet: async (_acc, p) => {
        createCalls++;
        const ids = (p.targeting.custom_audiences ?? []).map((a) => a.id);
        if (createCalls === 1) {
          assert.deepEqual(ids, ["ca_2", "ca_good"]);
          throw deletedCaError();
        }
        assert.deepEqual(ids, ["ca_good"]);
        return { id: "meta_as_final" };
      },
    });

    const res = await createAdSetWithSalvage(
      {
        adSet: adSet(),
        initialPayload: payload(["ca_1", "ca_2", "ca_good"]),
        initialError: deletedCaError(),
        adAccountId: "act_1",
        logPrefix: "Phase 2",
        asStart: Date.now(),
        freshReadinessResults: new Map(),
        preflightDroppedCount: 0,
        audienceNameById: new Map(),
        pageGroups: [],
      },
      deps,
    );

    assert.equal(res.metaAdSetId, "meta_as_final");
    assert.equal(fetchCalls, 2);
    assert.equal(createCalls, 2);
    assert.match(res.note ?? "", /2 unavailable audiences across 2 salvage passes/);
  });

  it("hits the 4-pass cap and throws an explanatory error when Meta keeps revealing more stale audiences", async () => {
    const deps = baseDeps({
      // Every pass's availability check marks only the FIRST of the
      // (shrinking) requested ids as stale — Meta never runs out.
      fetchCustomAudienceAvailability: async (ids) =>
        ids.map((id, i) => ({ id, available: i !== 0 })),
      createMetaAdSet: async () => {
        throw deletedCaError();
      },
    });

    await assert.rejects(
      createAdSetWithSalvage(
        {
          adSet: adSet(),
          initialPayload: payload(["ca_1", "ca_2", "ca_3", "ca_4", "ca_5"]),
          initialError: deletedCaError(),
          adAccountId: "act_1",
          logPrefix: "Phase 2",
          asStart: Date.now(),
          freshReadinessResults: new Map(),
          preflightDroppedCount: 0,
          audienceNameById: new Map(),
          pageGroups: [],
        },
        deps,
      ),
      /CA-salvage cap/,
    );
  });

  it("falls back to recreate-from-scratch when Meta's create-time validator disagrees with availability (task #124 'meta lies')", async () => {
    const group: PageAudienceGroup = {
      id: "pg_1",
      name: "Similar Pages",
      pageIds: ["page_1"],
      engagementTypes: ["fb_engagement_365d"],
      lookalike: false,
      lookalikeRanges: [],
      customAudienceIds: [],
      engagementAudienceIds: ["ca_old"],
    };

    let recreateCalled = false;
    let finalCreateIds: string[] = [];
    const deps = baseDeps({
      // Availability check reports everything fine — Meta's create-time
      // validator disagrees with its own read endpoint.
      createMetaAdSet: async (_acc, p) => {
        const ids = (p.targeting.custom_audiences ?? []).map((a) => a.id);
        if (ids.includes("ca_old")) throw deletedCaError();
        finalCreateIds = ids;
        return { id: "meta_as_recreated" };
      },
      recreateEngagementAudiencesForGroup: async (g) => {
        recreateCalled = true;
        assert.equal(g.id, "pg_1");
        return {
          ids: ["ca_fresh_1"],
          created: [
            { name: "Page Engaged", id: "ca_fresh_1", type: "fb_engagement_365d", pageId: "page_1", pageName: "Page 1" },
          ],
          failed: [],
        };
      },
    });

    const res = await createAdSetWithSalvage(
      {
        adSet: adSet({ sourceType: "page_group", sourceId: "pg_1" }),
        initialPayload: payload(["ca_old"]),
        initialError: deletedCaError(),
        adAccountId: "act_1",
        logPrefix: "Phase 2",
        asStart: Date.now(),
        freshReadinessResults: new Map(),
        // A prior preflight already dropped something — this is the signal
        // that lets the "meta lies" tier engage (see module doc).
        preflightDroppedCount: 1,
        audienceNameById: new Map(),
        pageGroups: [group],
      },
      deps,
    );

    assert.equal(recreateCalled, true);
    assert.equal(res.metaAdSetId, "meta_as_recreated");
    assert.deepEqual(finalCreateIds, ["ca_fresh_1"]);
    assert.match(res.note ?? "", /Recreated 1 engagement audience/);
    // Group bookkeeping updated in place so a later ad set in the same
    // launch referencing this group picks up the fresh id.
    assert.deepEqual(group.engagementAudienceIds, ["ca_fresh_1"]);
    assert.equal(group.engagementAudiencesByType?.fb_engagement_365d, "ca_fresh_1");
  });

  it("does NOT attempt the recreate fallback when nothing was ever dropped before (avoids false-positive 'meta lies')", async () => {
    const group: PageAudienceGroup = {
      id: "pg_1",
      name: "Similar Pages",
      pageIds: ["page_1"],
      engagementTypes: ["fb_engagement_365d"],
      lookalike: false,
      lookalikeRanges: [],
      customAudienceIds: [],
    };
    let recreateCalled = false;
    const deps = baseDeps({
      createMetaAdSet: async () => {
        throw deletedCaError();
      },
      recreateEngagementAudiencesForGroup: async () => {
        recreateCalled = true;
        return { ids: [], created: [], failed: [] };
      },
    });

    await assert.rejects(
      createAdSetWithSalvage(
        {
          adSet: adSet({ sourceType: "page_group", sourceId: "pg_1" }),
          initialPayload: payload(["ca_old"]),
          initialError: deletedCaError(),
          adAccountId: "act_1",
          logPrefix: "Phase 2",
          asStart: Date.now(),
          freshReadinessResults: new Map(),
          preflightDroppedCount: 0,
          audienceNameById: new Map(),
          pageGroups: [group],
        },
        deps,
      ),
    );
    assert.equal(recreateCalled, false);
  });
});

// ─── createAdSetWithSalvage — Tier 2: 1870196 ───────────────────────────────

describe("createAdSetWithSalvage — Advantage+ age order (steps 2 and 3)", () => {
  // ES27-ENZOSIRAGUSA arm B, 25 Nov 2026: the old 1870196 retry sent
  // advantage_audience 0 with strict ages, which turned "Broad +
  // suggestions"' 126 suggestion audiences into hard targeting.
  const SUGGESTION_IDS = ["ca_1", "ca_2"];
  /** Step 1's payload: Advantage+ with the 18–45 age suggestion and suggestion audiences. */
  const step1Payload = (): MetaAdSetPayload =>
    payload(SUGGESTION_IDS, {
      targeting: {
        custom_audiences: SUGGESTION_IDS.map((id) => ({ id })),
        geo_locations: { countries: ["GB"] },
        age_min: 18,
        age_max: 65,
        age_range: [18, 45],
        targeting_automation: { advantage_audience: 1, individual_setting: { age: 1 } },
      },
    } as Partial<MetaAdSetPayload>);
  /** Advantage+ at the full range — no age suggestion to drop. */
  const noSuggestionPayload = (): MetaAdSetPayload =>
    payload(SUGGESTION_IDS, {
      targeting: {
        custom_audiences: SUGGESTION_IDS.map((id) => ({ id })),
        geo_locations: { countries: ["GB"] },
        age_min: 18,
        age_max: 65,
        targeting_automation: { advantage_audience: 1 },
      },
    } as Partial<MetaAdSetPayload>);
  const params = (initialPayload: MetaAdSetPayload, initialError: unknown) => ({
    adSet: adSet({ sourceType: "custom_group", ageMin: 18, ageMax: 45, advantagePlus: true }),
    initialPayload,
    initialError,
    adAccountId: "act_1",
    logPrefix: "Phase 2",
    asStart: Date.now(),
    freshReadinessResults: new Map(),
    preflightDroppedCount: 0,
    audienceNameById: new Map(),
    pageGroups: [],
  });

  it("step 2: the age suggestion refused → one retry as Advantage+ with age_max 65, no suggestion, audiences kept", async () => {
    const sent: MetaAdSetPayload[] = [];
    const deps = baseDeps({
      createMetaAdSet: async (_acc, p) => {
        sent.push(p);
        return { id: "meta_as_step2" };
      },
    });
    const res = await createAdSetWithSalvage(params(step1Payload(), invalidTargetingAutomationError()), deps);

    assert.equal(res.metaAdSetId, "meta_as_step2");
    assert.equal(sent.length, 1);
    // Step 2's payload snapshot, as it goes on the wire.
    assert.deepEqual(JSON.parse(JSON.stringify(sent[0].targeting)), {
      custom_audiences: [{ id: "ca_1" }, { id: "ca_2" }],
      geo_locations: { countries: ["GB"] },
      age_min: 18,
      age_max: 65,
      targeting_automation: { advantage_audience: 1 },
    });
    assert.equal(res.ageSuggestionDropped, "meta_refused");
    assert.deepEqual(res.metaError, { code: 100, subcode: 1870196, message: "targeting automation type passed is invalid" });
  });

  it("step 3: Advantage+ refused again without the suggestion → fails with Meta's error, never strict", async () => {
    const sent: MetaAdSetPayload[] = [];
    const second = invalidTargetingAutomationError();
    second.message = "targeting automation type passed is invalid (second)";
    const deps = baseDeps({
      createMetaAdSet: async (_acc, p) => {
        sent.push(p);
        throw second;
      },
    });
    await assert.rejects(createAdSetWithSalvage(params(step1Payload(), invalidTargetingAutomationError()), deps), (err: unknown) => {
      assert.equal(err, second, "Meta's own error from the refusal of Advantage+ itself");
      const e = err as { code: number; subcode: number };
      assert.equal(e.code, 100);
      assert.equal(e.subcode, 1870196);
      return true;
    });
    assert.equal(sent.length, 1, "one retry (step 2), then no more");
    for (const p of sent) {
      assert.equal(p.targeting.targeting_automation?.advantage_audience, 1, "never advantage_audience 0");
      assert.equal(p.targeting.age_max, 65, "never the draft's 45 as a hard ceiling");
    }
  });

  it("step 3 directly: Advantage+ with no age suggestion refused → fails with Meta's error unchanged, no retry", async () => {
    let calls = 0;
    const deps = baseDeps({
      createMetaAdSet: async () => {
        calls += 1;
        return { id: "meta_as_should_not_exist" };
      },
    });
    const refusal = invalidTargetingAutomationError();
    await assert.rejects(createAdSetWithSalvage(params(noSuggestionPayload(), refusal), deps), (err: unknown) => {
      assert.equal(err, refusal);
      const e = err as { code: number; subcode: number; message: string };
      assert.equal(e.code, 100);
      assert.equal(e.subcode, 1870196);
      assert.match(e.message, /targeting automation type passed is invalid/);
      return true;
    });
    assert.equal(calls, 0, "no second createMetaAdSet call — the audience is never changed behind the operator's back");
  });

  it("logs Meta's code, subcode and message for each refusal", async () => {
    const logged: string[] = [];
    const origErr = console.error;
    const origWarn = console.warn;
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    console.warn = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    try {
      const deps = baseDeps({
        createMetaAdSet: async () => {
          throw invalidTargetingAutomationError();
        },
      });
      await assert.rejects(createAdSetWithSalvage(params(step1Payload(), invalidTargetingAutomationError()), deps));
    } finally {
      console.error = origErr;
      console.warn = origWarn;
    }
    const suggestion = logged.find((l) => l.includes("Meta refused the age suggestion"));
    const advantage = logged.find((l) => l.includes("Meta refused Advantage+ Audience"));
    assert.match(suggestion ?? "", /code=100 subcode=1870196 message=targeting automation type passed is invalid/);
    assert.match(advantage ?? "", /code=100 subcode=1870196 message=.*not retried as strict targeting/);
  });
});

// ─── createAdSetWithSalvage — Tier 3: 1870227 ───────────────────────────────

describe("createAdSetWithSalvage — subcode 1870227 (missing advantage_audience flag)", () => {
  it("retries with advantage_audience forced explicitly per adSet.advantagePlus", async () => {
    let retryPayloadSeen: MetaAdSetPayload | undefined;
    const deps = baseDeps({
      createMetaAdSet: async (_acc, p) => {
        retryPayloadSeen = p;
        return { id: "meta_as_1" };
      },
    });

    const res = await createAdSetWithSalvage(
      {
        adSet: adSet({ advantagePlus: true }),
        initialPayload: payload([]),
        initialError: missingAdvantageAudienceFlagError(),
        adAccountId: "act_1",
        logPrefix: "Phase 2",
        asStart: Date.now(),
        freshReadinessResults: new Map(),
        preflightDroppedCount: 0,
        audienceNameById: new Map(),
        pageGroups: [],
      },
      deps,
    );

    assert.equal(res.metaAdSetId, "meta_as_1");
    assert.deepEqual(retryPayloadSeen?.targeting.targeting_automation, { advantage_audience: 1 });
  });

  it("sends advantage_audience: 0 when the ad set is not Advantage+", async () => {
    let retryPayloadSeen: MetaAdSetPayload | undefined;
    const deps = baseDeps({
      createMetaAdSet: async (_acc, p) => {
        retryPayloadSeen = p;
        return { id: "meta_as_1" };
      },
    });

    await createAdSetWithSalvage(
      {
        adSet: adSet({ advantagePlus: false }),
        initialPayload: payload([]),
        initialError: missingAdvantageAudienceFlagError(),
        adAccountId: "act_1",
        logPrefix: "Phase 2",
        asStart: Date.now(),
        freshReadinessResults: new Map(),
        preflightDroppedCount: 0,
        audienceNameById: new Map(),
        pageGroups: [],
      },
      deps,
    );

    assert.deepEqual(retryPayloadSeen?.targeting.targeting_automation, { advantage_audience: 0 });
  });

  it("keeps the age suggestion as sent (individual_setting, age_range, controls) — the audience is unchanged", async () => {
    let retryPayloadSeen: MetaAdSetPayload | undefined;
    const deps = baseDeps({
      createMetaAdSet: async (_acc, p) => {
        retryPayloadSeen = p;
        return { id: "meta_as_1" };
      },
    });
    const sent = payload(["ca_1"], {
      targeting: {
        custom_audiences: [{ id: "ca_1" }],
        geo_locations: { countries: ["GB"] },
        age_min: 18,
        age_max: 65,
        age_range: [18, 45],
        targeting_automation: { individual_setting: { age: 1 } },
      },
    } as unknown as Partial<MetaAdSetPayload>);

    const res = await createAdSetWithSalvage(
      {
        adSet: adSet({ advantagePlus: true, ageMin: 18, ageMax: 45 }),
        initialPayload: sent,
        initialError: missingAdvantageAudienceFlagError(),
        adAccountId: "act_1",
        logPrefix: "Phase 2",
        asStart: Date.now(),
        freshReadinessResults: new Map(),
        preflightDroppedCount: 0,
        audienceNameById: new Map(),
        pageGroups: [],
      },
      deps,
    );

    assert.deepEqual(retryPayloadSeen?.targeting.targeting_automation, {
      individual_setting: { age: 1 },
      advantage_audience: 1,
    });
    assert.deepEqual(retryPayloadSeen?.targeting.age_range, [18, 45]);
    assert.equal(retryPayloadSeen?.targeting.age_min, 18);
    assert.equal(retryPayloadSeen?.targeting.age_max, 65);
    assert.deepEqual(retryPayloadSeen?.targeting.custom_audiences, [{ id: "ca_1" }]);
    // Meta's first refusal travels next to the note.
    assert.deepEqual(res.metaError, { code: 100, subcode: 1870227, message: "advantage_audience must be set" });
    assert.match(res.note ?? "", /advantage_audience=1/);
  });
});

// ─── createAdSetWithSalvage — Tier 4: fallthrough diagnostic ───────────────

describe("createAdSetWithSalvage — fallthrough", () => {
  it("rethrows an unrecognised Meta error UNCHANGED (so a caller's own interest-dep check still sees it)", async () => {
    const original = Object.assign(new Error("(#100) interest is deprecated"), { code: 100, subcode: 1870247 });
    await assert.rejects(
      createAdSetWithSalvage(
        {
          adSet: adSet(),
          initialPayload: payload([]),
          initialError: original,
          adAccountId: "act_1",
          logPrefix: "Phase 2",
          asStart: Date.now(),
          freshReadinessResults: new Map(),
          preflightDroppedCount: 0,
          audienceNameById: new Map(),
          pageGroups: [],
        },
        baseDeps(),
      ),
      (err: unknown) => err === original,
    );
  });

  it("rethrows a plain (non-Meta-shaped) error unchanged", async () => {
    const original = new Error("network blip");
    await assert.rejects(
      createAdSetWithSalvage(
        {
          adSet: adSet(),
          initialPayload: payload([]),
          initialError: original,
          adAccountId: "act_1",
          logPrefix: "Phase 2",
          asStart: Date.now(),
          freshReadinessResults: new Map(),
          preflightDroppedCount: 0,
          audienceNameById: new Map(),
          pageGroups: [],
        },
        baseDeps(),
      ),
      (err: unknown) => err === original,
    );
  });
});

// ─── freshReadinessResults overlay into the 1359207 loop ───────────────────

describe("createAdSetWithSalvage — readiness-wait overlay (task #122)", () => {
  it("keeps a 441/populating id after the readiness wait — does not overlay it as dead", async () => {
    const timedOut: AudienceReadinessWaitResult = {
      id: "ca_still_populating",
      ready: false,
      timedOut: true,
      finalCode: 441,
      finalDescription: "You can start running ads with this audience straight away.",
    };
    let retryIds: string[] = [];
    const deps = baseDeps({
      fetchCustomAudienceAvailability: async (ids) =>
        ids.map((id) => ({ id, available: id !== "ca_stale" })),
      createMetaAdSet: async (_acc, p) => {
        retryIds = (p.targeting.custom_audiences ?? []).map((a) => a.id);
        return { id: "meta_as_1" };
      },
    });

    const res = await createAdSetWithSalvage(
      {
        adSet: adSet(),
        initialPayload: payload(["ca_still_populating", "ca_stale", "ca_good"]),
        initialError: deletedCaError(),
        adAccountId: "act_1",
        logPrefix: "Phase 2",
        asStart: Date.now(),
        freshReadinessResults: new Map([["ca_still_populating", timedOut]]),
        preflightDroppedCount: 0,
        audienceNameById: new Map([["ca_still_populating", "Garage Audience — FB Likes"]]),
        pageGroups: [],
      },
      deps,
    );

    assert.equal(res.metaAdSetId, "meta_as_1");
    assert.deepEqual(retryIds, ["ca_still_populating", "ca_good"]);
    assert.match(res.note ?? "", /ca_stale/);
    assert.ok(!(res.note ?? "").includes("still populating"));
  });

  it("still overlays a genuinely dead wait outcome (null / non-441 terminal) as unavailable", async () => {
    const dead: AudienceReadinessWaitResult = {
      id: "ca_gone",
      ready: false,
      timedOut: false,
      finalCode: 411,
      finalDescription: "deleted",
    };
    let retryIds: string[] = [];
    const deps = baseDeps({
      fetchCustomAudienceAvailability: async (ids) => ids.map((id) => ({ id, available: true })),
      createMetaAdSet: async (_acc, p) => {
        retryIds = (p.targeting.custom_audiences ?? []).map((a) => a.id);
        return { id: "meta_as_1" };
      },
    });

    const res = await createAdSetWithSalvage(
      {
        adSet: adSet(),
        initialPayload: payload(["ca_gone", "ca_good"]),
        initialError: deletedCaError(),
        adAccountId: "act_1",
        logPrefix: "Phase 2",
        asStart: Date.now(),
        freshReadinessResults: new Map([["ca_gone", dead]]),
        preflightDroppedCount: 0,
        audienceNameById: new Map([["ca_gone", "Garage Audience — stale"]]),
        pageGroups: [],
      },
      deps,
    );

    assert.equal(res.metaAdSetId, "meta_as_1");
    assert.deepEqual(retryIds, ["ca_good"]);
    assert.match(res.note ?? "", /unavailable \(code 411\)/);
  });
});
