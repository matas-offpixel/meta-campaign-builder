import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { runAdDailyInsights } from "../runner.ts";
import { captureAccountCopy } from "../copy-capture.ts";
import {
  AD_COPY_BATCH,
  AD_COPY_FIELDS,
  chunkAdIds,
  copyWriteDecision,
  draftCopy,
  graphCopyIsUseful,
  parseAdCopyBatch,
  parseCreativeCopy,
  snapshotCopies,
} from "../copy.ts";

const NOW = new Date("2026-11-07T02:30:00Z");
const FRESH = "2026-11-01T00:00:00Z";
const STALE = "2026-09-01T00:00:00Z";

function metaError(code: number, message: string) {
  return Object.assign(new Error(message), { code });
}

function ad(id: string) {
  return { ad_id: id, date_start: "2026-11-06", spend: "1", actions: [] };
}

describe("ad copy parse", () => {
  it("keeps every asset_feed_spec variant", () => {
    const parsed = parseCreativeCopy({
      id: "cr_1",
      asset_feed_spec: {
        bodies: [{ text: "Body A" }, { text: "Body B" }, { text: "  " }, "Body A", { text: "Body C" }],
        titles: [{ text: "Title 1" }, { text: "Title 2" }],
        descriptions: [{ text: "Desc 1" }, { text: "Desc 2" }],
        call_to_action_types: ["LEARN_MORE"],
      },
    });
    assert.deepEqual(parsed?.bodies, ["Body A", "Body B", "Body C"]);
    assert.deepEqual(parsed?.titles, ["Title 1", "Title 2"]);
    assert.deepEqual(parsed?.descriptions, ["Desc 1", "Desc 2"]);
    assert.equal(parsed?.callToAction, "LEARN_MORE");
    assert.equal(graphCopyIsUseful(parsed!), true);
  });

  it("keeps effective_object_story_id when the post has no creative text", () => {
    const parsed = parseCreativeCopy({
      id: "cr_post",
      effective_object_story_id: "111_222",
      call_to_action_type: "GET_TICKETS",
    });
    assert.equal(parsed?.effectiveObjectStoryId, "111_222");
    assert.deepEqual(parsed?.bodies, []);
    assert.equal(parsed?.callToAction, "GET_TICKETS");
    const batch = parseAdCopyBatch({ ad_9: { creative: parsed && {
      id: "cr_post",
      effective_object_story_id: "111_222",
      call_to_action_type: "GET_TICKETS",
    } } });
    assert.equal(batch.get("ad_9")?.effectiveObjectStoryId, "111_222");
  });

  it("a fallback never overwrites a graph row, fresh or stale", () => {
    const graph = { source: "graph" as const, fetchedAt: FRESH };
    assert.equal(copyWriteDecision(graph, "snapshot", NOW), "skip");
    assert.equal(copyWriteDecision(graph, "draft", NOW), "skip");
    assert.equal(copyWriteDecision({ source: "graph", fetchedAt: STALE }, "snapshot", NOW), "skip");
    assert.equal(copyWriteDecision({ source: "graph", fetchedAt: STALE }, "lab", NOW), "skip");
    assert.equal(copyWriteDecision(undefined, "snapshot", NOW), "write");
    assert.equal(copyWriteDecision({ source: "snapshot", fetchedAt: STALE }, "graph", NOW), "write");
    assert.equal(copyWriteDecision(graph, "graph", NOW), "skip");
  });

  it("snapshot and draft copy are the gap fill", () => {
    const snaps = snapshotCopies({
      groups: [{ representative_ad_id: "ad_1", representative_body_preview: "From the snapshot", representative_headline: "Headline" }],
    });
    assert.equal(snaps.get("ad_1")?.bodies[0], "From the snapshot");
    const fromDraft = draftCopy(
      { creatives: [{ name: "Hero", headline: "See you", description: "Saturday", captions: [{ text: "Line one" }, { text: "Line two" }], cta: "BUY_TICKETS" }] },
      "Hero",
      "ad_2",
    );
    assert.deepEqual(fromDraft?.bodies, ["Line one", "Line two"]);
    assert.deepEqual(fromDraft?.titles, ["See you"]);
    assert.equal(fromDraft?.callToAction, "BUY_TICKETS");
  });
});

