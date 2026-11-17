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
 *     and backs off if a concurrent tick claimed another clip first;
 *   - after FACE_CHECK_MAX_ATTEMPTS tries that never finished, stores
 *     FACE_CHECK_TIMED_OUT, which is not retried.
 * The lock outlives the function (FACE_CHECK_LOCK_MS > 800 s). ensureClipFaces
 * replaces the marker with the samples or the error when the check finishes.
 *
 * No `@/` imports: node --test cannot resolve them.
 */

import {
  FACE_CHECK_LOCK_MS,
  FACE_CHECK_MAX_ATTEMPTS,
  FACE_CHECK_TIMED_OUT,
  FACE_DETECTOR,
  faceCheckLocked,
  readFaceSamples,
  type StoredFaceSamples,
} from "./caption-placement.ts";
import type { ServiceRoleDb } from "./load.ts";

type Row = Record<string, unknown>;

export type FaceCheckClaim =
  | { ok: true; attempt: number; stamp: string }
  | { ok: false; reason: "locked" | "busy" | "lost" | "timed_out" | "missing" };

function num(value: unknown, fallback: number | null): number | null {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
  if (faceCheckLocked(stored, now)) return { ok: false, reason: "locked" };
  if ((await liveLocks(db, now, lockMs, clipId)).length) return { ok: false, reason: "busy" };

  const prev = clip.face_samples_at == null ? null : String(clip.face_samples_at);
  const conditional = (payload: Row) => {
    const query = db.from("creative_lab_clips").update(payload).eq("id", clipId);
    return (prev == null ? query.is("face_samples_at", null) : query.eq("face_samples_at", prev)).select("id");
  };
  const base = {
    detector: FACE_DETECTOR,
    fps: 5 as const,
    cropFocusX: num(clip.crop_focus_x, 0.5) ?? 0.5,
    cropFocusY: num(clip.crop_focus_y, 0.5) ?? 0.5,
    inS: num(clip.in_s, null),
    outS: num(clip.out_s, null),
  };
  const stamp = now.toISOString();
  // A lapsed lock is a try that never finished (the function was killed).
  const attempt = stored?.running ? stored.running.attempt + 1 : 1;
  if (attempt > maxAttempts) {
    const body: StoredFaceSamples = { ...base, error: `${FACE_CHECK_TIMED_OUT} (${maxAttempts} tries)` };
    const res = await conditional({ face_samples: body, face_samples_at: stamp });
    if (res.error) throw new Error(`creative_lab_clips: ${res.error.message}`);
    return { ok: false, reason: "timed_out" };
  }
  const marker: StoredFaceSamples = { ...base, running: { since: stamp, until: new Date(now.getTime() + lockMs).toISOString(), attempt } };
  const res = await conditional({ face_samples: marker, face_samples_at: stamp });
  if (res.error) throw new Error(`creative_lab_clips: ${res.error.message}`);
  if (!((res.data ?? []) as unknown[]).length) return { ok: false, reason: "lost" };

  // One check at a time: a tick that claimed another clip first (or at the same instant with a lower id) wins.
  const first = (await liveLocks(db, now, lockMs, clipId))[0];
  if (first && (first.since < stamp || (first.since === stamp && first.id < clipId))) {
    const back = await db
      .from("creative_lab_clips")
      .update({ face_samples: clip.face_samples ?? null, face_samples_at: prev })
      .eq("id", clipId)
      .eq("face_samples_at", stamp);
    if (back.error) throw new Error(`creative_lab_clips: ${back.error.message}`);
    return { ok: false, reason: "busy" };
  }
  return { ok: true, attempt, stamp };
}
