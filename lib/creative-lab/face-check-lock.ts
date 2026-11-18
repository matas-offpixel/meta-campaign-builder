/**
 * The render tick's lock on face checks (17 Nov 2026: in production every
 * tick restarted the check on the same clip, each run hit Vercel's 800 s
 * limit, and the cron started another every minute, about 13 at once).
 *
 * The lock is the `running` marker in creative_lab_clips.face_samples, so no
 * migration is needed. The tick claims a clip with a conditional update (the
 * row's face_samples_at must still be the value it read, so two ticks can't
 * both claim it) and:
 *   - never starts a check on a clip whose lock hasn't lapsed;
 *   - never starts one while any clip holds a live lock (one check at a time),
 *     and backs off after claiming if any other clip holds one;
 *   - after FACE_CHECK_MAX_ATTEMPTS tries in a row with no progress, stores
 *     FACE_CHECK_TIMED_OUT, which is not retried.
 * The lock outlives the function (FACE_CHECK_LOCK_MS > 800 s). A check runs in
 * slices (face-check-slice.ts): a slice that stops with frames left parks the
 * check (parkFaceCheck: progress saved, lock renewed, `parked`), and the next
 * tick's claim resumes it from there, never from zero. Only a parked lock can
 * be claimed before it lapses; while a slice runs, the clip reads `locked`.
 * finishFaceCheck replaces the marker with the samples or the error. Both
 * writes land only if the row is still the claim's (face_samples_at).
 *
 * No `@/` imports: node --test cannot resolve them.
 */

import {
  FACE_CHECK_LOCK_MS,
  FACE_CHECK_MAX_ATTEMPTS,
  FACE_CHECK_TIMED_OUT,
  FACE_DETECTOR,
  FACE_SAMPLE_FPS,
  faceCheckLocked,
  readFaceSamples,
  type FaceCheckProgress,
  type StoredFaceSamples,
} from "./caption-placement.ts";
import { readProgress } from "./face-check-slice.ts";
import type { ServiceRoleDb } from "./load.ts";

type Row = Record<string, unknown>;

export type FaceCheckClaim =
  | { ok: true; attempt: number; stamp: string; progress: FaceCheckProgress | null }
  | { ok: false; reason: "locked" | "busy" | "lost" | "timed_out" | "missing" };

