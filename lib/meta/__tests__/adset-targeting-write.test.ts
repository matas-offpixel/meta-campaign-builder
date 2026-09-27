import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ADSET_TARGETING_WRITES_DISABLED_MESSAGE,
  LEARNING_PHASE_WARNING,
} from "../adset-targeting-copy.ts";
import {
  adsetTargetingLedgerTriple,
  adsetTargetingWritesEnabled,
  applyAdSetAudienceChanges,
  formatAdSetAudienceDiff,
  mergeAudienceIntoTargeting,
  planAdSetAudienceChanges,
  type AdSetTargetingGraph,
  type AdSetTargetingSnapshot,
} from "../adset-targeting-write.ts";

const AUDIENCE = { id: "555", name: "DHB Pixel Purchase 180d" };
const CAMPAIGN_ID = "120251738050060755";

function fourteenFieldTargeting(): Record<string, unknown> {
  const custom = Array.from({ length: 61 }, (_, index) => ({
    id: String(1000 + index),
    name: `Audience ${index}`,
  }));
  return {
    geo_locations: { countries: ["GB"], cities: [{ key: "2643743", radius: 25 }] },
    age_min: 18,
    age_max: 54,
    custom_audiences: custom,
    excluded_custom_audiences: [{ id: "9", name: "Exclude me" }],
    flexible_spec: [{ interests: [{ id: "6003139266461", name: "House music" }] }],
    targeting_automation: { advantage_audience: 1 },
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed", "story"],
    instagram_positions: ["stream", "story", "reels"],
    device_platforms: ["mobile"],
    genders: [0],
    locales: [6],
    brand_safety_content_filter_levels: ["FACEBOOK_STANDARD"],
  };
}

