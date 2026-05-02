import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  bulkUpsertCreativeTagAssignments,
  extractMotionSeedTags,
  importMotionSeedTags,
  listCreativeTagAssignments,
  listCreativeTagAssignmentsByEvents,
  listCreativeTags,
  upsertCreativeScore,
  upsertCreativeTagAssignment,
} from "../creative-tags.ts";

interface Recorder {
  table: string | null;
  selects: string[];
  eqs: Array<{ col: string; val: unknown }>;
  nots: Array<{ col: string; op: string; val: unknown }>;
  ins: Array<{ col: string; vals: unknown[] }>;
  orders: Array<{ col: string; opts: Record<string, unknown> }>;
  upserts: unknown[];
  upsertOpts: Array<Record<string, unknown> | undefined>;
  result: { data: unknown; error: { message: string } | null };
}

function makeStub(result: Recorder["result"]): {
  client: SupabaseClient;
  rec: Recorder;
} {
  const rec: Recorder = {
    table: null,
    selects: [],
    eqs: [],
    nots: [],
    ins: [],
    orders: [],
    upserts: [],
    upsertOpts: [],
    result,
  };

  const builder: Record<string, unknown> = {
    select(cols: string) {
      rec.selects.push(cols);
      return builder;
    },
    eq(col: string, val: unknown) {
      rec.eqs.push({ col, val });
      return builder;
    },
    not(col: string, op: string, val: unknown) {
      rec.nots.push({ col, op, val });
      return builder;
    },
    in(col: string, vals: unknown[]) {
      rec.ins.push({ col, vals });
      return builder;
    },
    order(col: string, opts: Record<string, unknown>) {
      rec.orders.push({ col, opts });
      return builder;
    },
    upsert(payload: unknown, opts?: Record<string, unknown>) {
      rec.upserts.push(payload);
      rec.upsertOpts.push(opts);
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(rec.result);
    },
    then(onFulfilled?: (v: Recorder["result"]) => unknown) {
      const value = onFulfilled ? onFulfilled(rec.result) : rec.result;
      return Promise.resolve(value);
    },
  };

  const client = {
    from(table: string) {
      rec.table = table;
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, rec };
}

const USER_ID = "00000000-0000-0000-0000-000000000001";
const EVENT_ID = "00000000-0000-0000-0000-000000000002";
const TAG_ID = "00000000-0000-0000-0000-000000000003";

describe("listCreativeTags", () => {
  it("reads taxonomy rows and applies an optional dimension filter", async () => {
    const { client, rec } = makeStub({
      data: [
        {
          id: TAG_ID,
          user_id: USER_ID,
          dimension: "asset_type",
          value_key: "ugc",
          value_label: "UGC",
          description: null,
          source: "motion_seed",
          created_at: "2026-04-30T00:00:00Z",
          updated_at: "2026-04-30T00:00:00Z",
        },
      ],
      error: null,
    });

    const rows = await listCreativeTags(client, "asset_type");

    assert.equal(rows.length, 1);
    assert.equal(rows[0].value_key, "ugc");
    assert.equal(rec.table, "creative_tags");
    assert.deepEqual(rec.nots, [{ col: "dimension", op: "is", val: null }]);
    assert.deepEqual(rec.eqs, [{ col: "dimension", val: "asset_type" }]);
    assert.deepEqual(rec.orders, [
      { col: "dimension", opts: { ascending: true } },
      { col: "value_label", opts: { ascending: true } },
    ]);
  });
});

describe("creative tag assignments", () => {
  it("upserts by event, creative name, and tag", async () => {
    const { client, rec } = makeStub({
      data: {
        id: "assignment-1",
        user_id: USER_ID,
        event_id: EVENT_ID,
        creative_name: "EVT - Hero - v1",
        tag_id: TAG_ID,
        source: "manual",
        confidence: null,
        model_version: null,
        created_at: "2026-04-30T00:00:00Z",
        updated_at: "2026-04-30T00:00:00Z",
      },
      error: null,
    });

    const row = await upsertCreativeTagAssignment(client, {
      userId: USER_ID,
      eventId: EVENT_ID,
      creativeName: "EVT - Hero - v1",
      tagId: TAG_ID,
      source: "manual",
    });

    assert.equal(row.id, "assignment-1");
    assert.equal(rec.table, "creative_tag_assignments");
    assert.deepEqual(rec.upsertOpts[0], {
      onConflict: "event_id,creative_name,tag_id",
    });
    assert.deepEqual(rec.upserts[0], {
      user_id: USER_ID,
      event_id: EVENT_ID,
      creative_name: "EVT - Hero - v1",
      tag_id: TAG_ID,
      source: "manual",
      confidence: null,
    });
  });

  it("lists all assignments for an event and optional creative", async () => {
    const { client, rec } = makeStub({ data: [], error: null });

    await listCreativeTagAssignments(client, EVENT_ID, "EVT - Hero - v1");

    assert.equal(rec.table, "creative_tag_assignments");
    assert.deepEqual(rec.eqs, [
      { col: "event_id", val: EVENT_ID },
      { col: "creative_name", val: "EVT - Hero - v1" },
    ]);
    assert.deepEqual(rec.orders, [
      { col: "creative_name", opts: { ascending: true } },
    ]);
  });

  it("lists assignments for multiple events in one batch", async () => {
    const { client, rec } = makeStub({ data: [], error: null });

    await listCreativeTagAssignmentsByEvents(client, [
      EVENT_ID,
      "00000000-0000-0000-0000-000000000004",
      EVENT_ID,
    ]);

    assert.equal(rec.table, "creative_tag_assignments");
    assert.deepEqual(rec.ins, [
      {
        col: "event_id",
        vals: [EVENT_ID, "00000000-0000-0000-0000-000000000004"],
      },
    ]);
    assert.deepEqual(rec.orders, [
      { col: "event_id", opts: { ascending: true } },
      { col: "creative_name", opts: { ascending: true } },
    ]);
  });

  it("bulk upserts assignments in deduped 200-row chunks", async () => {
    const { client, rec } = makeStub({
      data: [
        {
          event_id: EVENT_ID,
          creative_name: "Creative 0",
          tag_id: `${TAG_ID}-0`,
        },
      ],
      error: null,
    });
    const args = Array.from({ length: 201 }, (_, index) => ({
      userId: USER_ID,
      eventId: EVENT_ID,
      creativeName: `Creative ${index}`,
      tagId: `${TAG_ID}-${index}`,
      source: "manual" as const,
      modelVersion: index === 0 ? "claude-haiku-4-5-20251001" : null,
    }));
    args.push({ ...args[0] });

    const result = await bulkUpsertCreativeTagAssignments(client, args);

    assert.deepEqual(result, { inserted: 200, updated: 1 });
    assert.equal(rec.upserts.length, 2);
    assert.equal((rec.upserts[0] as unknown[]).length, 200);
    assert.equal((rec.upserts[1] as unknown[]).length, 1);
    assert.deepEqual(rec.upsertOpts, [
      { onConflict: "event_id,creative_name,tag_id" },
      { onConflict: "event_id,creative_name,tag_id" },
    ]);
    assert.equal(rec.ins.filter((entry) => entry.col === "event_id").length, 2);
    assert.deepEqual((rec.upserts[0] as Array<Record<string, unknown>>)[0], {
      user_id: USER_ID,
      event_id: EVENT_ID,
      creative_name: "Creative 0",
      tag_id: `${TAG_ID}-0`,
      source: "manual",
      confidence: null,
      model_version: "claude-haiku-4-5-20251001",
    });
  });
});

describe("upsertCreativeScore", () => {
  it("upserts score rows on the Motion-equivalent axis key", async () => {
    const fetchedAt = "2026-04-30T00:00:00Z";
    const { client, rec } = makeStub({
      data: {
        id: "score-1",
        user_id: USER_ID,
        event_id: EVENT_ID,
        creative_name: "EVT - Hero - v1",
        axis: "hook",
        score: 83,
        significance: true,
        fetched_at: fetchedAt,
      },
      error: null,
    });

    const row = await upsertCreativeScore(client, {
      userId: USER_ID,
      eventId: EVENT_ID,
      creativeName: "EVT - Hero - v1",
      axis: "hook",
      score: 83,
      significance: true,
      fetchedAt,
    });

    assert.equal(row.score, 83);
    assert.equal(rec.table, "creative_scores");
    assert.deepEqual(rec.upsertOpts[0], {
      onConflict: "event_id,creative_name,axis,fetched_at",
    });
    assert.deepEqual(rec.upserts[0], {
      user_id: USER_ID,
      event_id: EVENT_ID,
      creative_name: "EVT - Hero - v1",
      axis: "hook",
      score: 83,
      significance: true,
      fetched_at: fetchedAt,
    });
  });
});

describe("importMotionSeedTags", () => {
  it("extracts supported Motion glossary shapes", () => {
    const tags = extractMotionSeedTags({
      asset_type: ["UGC", "Venue footage"],
      values: [
        {
          dimension: "Messaging angle",
          value_key: "price_drop",
          value_label: "Price drop",
          description: "Leads with pricing pressure.",
        },
      ],
      data: [
        {
          name: "Messaging theme",
          values: [
            {
              name: "Urgency / Scarcity / FOMO",
              definition: "Urgency from limited availability.",
              creativeIds: ["motion-creative-1"],
            },
          ],
        },
      ],
    });

    assert.deepEqual(
      tags.map((tag) => [tag.dimension, tag.valueKey, tag.valueLabel]),
      [
        ["asset_type", "ugc", "UGC"],
        ["asset_type", "venue_footage", "Venue footage"],
        ["messaging_angle", "price_drop", "Price drop"],
        [
          "messaging_angle",
          "urgency_scarcity_fomo",
          "Urgency / Scarcity / FOMO",
        ],
      ],
    );
  });

  it("dedupes glossary keys before upsert and counts existing rows as skipped", async () => {
    const { client, rec } = makeStub({
      data: [{ dimension: "asset_type", value_key: "ugc" }],
      error: null,
    });

    const result = await importMotionSeedTags(client, USER_ID, {
      asset_type: ["UGC", "UGC", "Venue footage"],
      hook_tactic: [{ label: "Question hook" }],
    });

    assert.deepEqual(result, { inserted: 2, skipped: 2 });
    assert.equal(rec.table, "creative_tags");
    assert.deepEqual(rec.eqs, [{ col: "user_id", val: USER_ID }]);
    assert.deepEqual(rec.upsertOpts[0], {
      onConflict: "user_id,dimension,value_key",
    });
    assert.deepEqual(rec.upserts[0], [
      {
        user_id: USER_ID,
        dimension: "asset_type",
        value_key: "venue_footage",
        value_label: "Venue footage",
        description: null,
        source: "motion_seed",
      },
      {
        user_id: USER_ID,
        dimension: "hook_tactic",
        value_key: "question_hook",
        value_label: "Question hook",
        description: null,
        source: "motion_seed",
      },
    ]);
  });
});