describe("ad copy capture", () => {
  it("batches at 50 and counts every call", async () => {
    const ids = Array.from({ length: AD_COPY_BATCH + 1 }, (_, i) => `ad_${i}`);
    assert.deepEqual(chunkAdIds(ids).map((chunk) => chunk.length), [50, 1]);
    const seen: { ids: string; fields: string }[] = [];
    const { db } = fakeDb((call) => {
      if (call.table === "ad_copy" && op(call, "select")) return { data: [] };
      return { data: [], error: null };
    });
    const result = await captureAccountCopy({
      db,
      adAccountId: "act_1",
      ads: ids.map((metaAdId) => ({ metaAdId, adName: null })),
      now: NOW,
      multiGet: async (_path, params) => {
        seen.push({ ids: params.ids, fields: params.fields });
        return {};
      },
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[0].ids.split(",").length, 50);
    assert.equal(seen[1].ids.split(",").length, 1);
    assert.equal(seen[0].fields, AD_COPY_FIELDS);
    assert.equal(result.calls, 2);
    assert.equal(result.status, "ok");
  });

  it("a rate limit stops the account and does not write a fallback over the unread ads", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.table === "ad_copy" && op(call, "select")) return { data: [] };
      if (call.table === "active_creatives_snapshots") {
        return { data: [{ payload: { groups: [{ representative_ad_id: "ad_50", representative_body_preview: "should not land" }] } }] };
      }
      return { error: null };
    });
    let callsMade = 0;
    const result = await captureAccountCopy({
      db,
      adAccountId: "act_1",
      ads: Array.from({ length: 51 }, (_, i) => ({ metaAdId: `ad_${i}`, adName: null })),
      now: NOW,
      multiGet: async () => {
        callsMade++;
        throw metaError(80004, "too many calls");
      },
    });
    assert.equal(callsMade, 1);
    assert.equal(result.status, "rate_limited");
    assert.equal(result.calls, 1);
    assert.equal(calls.some((call) => call.table === "active_creatives_snapshots"), false);
    assert.equal(calls.some((call) => call.table === "ad_copy" && op(call, "upsert")), false);
  });

  it("does not replace a graph row with snapshot copy", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.table === "ad_copy" && op(call, "select")) {
        return { data: [{ meta_ad_id: "ad_1", source: "graph", fetched_at: STALE }] };
      }
      if (call.table === "active_creatives_snapshots") {
        return { data: [{ payload: { groups: [{ representative_ad_id: "ad_1", representative_body_preview: "snapshot body" }] } }] };
      }
      return { error: null };
    });
    await captureAccountCopy({
      db,
      adAccountId: "act_1",
      ads: [{ metaAdId: "ad_1", adName: "One" }],
      now: NOW,
      multiGet: async () => ({ ad_1: { creative: {} } }),
    });
    const upsert = calls.find((call) => call.table === "ad_copy" && op(call, "upsert"));
    assert.equal(upsert, undefined);
    assert.equal(calls.some((call) => call.table === "active_creatives_snapshots"), false);
  });

  it("fills a gap from the snapshot when Graph has no copy", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.table === "ad_copy" && op(call, "select")) return { data: [] };
      if (call.table === "active_creatives_snapshots") {
        return { data: [{ payload: { groups: [{ representative_ad_id: "ad_1", representative_body_preview: "snapshot body", representative_headline: "H" }] } }] };
      }
      return { error: null };
    });
    const result = await captureAccountCopy({
      db,
      adAccountId: "act_1",
      ads: [{ metaAdId: "ad_1", adName: null }],
      now: NOW,
      multiGet: async () => ({ ad_1: { creative: {} } }),
    });
    assert.equal(result.written, 1);
    const rows = op(calls.find((call) => call.table === "ad_copy" && op(call, "upsert"))!, "upsert")?.[0] as { source: string; bodies: string[] }[];
    assert.equal(rows[0].source, "snapshot");
    assert.deepEqual(rows[0].bodies, ["snapshot body"]);
  });
});

describe("ad copy killswitch", () => {
  it("off means the insights run makes no copy call", async () => {
    let copyCalls = 0;
    const { db } = fakeDb(() => ({ error: null }));
    const result = await runAdDailyInsights({
      env: { ENABLE_AD_DAILY_INSIGHTS: "1" },
      db,
      now: NOW,
      accounts: ["act_1"],
      graphGet: async () => ({ data: [ad("ad_1")] }),
      multiGet: async () => {
        copyCalls++;
        return {};
      },
    });
    assert.equal(result.outcomes?.[0].status, "ok");
    assert.equal(result.metaCalls, 1);
    assert.equal(copyCalls, 0);
    assert.equal(result.outcomes?.[0].copyCalls, undefined);
  });

  it("on batches the ads the run saw", async () => {
    const batches: number[] = [];
    const { db } = fakeDb((call) => {
      if (call.table === "ad_copy" && op(call, "select")) return { data: [] };
      return { data: [], error: null };
    });
    const result = await runAdDailyInsights({
      env: { ENABLE_AD_DAILY_INSIGHTS: "1", ENABLE_AD_COPY_CAPTURE: "1" },
      db,
      now: NOW,
      accounts: ["act_1"],
      graphGet: async () => ({ data: Array.from({ length: 51 }, (_, i) => ad(`ad_${i}`)) }),
      multiGet: async (_path, params) => {
        batches.push(params.ids.split(",").length);
        assert.equal(params.fields, AD_COPY_FIELDS);
        return {};
      },
    });
    assert.deepEqual(batches, [50, 1]);
    assert.equal(result.metaCalls, 3);
    assert.equal(result.outcomes?.[0].copyCalls, 2);
  });
});

describe("migration 206 ad_copy", () => {
  const SQL = readFileSync("supabase/migrations/206_ad_copy.sql", "utf8");
  it("is service-role only: authenticated select matches nothing", () => {
    assert.match(SQL, /create table if not exists ad_copy/);
    assert.match(SQL, /meta_ad_id\s+text primary key/);
    assert.match(SQL, /source\s+text not null check \(source in \('graph', 'lab', 'snapshot', 'draft'\)\)/);
    assert.match(SQL, /for select to authenticated using \(false\)/);
    assert.doesNotMatch(SQL, /for (insert|update|delete)/);
    assert.doesNotMatch(SQL, /using \(true\)/);
    assert.match(SQL, /notify pgrst, 'reload schema';\s*$/);
  });
});
