import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FACE_CHECK_BUDGET_MS, FACE_CHECK_LOCK_MS, FACE_CHECK_TIMED_OUT, FACE_SAMPLE_FPS, faceSampleState, readFaceSamples } from "../caption-placement.ts";
import { judgeFaceOverTime } from "../t1-face.ts";
import { claimFaceCheck } from "../face-check-lock.ts";
import type { ServiceRoleDb } from "../load.ts";
import { fakeDb } from "./fake-db.ts";

const NOW = new Date("2026-11-17T14:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const clip = (id: string, extra: Record<string, unknown> = {}) => ({ id, crop_focus_x: 0.5, crop_focus_y: 0.5, in_s: 0, out_s: 30, face_samples: null, face_samples_at: null, ...extra });
const window = { cropFocusX: 0.5, cropFocusY: 0.5, inS: 0, outS: 30 };

describe("face check lock (render tick)", () => {
  it("claims a clip with no samples: a running marker, attempt 1, still reading 'checking'", async () => {
    const db = fakeDb({ creative_lab_clips: [clip("c1")] });
    const claim = await claimFaceCheck(db as unknown as ServiceRoleDb, "c1", NOW);
    assert.deepEqual(claim, { ok: true, attempt: 1, stamp: NOW.toISOString() });
    const stored = readFaceSamples(db.tables.creative_lab_clips[0]!.face_samples);
    assert.equal(stored?.running?.attempt, 1);
    assert.equal(stored?.running?.until, at(FACE_CHECK_LOCK_MS).toISOString());
    assert.equal(faceSampleState(stored, window), "checking");
  });

  it("never starts a second check on a clip whose check is still running (the 17 Nov loop)", async () => {
    const db = fakeDb({ creative_lab_clips: [clip("c1")] });
    await claimFaceCheck(db as unknown as ServiceRoleDb, "c1", NOW);
    for (const minute of [1, 5, 13]) {
      const again = await claimFaceCheck(db as unknown as ServiceRoleDb, "c1", at(minute * 60_000));
      assert.deepEqual(again, { ok: false, reason: "locked" });
    }
    assert.equal(db.writes.filter((w) => w.op === "update").length, 1);
  });

  it("runs one check at a time: another clip waits while a lock is live", async () => {
    const db = fakeDb({ creative_lab_clips: [clip("c1"), clip("c2")] });
    assert.equal((await claimFaceCheck(db as unknown as ServiceRoleDb, "c1", NOW)).ok, true);
    assert.deepEqual(await claimFaceCheck(db as unknown as ServiceRoleDb, "c2", at(60_000)), { ok: false, reason: "busy" });
    assert.equal(db.tables.creative_lab_clips[1]!.face_samples, null);
  });

  it("tries a lapsed lock once more, then fails the clip for good", async () => {
    const db = fakeDb({ creative_lab_clips: [clip("c1")] });
    await claimFaceCheck(db as unknown as ServiceRoleDb, "c1", NOW);
    const second = await claimFaceCheck(db as unknown as ServiceRoleDb, "c1", at(FACE_CHECK_LOCK_MS + 1));
    assert.equal(second.ok && second.attempt, 2);
    const third = await claimFaceCheck(db as unknown as ServiceRoleDb, "c1", at(2 * FACE_CHECK_LOCK_MS + 2));
    assert.deepEqual(third, { ok: false, reason: "timed_out" });
    const stored = readFaceSamples(db.tables.creative_lab_clips[0]!.face_samples);
    assert.match(stored?.error ?? "", new RegExp(FACE_CHECK_TIMED_OUT));
    assert.equal(stored?.running, undefined);
    assert.equal(faceSampleState(stored, window), "failed");
    // A failed clip is never claimed again by the tick (faceSampleState is not "checking").
  });

  it("lets another clip go once the first lock has lapsed", async () => {
    const db = fakeDb({ creative_lab_clips: [clip("c1"), clip("c2")] });
    await claimFaceCheck(db as unknown as ServiceRoleDb, "c1", NOW);
    const later = await claimFaceCheck(db as unknown as ServiceRoleDb, "c2", at(FACE_CHECK_LOCK_MS + 1));
    assert.equal(later.ok, true);
  });
});

describe("face samples at FACE_SAMPLE_FPS (speed fix)", () => {
  const meta = { detector: "ssd_mobilenet_v1", cropFocusX: 0.5, cropFocusY: 0.5, inS: 0, outS: 30 };
  // A 400 px face right under a 1080-wide type box: it touches the box.
  const box = { left: 0, top: 300, width: 1080, height: 200 };
  const face = { left: 340, top: 250, width: 400, height: 400 };
  const samples = (hits: boolean[], fps: number) => hits.map((hit, i) => ({ tS: i / fps, faces: hit ? [face] : [] }));

  it("reads the old 5 fps rows and the new rows (FACE_SAMPLE_FPS), and refuses nonsense", () => {
    assert.equal(readFaceSamples({ ...meta, fps: 5, samples: [] })?.fps, 5);
    assert.equal(readFaceSamples({ ...meta, fps: FACE_SAMPLE_FPS, samples: [] })?.fps, FACE_SAMPLE_FPS);
    assert.equal(readFaceSamples({ ...meta, fps: 0 }), null);
    assert.equal(readFaceSamples({ ...meta, fps: 7 }), null);
  });

  it("judges runs in seconds at the stored rate: a lone 2 fps hit is 0.5 s and passes, two in a row fail", () => {
    const quiet = Array.from({ length: 20 }, () => false);
    const lone = [...quiet]; lone[5] = true;
    const pair = [...quiet]; pair[5] = true; pair[6] = true;
    assert.equal(judgeFaceOverTime(samples(lone, 2), { always: [box], claim: null }, { fps: 2 }).longestRunS, 0.5);
    assert.equal(judgeFaceOverTime(samples(lone, 2), { always: [box], claim: null }, { fps: 2 }).ok, true);
    assert.equal(judgeFaceOverTime(samples(pair, 2), { always: [box], claim: null }, { fps: 2 }).ok, false);
  });

  it("a check that ran past its budget fails the clip and is never tried again", () => {
    const stored = readFaceSamples({ ...meta, fps: FACE_SAMPLE_FPS, error: `${FACE_CHECK_TIMED_OUT} (31 of 60 frames in 600 s)` });
    assert.equal(faceSampleState(stored, window), "failed");
    assert.ok(FACE_CHECK_BUDGET_MS < 800_000 && FACE_CHECK_LOCK_MS > 800_000);
  });
});

/** Holds one clip's claim write (the marker update) until `release()`: a tick that is slow between its pre-check and its claim. */
function gated(fake: ReturnType<typeof fakeDb>, holdId: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const db = {
    from(table: string) {
      const target = fake.from(table) as Record<string, (...a: unknown[]) => unknown>;
      let marker = false;
      let id: unknown = null;
      const proxy: Record<string, unknown> = new Proxy(target, {
        get(t, prop) {
          if (prop === "update") return (payload: Record<string, unknown>) => {
            marker = Boolean((payload.face_samples as { running?: unknown } | null)?.running);
            t.update!(payload);
            return proxy;
          };
          if (prop === "eq") return (column: string, value: unknown) => {
            if (column === "id") id = value;
            t.eq!(column, value);
            return proxy;
          };
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              (marker && id === holdId ? gate : Promise.resolve()).then(() => (t.then as (r: unknown, j: unknown) => unknown)(resolve, reject));
          }
          const value = t[prop as string];
          return typeof value === "function" ? (...args: unknown[]) => {
            const out = value.apply(t, args);
            return out === t ? proxy : out;
          } : value;
        },
      });
      return proxy;
    },
  };
  return { db: db as unknown as ServiceRoleDb, release };
}