function num(value: unknown, fallback: number | null): number | null {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sameTime(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.05;
}

/** The stored row is for this crop and window. */
function sameWindow(stored: StoredFaceSamples, base: { cropFocusX: number; cropFocusY: number; inS: number | null; outS: number | null }): boolean {
  return Math.abs(stored.cropFocusX - base.cropFocusX) < 1e-4
    && Math.abs(stored.cropFocusY - base.cropFocusY) < 1e-4
    && sameTime(stored.inS, base.inS)
    && sameTime(stored.outS, base.outS);
}

/** Clips holding a live lock (other than `exceptId`), oldest claim first. */
async function liveLocks(db: ServiceRoleDb, now: Date, lockMs: number, exceptId: string): Promise<{ id: string; since: string }[]> {
  const cutoff = new Date(now.getTime() - lockMs).toISOString();
  const res = await db.from("creative_lab_clips").select("id, face_samples").gte("face_samples_at", cutoff);
  if (res.error) throw new Error(`creative_lab_clips: ${res.error.message}`);
  return ((res.data ?? []) as Row[])
    .filter((row) => String(row.id) !== exceptId)
    .flatMap((row) => {
      const stored = readFaceSamples(row.face_samples);
      return stored?.running && faceCheckLocked(stored, now) ? [{ id: String(row.id), since: stored.running.since }] : [];
    })
    .sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
}

/** Take the lock on one clip's face check, or say why not. */
export async function claimFaceCheck(
  db: ServiceRoleDb,
  clipId: string,
  now: Date,
  opts: { lockMs?: number; maxAttempts?: number } = {},
): Promise<FaceCheckClaim> {
  const lockMs = opts.lockMs ?? FACE_CHECK_LOCK_MS;
  const maxAttempts = opts.maxAttempts ?? FACE_CHECK_MAX_ATTEMPTS;
  const clipRes = await db.from("creative_lab_clips").select("*").eq("id", clipId).maybeSingle();
  if (clipRes.error) throw new Error(`creative_lab_clips: ${clipRes.error.message}`);
  const clip = clipRes.data as Row | null;
  if (!clip) return { ok: false, reason: "missing" };
  const stored: StoredFaceSamples | null = readFaceSamples(clip.face_samples);
  // A parked check is resumed by the next tick; a slice still running is not touched.
  if (faceCheckLocked(stored, now) && !stored?.running?.parked) return { ok: false, reason: "locked" };
  if ((await liveLocks(db, now, lockMs, clipId)).length) return { ok: false, reason: "busy" };

  const prev = clip.face_samples_at == null ? null : String(clip.face_samples_at);
  // What a back-off puts back: a copy taken now, before this claim writes over the row.
  const prevSamples = clip.face_samples == null ? null : structuredClone(clip.face_samples);
  const conditional = (payload: Row) => {
    const query = db.from("creative_lab_clips").update(payload).eq("id", clipId);
    return (prev == null ? query.is("face_samples_at", null) : query.eq("face_samples_at", prev)).select("id");
  };
  const base = {
    detector: FACE_DETECTOR,
    fps: FACE_SAMPLE_FPS,
    cropFocusX: num(clip.crop_focus_x, 0.5) ?? 0.5,
    cropFocusY: num(clip.crop_focus_y, 0.5) ?? 0.5,
    inS: num(clip.in_s, null),
    outS: num(clip.out_s, null),
  };
  const stamp = now.toISOString();
  // The marker's attempt is the tries since the check last made progress: a lapsed unparked lock is a slice
  // that was killed, a parked one with attempt > 0 a slice that checked nothing. Both, and the progress, carry
  // only for the same crop, window, detector and rate: a changed crop starts again at attempt 1 with no progress.
  const carry = Boolean(stored?.running && sameWindow(stored, base) && stored.detector === FACE_DETECTOR && stored.fps === FACE_SAMPLE_FPS);
  const attempt = carry ? stored!.running!.attempt + 1 : 1;
  const progress = carry ? readProgress(stored!.running!.progress) : null;
  if (attempt > maxAttempts) {
    const so = progress ? `, ${progress.done} of ${progress.frames.length} frames` : "";
    const body: StoredFaceSamples = { ...base, error: `${FACE_CHECK_TIMED_OUT} (${maxAttempts} tries without progress${so})` };
    const res = await conditional({ face_samples: body, face_samples_at: stamp });
    if (res.error) throw new Error(`creative_lab_clips: ${res.error.message}`);
    // The row changed since it was read (an operator's Retry, another tick): not ours to fail.
    if (!((res.data ?? []) as unknown[]).length) return { ok: false, reason: "lost" };
    return { ok: false, reason: "timed_out" };
  }
  const since = carry ? stored!.running!.since : stamp;
  const marker: StoredFaceSamples = {
    ...base,
    running: { since, until: new Date(now.getTime() + lockMs).toISOString(), attempt, ...(progress ? { progress } : {}) },
  };
  const res = await conditional({ face_samples: marker, face_samples_at: stamp });
  if (res.error) throw new Error(`creative_lab_clips: ${res.error.message}`);
  if (!((res.data ?? []) as unknown[]).length) return { ok: false, reason: "lost" };

  // One check at a time: back off if any other clip holds a live lock, whoever claimed first. Of two claims that
  // overlap, the later commit always sees the earlier one, so at most one goes ahead (both may back off; the
  // next tick then goes).
  if ((await liveLocks(db, now, lockMs, clipId)).length) {
    const back = await db
      .from("creative_lab_clips")
      .update({ face_samples: prevSamples, face_samples_at: prev })
      .eq("id", clipId)
      .eq("face_samples_at", stamp);
    if (back.error) throw new Error(`creative_lab_clips: ${back.error.message}`);
    return { ok: false, reason: "busy" };
  }
  return { ok: true, attempt, stamp, progress };
}

type Base = Pick<StoredFaceSamples, "detector" | "fps" | "cropFocusX" | "cropFocusY" | "inS" | "outS">;

/** Write `payload` only if the row is still the one claimed at `stamp`. False when it isn't (nothing written). */
async function ifStillClaimed(db: ServiceRoleDb, clipId: string, stamp: string, payload: Row): Promise<boolean> {
  const res = await db.from("creative_lab_clips").update(payload).eq("id", clipId).eq("face_samples_at", stamp).select("id");
  if (res.error) throw new Error(`creative_lab_clips: ${res.error.message}`);
  return ((res.data ?? []) as unknown[]).length > 0;
}

/**
 * Save a slice's progress and keep the lock for the next tick: parked, renewed for FACE_CHECK_LOCK_MS. A
 * slice that made progress resets the tries; one that checked nothing keeps its try counted.
 */
export async function parkFaceCheck(
  db: ServiceRoleDb,
  clipId: string,
  claim: { stamp: string; attempt: number; since: string },
  base: Base,
  progress: FaceCheckProgress,
  madeProgress: boolean,
  now: Date,
  opts: { lockMs?: number } = {},
): Promise<boolean> {
  const lockMs = opts.lockMs ?? FACE_CHECK_LOCK_MS;
  const marker: StoredFaceSamples = {
    ...base,
    running: {
      since: claim.since,
      until: new Date(now.getTime() + lockMs).toISOString(),
      attempt: madeProgress ? 0 : claim.attempt,
      parked: true,
      progress,
    },
  };
  return ifStillClaimed(db, clipId, claim.stamp, { face_samples: marker, face_samples_at: now.toISOString() });
}

/** Replace the claim's marker with the finished samples or the error. */
export async function finishFaceCheck(
  db: ServiceRoleDb,
  clipId: string,
  claim: { stamp: string },
  body: StoredFaceSamples,
  now: Date,
): Promise<boolean> {
  return ifStillClaimed(db, clipId, claim.stamp, { face_samples: body, face_samples_at: now.toISOString() });
}