function without(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

function snapshot(
  adSetId: string,
  targeting: Record<string, unknown>,
  overrides: Partial<AdSetTargetingSnapshot> = {},
): AdSetTargetingSnapshot {
  return {
    id: adSetId,
    name: overrides.name ?? "Lineup Direct",
    effectiveStatus: overrides.effectiveStatus ?? "PAUSED",
    campaignId: overrides.campaignId ?? CAMPAIGN_ID,
    targeting,
  };
}

describe("mergeAudienceIntoTargeting", () => {
  it("returns every field and a longer custom_audiences list", () => {
    const original = fourteenFieldTargeting();
    const frozen = structuredClone(original);
    assert.equal(Object.keys(original).length, 14);
    const merged = mergeAudienceIntoTargeting(original, AUDIENCE, "include", "add");
    assert.equal(merged.ok, true);
    if (!merged.ok) return;
    assert.deepEqual(original, frozen);
    assert.deepEqual(
      without(merged.targeting, "custom_audiences"),
      without(frozen, "custom_audiences"),
    );
    const before = frozen.custom_audiences as unknown[];
    const after = merged.targeting.custom_audiences as unknown[];
    assert.equal(after.length, 62);
    assert.deepEqual(after.slice(0, 61), before);
    assert.deepEqual(after[61], { id: AUDIENCE.id, name: AUDIENCE.name });
    assert.equal(
      formatAdSetAudienceDiff({
        adSetName: "Lineup Direct",
        audienceName: AUDIENCE.name,
        direction: "include",
        action: "add",
        beforeCount: merged.beforeCount,
        afterCount: merged.afterCount,
      }),
      "Lineup Direct: +DHB Pixel Purchase 180d (include) · 61 → 62 audiences",
    );
  });

  it("exclude path mutates only excluded_custom_audiences", () => {
    const original = fourteenFieldTargeting();
    const merged = mergeAudienceIntoTargeting(original, AUDIENCE, "exclude", "add");
    assert.equal(merged.ok, true);
    if (!merged.ok) return;
    assert.deepEqual(merged.targeting.custom_audiences, original.custom_audiences);
    assert.deepEqual(
      without(merged.targeting, "excluded_custom_audiences"),
      without(original, "excluded_custom_audiences"),
    );
    const excluded = merged.targeting.excluded_custom_audiences as unknown[];
    assert.equal(excluded.length, 2);
    assert.deepEqual(excluded[1], { id: AUDIENCE.id, name: AUDIENCE.name });
  });

  it("remove reverses an add exactly", () => {
    const original = fourteenFieldTargeting();
    const added = mergeAudienceIntoTargeting(original, AUDIENCE, "include", "add");
    assert.equal(added.ok, true);
    if (!added.ok) return;
    const removed = mergeAudienceIntoTargeting(added.targeting, AUDIENCE, "include", "remove");
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    assert.deepEqual(removed.targeting, original);
    assert.equal(removed.beforeCount, 62);
    assert.equal(removed.afterCount, 61);
  });

  it("refuses an audience that is already on the list", () => {
    const original = fourteenFieldTargeting();
    (original.custom_audiences as unknown[]).push({ id: AUDIENCE.id, name: AUDIENCE.name });
    const merged = mergeAudienceIntoTargeting(original, AUDIENCE, "include", "add");
    assert.deepEqual(merged, { ok: false, reason: "already_present" });
  });
});

describe("ad set audience push", () => {
  function graphFor(
    reads: Record<string, AdSetTargetingSnapshot | "fail">,
    writes: Array<{ id: string; targeting: Record<string, unknown> }> = [],
  ): AdSetTargetingGraph {
    return {
      async read(adSetId) {
        const row = reads[adSetId];
        if (row === "fail" || !row) throw new Error(`read failed ${adSetId}`);
        return structuredClone(row);
      },
      async write(adSetId, targeting) {
        writes.push({ id: adSetId, targeting });
      },
    };
  }

  it("refuses an ad set that already has the audience and writes the other", async () => {
    const present = fourteenFieldTargeting();
    (present.custom_audiences as unknown[]).push({ id: AUDIENCE.id, name: AUDIENCE.name });
    const writes: Array<{ id: string; targeting: Record<string, unknown> }> = [];
    const results = await applyAdSetAudienceChanges({
      adSetIds: ["1111111111", "2222222222"],
      audience: AUDIENCE,
      direction: "include",
      action: "add",
      campaignId: CAMPAIGN_ID,
      writesEnabled: true,
      ledger: memoryLedger().context,
      graph: graphFor(
        {
          "1111111111": snapshot("1111111111", present, { name: "Already" }),
          "2222222222": snapshot("2222222222", fourteenFieldTargeting(), { name: "Open" }),
        },
        writes,
      ),
    });
    assert.equal(results[0]?.outcome, "refused");
    assert.equal(results[1]?.outcome, "written");
    assert.deepEqual(writes.map((row) => row.id), ["2222222222"]);
  });

  it("refuses a failed read and does not POST it", async () => {
    const writes: Array<{ id: string; targeting: Record<string, unknown> }> = [];
    const results = await applyAdSetAudienceChanges({
      adSetIds: ["3333333333", "4444444444"],
      audience: AUDIENCE,
      direction: "include",
      action: "add",
      campaignId: CAMPAIGN_ID,
      writesEnabled: true,
      ledger: memoryLedger().context,
      graph: graphFor(
        {
          "3333333333": "fail",
          "4444444444": snapshot("4444444444", fourteenFieldTargeting()),
        },
        writes,
      ),
    });
    assert.equal(results[0]?.outcome, "refused");
    assert.match(results[0]?.reason ?? "", /Could not read/);
    assert.equal(results[1]?.outcome, "written");
    assert.deepEqual(writes.map((row) => row.id), ["4444444444"]);
  });

  it("refuses ARCHIVED and DELETED without a POST", async () => {
    const writes: string[] = [];
    const results = await planAdSetAudienceChanges({
      adSetIds: ["5555555555", "6666666666"],
      audience: AUDIENCE,
      direction: "include",
      action: "add",
      campaignId: CAMPAIGN_ID,
      graph: {
        async read(adSetId) {
          return snapshot("5555555555", fourteenFieldTargeting(), {
            name: adSetId,
            effectiveStatus: adSetId === "5555555555" ? "ARCHIVED" : "DELETED",
          });
        },
        async write(adSetId) {
          writes.push(adSetId);
        },
      },
    });
    assert.equal(results[0]?.reason, "Ad set is ARCHIVED");
    assert.equal(results[1]?.reason, "Ad set is DELETED");
    assert.deepEqual(writes, []);
  });

  it("gate off performs no read and no POST", async () => {
    let reads = 0;
    let writes = 0;
    const results = await applyAdSetAudienceChanges({
      adSetIds: ["7777777777"],
      audience: AUDIENCE,
      direction: "include",
      action: "add",
      campaignId: CAMPAIGN_ID,
      writesEnabled: false,
      ledger: memoryLedger().context,
      graph: {
        async read() {
          reads += 1;
          return snapshot("7777777777", fourteenFieldTargeting());
        },
        async write() {
          writes += 1;
        },
      },
    });
    assert.equal(reads, 0);
    assert.equal(writes, 0);
    assert.equal(results[0]?.reason, ADSET_TARGETING_WRITES_DISABLED_MESSAGE);
    assert.equal(adsetTargetingWritesEnabled({}), false);
    assert.equal(adsetTargetingWritesEnabled({ OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED: "1" }), false);
    assert.equal(adsetTargetingWritesEnabled({ OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED: "true" }), true);
  });

  it("a second run of the same triple does not POST", async () => {
    const db = memoryLedger();
    let writes = 0;
    const request = {
      adSetIds: ["8888888888"],
      audience: AUDIENCE,
      direction: "include" as const,
      action: "add" as const,
      campaignId: CAMPAIGN_ID,
      writesEnabled: true,
      ledger: db.context,
      graph: {
        async read() {
          return snapshot("8888888888", fourteenFieldTargeting());
        },
        async write() {
          writes += 1;
        },
      },
    };
    const first = await applyAdSetAudienceChanges(request);
    const second = await applyAdSetAudienceChanges(request);
    assert.equal(first[0]?.outcome, "written");
    assert.equal(second[0]?.outcome, "noop");
    assert.equal(writes, 1);
    assert.deepEqual(
      adsetTargetingLedgerTriple({
        adSetId: "8888888888",
        audienceId: AUDIENCE.id,
        direction: "include",
        action: "add",
      }),
      { adset_id: "8888888888", audience_id: AUDIENCE.id, direction: "include" },
    );
  });

  it("add, remove, add, remove each POST once, and retrying the third step does not", async () => {
    const adSetId = "1515151515";
    async function runSequence(steps: Array<"add" | "remove">, staleOnLast = false) {
      const db = memoryLedger();
      let included = false;
      let writes = 0;
      let step = 0;
      const outcomes = [];
      for (const action of steps) {
        step += 1;
        const stale = staleOnLast && step === steps.length;
        const result = await applyAdSetAudienceChanges({
          adSetIds: [adSetId],
          audience: AUDIENCE,
          direction: "include",
          action,
          campaignId: CAMPAIGN_ID,
          writesEnabled: true,
          ledger: db.context,
          graph: {
            async read() {
              const targeting = fourteenFieldTargeting();
              if (included && !stale) {
                (targeting.custom_audiences as unknown[]).push({
                  id: AUDIENCE.id,
                  name: AUDIENCE.name,
                });
              }
              return snapshot(adSetId, targeting);
            },
            async write(_id, targeting) {
              writes += 1;
              const list = targeting.custom_audiences as Array<{ id: string }>;
              included = list.some((entry) => entry.id === AUDIENCE.id);
            },
          },
        });
        outcomes.push(result[0]);
      }
      return { writes, outcomes };
    }

    const four = await runSequence(["add", "remove", "add", "remove"]);
    assert.equal(four.writes, 4);
    assert.deepEqual(
      four.outcomes.map((row) => row?.outcome),
      ["written", "written", "written", "written"],
    );

    const retried = await runSequence(["add", "remove", "add", "add"], true);
    assert.equal(retried.writes, 3);
    assert.equal(retried.outcomes[3]?.outcome, "noop");
  });

  it("remove writes the list without the audience and leaves every other field", async () => {
    const original = fourteenFieldTargeting();
    (original.custom_audiences as unknown[]).push({ id: AUDIENCE.id, name: AUDIENCE.name });
    const writes: Array<Record<string, unknown>> = [];
    const results = await applyAdSetAudienceChanges({
      adSetIds: ["9999999999"],
      audience: AUDIENCE,
      direction: "include",
      action: "remove",
      campaignId: CAMPAIGN_ID,
      writesEnabled: true,
      ledger: memoryLedger().context,
      graph: {
        async read() {
          return snapshot("9999999999", original, { name: "Lineup Direct" });
        },
        async write(_id, targeting) {
          writes.push(targeting);
        },
      },
    });
    assert.equal(results[0]?.outcome, "written");
    assert.match(results[0]?.diff ?? "", /−DHB Pixel Purchase 180d \(include\) · 62 → 61/);
    const written = writes[0]!;
    const expected = fourteenFieldTargeting();
    assert.deepEqual(written, expected);
  });

  it("one write failure does not stop the next ad set", async () => {
    const results = await applyAdSetAudienceChanges({
      adSetIds: ["1212121212", "1313131313"],
      audience: AUDIENCE,
      direction: "include",
      action: "add",
      campaignId: CAMPAIGN_ID,
      writesEnabled: true,
      ledger: memoryLedger().context,
      graph: {
        async read(adSetId) {
          return snapshot(adSetId, fourteenFieldTargeting(), { name: adSetId });
        },
        async write(adSetId) {
          if (adSetId === "1212121212") throw new Error("Meta rejected 1212121212");
        },
      },
    });
    assert.equal(results[0]?.outcome, "failed");
    assert.match(results[0]?.reason ?? "", /1212121212/);
    assert.equal(results[1]?.outcome, "written");
  });

  it("a ledger that cannot record the op does not POST", async () => {
    let writes = 0;
    const db = memoryLedger();
    db.lookupError = { code: "23514", message: "op_kind check" };
    const results = await applyAdSetAudienceChanges({
      adSetIds: ["1414141414"],
      audience: AUDIENCE,
      direction: "include",
      action: "add",
      campaignId: CAMPAIGN_ID,
      writesEnabled: true,
      ledger: db.context,
      graph: {
        async read() {
          return snapshot("1414141414", fourteenFieldTargeting());
        },
        async write() {
          writes += 1;
        },
      },
    });
    assert.equal(writes, 0);
    assert.equal(results[0]?.outcome, "failed");
    assert.match(results[0]?.reason ?? "", /ledger is required/);
  });
});

describe("targeting push stays off the launch route", () => {
  it("does not add a write to launch or optimisation", () => {
    const launch = readFileSync("app/api/meta/launch-campaign/route.ts", "utf8");
    const apply = readFileSync("lib/optimisation/apply.ts", "utf8");
    const route = readFileSync("app/api/meta/adset-audience/route.ts", "utf8");
    const ui = readFileSync("components/library/adset-audience-push.tsx", "utf8");
    assert.equal(launch.includes("adset-targeting-write"), false);
    assert.equal(launch.includes("adset_targeting_update"), false);
    assert.equal(apply.includes("adset_targeting_update"), false);
    assert.equal(apply.includes("adset-targeting-write"), false);
    const gateAt = route.indexOf("if (commit && !adsetTargetingWritesEnabled())");
    const postAt = route.indexOf("await graphPostWithToken");
    assert.ok(gateAt > 0 && postAt > gateAt);
    assert.match(ui, /disabled=\{!open\}/);
    assert.match(ui, /if \(!open\) return/);
    assert.match(ui, /CrossCampaignAdSetPicker/);
    assert.match(ui, /LEARNING_PHASE_WARNING/);
    assert.equal(ui.includes("customaudiences"), false);
    assert.equal(ui.includes("graphPost"), false);
    assert.equal(LEARNING_PHASE_WARNING.includes("resets its learning phase"), true);
    const hits = walk("components").filter((file) =>
      readFileSync(file, "utf8").includes("customaudiences"),
    );
    assert.deepEqual(hits, []);
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules") continue;
      out.push(...walk(path));
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(path);
    }
  }
  return out;
}

interface IdempotencyRow {
  id: string;
  draft_id: string;
  op_kind: string;
  op_payload_hash: string;
  op_result_id: string | null;
  op_status: "pending" | "success" | "failed";
  [key: string]: unknown;
}

function memoryLedger(): {
  context: {
    supabase: SupabaseClient;
    userId: string;
    draftId: string;
    eventId: string | null;
  };
  lookupError: { code?: string; message?: string } | null;
} {
  const rows: IdempotencyRow[] = [];
  let nextId = 1;
  const state: { lookupError: { code?: string; message?: string } | null } = { lookupError: null };

  class Builder {
    private eqs: Record<string, unknown> = {};
    private pendingUpsert: { id?: string } | null = null;
    private pendingUpdate: Record<string, unknown> | null = null;
    private selected = false;
    private pendingDelete = false;

    select() {
      this.selected = true;
      return this;
    }

    eq(col: string, val: unknown) {
      this.eqs[col] = val;
      if (this.pendingUpdate) {
        const row = rows.find((candidate) =>
          Object.entries(this.eqs).every(([key, value]) => candidate[key] === value),
        );
        if (row) Object.assign(row, this.pendingUpdate);
      }
      return this;
    }

    upsert(payload: Record<string, unknown>) {
      if (state.lookupError && this.selected) {
        this.pendingUpsert = null;
        return this;
      }
      const row = rows.find(
        (candidate) =>
          candidate.draft_id === payload.draft_id &&
          candidate.op_kind === payload.op_kind &&
          candidate.op_payload_hash === payload.op_payload_hash,
      );
      if (row) {
        Object.assign(row, payload);
        this.pendingUpsert = row;
      } else {
        const inserted = {
          id: `idem_${nextId++}`,
          op_result_id: null,
          op_status: "pending",
          ...payload,
        } as IdempotencyRow;
        rows.push(inserted);
        this.pendingUpsert = inserted;
      }
      return this;
    }

    update(patch: Record<string, unknown>) {
      this.pendingUpdate = patch;
      return this;
    }

    delete() {
      this.pendingDelete = true;
      return this;
    }

    maybeSingle() {
      if (state.lookupError && !this.pendingUpsert) {
        return Promise.resolve({ data: null, error: state.lookupError });
      }
      if (this.pendingUpsert && this.selected) {
        return Promise.resolve({ data: { id: this.pendingUpsert.id }, error: null });
      }
      const row =
        rows.find((candidate) =>
          Object.entries(this.eqs).every(([key, value]) => candidate[key] === value),
        ) ?? null;
      return Promise.resolve({ data: row, error: null });
    }

    then(onFulfilled?: (value: { data: null; error: null }) => unknown) {
      if (this.pendingDelete) {
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const candidate = rows[index]!;
          const match = Object.entries(this.eqs).every(
            ([key, value]) => candidate[key] === value,
          );
          if (match) rows.splice(index, 1);
        }
      }
      const value = { data: null, error: null };
      return Promise.resolve(onFulfilled ? onFulfilled(value) : value);
    }
  }

  const supabase = {
    from() {
      return new Builder();
    },
  } as unknown as SupabaseClient;

  return {
    context: {
      supabase,
      userId: "00000000-0000-4000-8000-000000000001",
      draftId: "00000000-0000-4000-8000-000000000003",
      eventId: null,
    },
    get lookupError() {
      return state.lookupError;
    },
    set lookupError(value) {
      state.lookupError = value;
    },
  };
}