describe("face check lock under concurrent ticks (review of #1309)", () => {
  it("two ticks claiming one clip at once: one goes, the other is told it lost", async () => {
    const fake = fakeDb({ creative_lab_clips: [clip("c1")] });
    const [a, b] = await Promise.all([
      claimFaceCheck(fake as unknown as ServiceRoleDb, "c1", NOW),
      claimFaceCheck(fake as unknown as ServiceRoleDb, "c1", NOW),
    ]);
    assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
    const loser = a.ok ? b : a;
    assert.equal(loser.ok ? null : loser.reason, "lost");
  });

  it("interleaved ticks on two clips: the slow tick that started first backs off, so only one check runs", async () => {
    const fake = fakeDb({ creative_lab_clips: [clip("c1"), clip("c2")] });
    const { db, release } = gated(fake, "c2");
    const slowB = claimFaceCheck(db, "c2", NOW); // passes its pre-check, then waits at its claim write
    await new Promise((resolve) => setTimeout(resolve, 0));
    const a = await claimFaceCheck(fake as unknown as ServiceRoleDb, "c1", at(1_000));
    assert.equal(a.ok, true);
    release();
    const b = await slowB;
    assert.deepEqual(b, { ok: false, reason: "busy" });
    // B put its row back as it found it.
    assert.equal(fake.tables.creative_lab_clips[1]!.face_samples, null);
    assert.equal(fake.tables.creative_lab_clips[1]!.face_samples_at, null);
  });

  it("the final 'didn't finish in time' write reports lost when the row changed under it", async () => {
    const fake = fakeDb({ creative_lab_clips: [clip("c1")] });
    await claimFaceCheck(fake as unknown as ServiceRoleDb, "c1", NOW);
    await claimFaceCheck(fake as unknown as ServiceRoleDb, "c1", at(FACE_CHECK_LOCK_MS + 1));
    // Someone changes the row between the claim's read and its write.
    const original = (table: string) => fake.from(table);
    let reads = 0;
    const racing = {
      from(table: string) {
        const b = original(table) as { maybeSingle?: () => Promise<unknown> };
        if (table === "creative_lab_clips" && reads++ === 0) {
          const ms = (b as { maybeSingle: () => Promise<unknown> }).maybeSingle.bind(b);
          (b as { maybeSingle: () => Promise<unknown> }).maybeSingle = async () => {
            // Like Supabase, the read is a copy; then the stored row changes (an operator's Retry).
            const out = structuredClone(await ms());
            fake.tables.creative_lab_clips[0]!.face_samples_at = "2026-11-17T15:00:00.000Z";
            return out;
          };
        }
        return b;
      },
    };
    const third = await claimFaceCheck(racing as unknown as ServiceRoleDb, "c1", at(2 * FACE_CHECK_LOCK_MS + 2));
    assert.deepEqual(third, { ok: false, reason: "lost" });
  });

  it("a changed crop starts again at attempt 1, not 2", async () => {
    const fake = fakeDb({ creative_lab_clips: [clip("c1")] });
    await claimFaceCheck(fake as unknown as ServiceRoleDb, "c1", NOW);
    fake.tables.creative_lab_clips[0]!.crop_focus_x = 0.3;
    const next = await claimFaceCheck(fake as unknown as ServiceRoleDb, "c1", at(FACE_CHECK_LOCK_MS + 1));
    assert.equal(next.ok && next.attempt, 1);
  });

  it("Retry never wipes a running check", async () => {
    const { clearFaceSamples } = await import("../face-samples.ts");
    const fake = fakeDb({ creative_lab_clips: [{ ...clip("c1"), user_id: "op" }] });
    await claimFaceCheck(fake as unknown as ServiceRoleDb, "c1", NOW);
    assert.equal(await clearFaceSamples(fake as unknown as ServiceRoleDb, "c1", "op", at(60_000)), "running");
    assert.ok(readFaceSamples(fake.tables.creative_lab_clips[0]!.face_samples)?.running);
    // Once the lock has lapsed, Retry clears it.
    assert.equal(await clearFaceSamples(fake as unknown as ServiceRoleDb, "c1", "op", at(FACE_CHECK_LOCK_MS + 1)), "cleared");
    assert.equal(fake.tables.creative_lab_clips[0]!.face_samples, null);
  });

  it("two render ticks at once through the real wiring run the face check once", async () => {
    const { runRenderTick } = await import("../render-queue.ts");
    const fake = fakeDb({
      creative_lab_clips: [clip("c1")],
      creative_lab_renders: [{ id: "r1", status: "queued", created_at: "2026-11-17", caption_id: "cap", clip_id: "c1", user_id: "op" }],
      creative_lab_captions: [{ id: "cap", event_id: "evt" }],
      creative_lab_round_ads: [],
      creative_lab_rounds: [],
    });
    let calls = 0;
    let finish!: () => void;
    const slow = new Promise<void>((resolve) => (finish = resolve));
    const detect = async () => {
      calls += 1;
      await slow;
      return "failed" as const;
    };
    const opts = { now: NOW, archivedEventIds: new Set<string>(), render: async () => {}, detect };
    const first = runRenderTick(fake as unknown as ServiceRoleDb, opts);
    const second = runRenderTick(fake as unknown as ServiceRoleDb, { ...opts, now: at(60_000) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    finish();
    await Promise.all([first, second]);
    assert.equal(calls, 1);
  });
});

describe("a tick that ran a face check starts no renders (review of #1311)", () => {
  it("leaves the queue for the next tick", async () => {
    const { runRenderTick } = await import("../render-queue.ts");
    const fake = fakeDb({
      creative_lab_clips: [clip("c1"), clip("c2", { face_samples: { detector: "ssd_mobilenet_v1", fps: 5, cropFocusX: 0.5, cropFocusY: 0.5, inS: 0, outS: 30, samples: [{ t: 0, faces: [] }] }, face_samples_at: "2026-11-17T10:00:00.000Z" })],
      creative_lab_renders: [
        { id: "r1", status: "queued", created_at: "2026-11-17T01", caption_id: "cap", clip_id: "c1", user_id: "op" },
        { id: "r2", status: "queued", created_at: "2026-11-17T02", caption_id: "cap", clip_id: "c2", user_id: "op" },
      ],
      creative_lab_captions: [{ id: "cap", event_id: "evt" }],
      creative_lab_round_ads: [],
      creative_lab_rounds: [],
    });
    const rendered: string[] = [];
    const result = await runRenderTick(fake as unknown as ServiceRoleDb, { now: NOW, archivedEventIds: new Set(), render: async (id: string) => void rendered.push(id), detect: async () => "ready" as const });
    assert.equal(result.claimed, 0);
    assert.equal(rendered.length, 0);
    // The next tick, with no check to run, renders.
    const next = await runRenderTick(fake as unknown as ServiceRoleDb, { now: at(60_000), archivedEventIds: new Set(), render: async (id: string) => void rendered.push(id), detect: async () => "ready" as const });
    assert.ok(next.claimed >= 1);
  });
});
