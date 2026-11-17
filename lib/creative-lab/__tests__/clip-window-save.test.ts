import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { draftsToRequeue, parseWindowRequest, saveClipWindow } from "../clip-window-save.ts";
import type { ServiceRoleDb } from "../load.ts";

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let patch: Row | null = null;
    const q = {
      select: () => q,
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return q;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return q;
      },
      update(p: Row) {
        patch = p;
        return q;
      },
      maybeSingle: async () => ({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      then(resolve: (v: { data: Row[] | null; error: null }) => unknown) {
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (patch) for (const row of rows) Object.assign(row, patch);
        return Promise.resolve(resolve({ data: patch ? null : rows, error: null }));
      },
    };
    return q;
  };
  return { from } as unknown as ServiceRoleDb;
}

const DROPS = { v: 1, status: "ok", assetId: "a", durationS: 42, hasSound: true, lufs: -12, candidates: [{ tS: 16.4, riseDb: 11 }, { tS: 31.2, riseDb: 8 }], mainS: 16.4, peaks: [] };

function tables() {
  return {
    creative_lab_clips: [
      { id: "c1", user_id: "u", drops: DROPS, in_s: 12.4, out_s: 28.4, window_drop_s: null, window_by_hand: false, triple_fit_source_id: null },
      { id: "made", user_id: "u", drops: null, in_s: 12.4, out_s: 28.4, triple_fit_source_id: "c1" },
    ] as Row[],
    creative_lab_renders: [
      { id: "draft", clip_id: "c1", status: "done", kind: "video", error: null },
      { id: "failed-draft", clip_id: "c1", status: "failed", kind: "video", error: "x" },
      { id: "approved", clip_id: "c1", status: "done", kind: "video", error: null },
      { id: "running", clip_id: "c1", status: "rendering", kind: "video", error: null },
      { id: "still", clip_id: "c1", status: "done", kind: "static", error: null },
    ] as Row[],
    creative_lab_round_ads: [{ id: "ad", render_id: "approved" }] as Row[],
  };
}

describe("VW4 · saving the nudge", () => {
  it("reads only VW4's three requests", () => {
    assert.deepEqual(parseWindowRequest({ action: "reset" }), { action: "reset" });
    assert.deepEqual(parseWindowRequest({ action: "useDrop", dropS: 31.2 }), { action: "useDrop", dropS: 31.2 });
    assert.deepEqual(parseWindowRequest({ action: "nudge", dropS: 16.4, dropInS: 3.5, lengthS: 18 }), { action: "nudge", dropS: 16.4, dropInS: 3.5, lengthS: 18 });
    assert.equal(parseWindowRequest({ action: "nudge", dropS: 16.4 }), null);
    assert.equal(parseWindowRequest({ action: "mark", tS: 9 }), null);
    assert.equal(parseWindowRequest(null), null);
  });

  it("re-queues video drafts only: a render on a round, a running one and a static stay", () => {
    assert.deepEqual(draftsToRequeue(tables().creative_lab_renders, new Set(["approved"])), ["draft", "failed-draft"]);
  });

  it("writes the window, moves the made triple-fit with it, and re-queues the drafts", async () => {
    const t = tables();
    const out = await saveClipWindow(fakeDb(t), { clipId: "c1", userId: "u", request: { action: "nudge", dropS: 16.4, dropInS: 3.5, lengthS: 18 } });
    assert.deepEqual(out, { queued: 2, inS: 12.9, outS: 30.9 });
    assert.deepEqual([t.creative_lab_clips[0]!.in_s, t.creative_lab_clips[0]!.out_s, t.creative_lab_clips[0]!.window_by_hand], [12.9, 30.9, true]);
    assert.deepEqual([t.creative_lab_clips[1]!.in_s, t.creative_lab_clips[1]!.out_s], [12.9, 30.9]);
    assert.deepEqual(t.creative_lab_renders.map((r) => r.status), ["queued", "queued", "done", "rendering", "done"]);
  });

  it("the picker on a made triple-fit changes its source", async () => {
    const t = tables();
    await saveClipWindow(fakeDb(t), { clipId: "made", userId: "u", request: { action: "useDrop", dropS: 31.2 } });
    assert.deepEqual([t.creative_lab_clips[0]!.window_drop_s, t.creative_lab_clips[0]!.in_s], [31.2, 27]);
  });

  it("refuses a drop the sound doesn't show, and another user's clip", async () => {
    await assert.rejects(saveClipWindow(fakeDb(tables()), { clipId: "c1", userId: "u", request: { action: "useDrop", dropS: 20 } }), /isn't one this clip's sound shows/);
    await assert.rejects(saveClipWindow(fakeDb(tables()), { clipId: "c1", userId: "someone", request: { action: "reset" } }), /No clip with that id/);
  });
});
