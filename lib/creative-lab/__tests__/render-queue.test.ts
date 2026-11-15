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
      maxAtOnce: 1,
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

  it("runs up to four renders at once, oldest first", async () => {
    const queued = ["r1", "r2", "r3", "r4", "r5", "r6"].map((id, i) => ({ id, status: "queued", created_at: `2026-11-0${i + 1}`, caption_id: "c1", user_id: "op" }));
    const fake = fakeDb({
      creative_lab_renders: queued,
      creative_lab_captions: [{ id: "c1", event_id: "evt" }],
      creative_lab_round_ads: queued.map((row) => ({ id: `ad-${row.id}`, render_id: row.id, launch_state: "pending", round_id: "round-1", verdict: null })),
      creative_lab_rounds: [{ id: "round-1", status: "rendering" }],
    });
    let inFlight = 0;
    let peak = 0;
    const started: string[] = [];
    const result = await runRenderTick(db(fake), {
      now: NOW,
      archivedEventIds: new Set(),
      render: async (renderId) => {
        started.push(renderId);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        if (renderId === "r2") throw new Error("lambda failed");
        const row = fake.tables.creative_lab_renders.find((item) => item.id === renderId);
        if (row) row.status = "done";
      },
    });
    assert.equal(result.claimed, 4);
    assert.deepEqual(started, ["r1", "r2", "r3", "r4"]);
    assert.equal(peak, 4);
    const status = (id: string) => fake.tables.creative_lab_renders.find((row) => row.id === id)?.status;
    assert.equal(status("r2"), "failed");
    assert.equal(status("r5"), "queued");
    assert.equal(status("r6"), "queued");
    const ad = (id: string) => fake.tables.creative_lab_round_ads.find((row) => row.render_id === id)?.launch_state;
    assert.equal(ad("r1"), "ready");
    assert.equal(ad("r2"), "render_failed");
    assert.equal(ad("r5"), "pending");
    assert.equal(fake.tables.creative_lab_rounds[0].status, "rendering");
  });

  it("fills only the slots that renders already in flight leave", async () => {
    const fake = fakeDb({
      creative_lab_renders: [
        { id: "busy1", status: "rendering", updated_at: NOW.toISOString(), caption_id: "c1", user_id: "op" },
        { id: "busy2", status: "rendering", updated_at: NOW.toISOString(), caption_id: "c1", user_id: "op" },
        { id: "busy3", status: "rendering", updated_at: NOW.toISOString(), caption_id: "c1", user_id: "op" },
        { id: "w1", status: "queued", created_at: "2026-11-01", caption_id: "c1", user_id: "op" },
        { id: "w2", status: "queued", created_at: "2026-11-02", caption_id: "c1", user_id: "op" },
      ],
      creative_lab_captions: [{ id: "c1", event_id: "evt" }],
      creative_lab_round_ads: [],
      creative_lab_rounds: [],
    });
    const started: string[] = [];
    const result = await runRenderTick(db(fake), { now: NOW, archivedEventIds: new Set(), render: async (id) => void started.push(id) });
    assert.deepEqual(started, ["w1"]);
    assert.equal(result.claimed, 1);
    assert.equal(fake.tables.creative_lab_renders.find((row) => row.id === "w2")?.status, "queued");
  });

  it("does not start a render while four are still rendering", async () => {
    const fake = fakeDb({
      creative_lab_renders: [
        ...["b1", "b2", "b3", "b4"].map((id) => ({ id, status: "rendering", updated_at: NOW.toISOString(), caption_id: "c1", user_id: "op" })),
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
