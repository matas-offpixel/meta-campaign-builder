import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceRoleDb } from "../load.ts";
import { runRenderTick } from "../render-queue.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

const NOW = new Date("2026-11-06T12:00:00Z");

function db(fake: FakeDb) {
  return fake as unknown as ServiceRoleDb;
}

describe("runRenderTick", () => {
  it("claims the oldest queued render and marks its round ad ready", async () => {
    const fake = fakeDb({
      creative_lab_renders: [
        { id: "r-new", status: "queued", created_at: "2026-11-02", caption_id: "c1", user_id: "op" },
        { id: "r-old", status: "queued", created_at: "2026-11-01", caption_id: "c1", user_id: "op" },
      ],
      creative_lab_captions: [{ id: "c1", event_id: "evt" }],
      creative_lab_round_ads: [{ id: "ad1", render_id: "r-old", launch_state: "pending", round_id: "round-1", verdict: null }],
      creative_lab_rounds: [{ id: "round-1", status: "rendering" }],
    });
    const claimed: string[] = [];
    const result = await runRenderTick(db(fake), {
      now: NOW,
      archivedEventIds: new Set(),
      render: async (renderId) => {
        claimed.push(renderId);
        const row = fake.tables.creative_lab_renders.find((item) => item.id === renderId);
        if (row) row.status = "done";
      },
    });
    assert.deepEqual(claimed, ["r-old"]);
    assert.equal(result.claimed, 1);
    assert.equal(fake.tables.creative_lab_renders.find((row) => row.id === "r-new")?.status, "queued");
    assert.equal(fake.tables.creative_lab_round_ads[0].launch_state, "ready");
    assert.equal(fake.tables.creative_lab_rounds[0].status, "draft");
  });

  it("fails a render stuck for 15 minutes and leaves the verdict alone", async () => {
    const fake = fakeDb({
      creative_lab_renders: [{ id: "stuck", status: "rendering", updated_at: "2026-11-06T11:00:00Z", caption_id: "c1", user_id: "op" }],
      creative_lab_captions: [{ id: "c1", event_id: "evt" }],
      creative_lab_round_ads: [{ id: "ad1", render_id: "stuck", launch_state: "pending", round_id: "round-1", verdict: "winner" }],
      creative_lab_rounds: [{ id: "round-1", status: "rendering" }],
    });
    const result = await runRenderTick(db(fake), { now: NOW, archivedEventIds: new Set(), render: async () => {} });
    assert.equal(result.timedOut, 1);
    assert.equal(result.claimed, 0);
    assert.equal(fake.tables.creative_lab_renders[0].status, "failed");
    assert.equal(fake.tables.creative_lab_renders[0].error, "timeout");
    assert.equal(fake.tables.creative_lab_round_ads[0].launch_state, "render_failed");
    assert.equal(fake.tables.creative_lab_round_ads[0].verdict, "winner");
    assert.equal(fake.tables.creative_lab_rounds[0].status, "draft");
  });

  it("does not start a second render while one is still rendering", async () => {
    const fake = fakeDb({
      creative_lab_renders: [
        { id: "busy", status: "rendering", updated_at: NOW.toISOString(), caption_id: "c1", user_id: "op" },
        { id: "waiting", status: "queued", created_at: "2026-11-01", caption_id: "c1", user_id: "op" },
      ],
      creative_lab_captions: [{ id: "c1", event_id: "evt" }],
      creative_lab_round_ads: [],
      creative_lab_rounds: [],
    });
    let called = false;
    const result = await runRenderTick(db(fake), {
      now: NOW,
      archivedEventIds: new Set(),
      render: async () => {
        called = true;
      },
    });
    assert.equal(result.busy, true);
    assert.equal(result.claimed, 0);
    assert.equal(called, false);
    assert.equal(fake.tables.creative_lab_renders.find((row) => row.id === "waiting")?.status, "queued");
  });

  it("leaves an archived client's render queued", async () => {
    const fake = fakeDb({
      creative_lab_renders: [{ id: "r1", status: "queued", created_at: "2026-11-01", caption_id: "c1", user_id: "op" }],
      creative_lab_captions: [{ id: "c1", event_id: "evt-archived" }],
      creative_lab_round_ads: [],
      creative_lab_rounds: [],
    });
    const result = await runRenderTick(db(fake), { now: NOW, archivedEventIds: new Set(["evt-archived"]), render: async () => {} });
    assert.equal(result.skippedArchived, 1);
    assert.equal(result.claimed, 0);
    assert.equal(fake.tables.creative_lab_renders[0].status, "queued");
  });
});
