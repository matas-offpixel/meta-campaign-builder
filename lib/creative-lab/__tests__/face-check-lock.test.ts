import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FACE_CHECK_LOCK_MS, FACE_CHECK_TIMED_OUT, faceSampleState, readFaceSamples } from "../caption-placement.ts";
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
