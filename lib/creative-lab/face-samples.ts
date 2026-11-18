import { faceCheckLocked, readFaceSamples } from "./caption-placement.ts";
import type { ServiceRoleDb } from "./load.ts";

/**
 * Clears a clip's samples so the next tick detects this crop again. A clip
 * whose face check is running (a live lock, face-check-lock.ts) is left
 * alone, and the clear only lands if the row is still the one read, so a
 * Retry clicked on a stale page never wipes a check another tick started.
 * "running" means a check is under way, which is what Retry asks for.
 */
export async function clearFaceSamples(
  db: ServiceRoleDb,
  clipId: string,
  userId: string,
  now: Date = new Date(),
): Promise<"cleared" | "running" | "missing"> {
  const read = await db.from("creative_lab_clips").select("face_samples, face_samples_at").eq("id", clipId).eq("user_id", userId).maybeSingle();
  if (read.error) throw new Error(`creative_lab_clips: ${read.error.message}`);
  const row = read.data as { face_samples?: unknown; face_samples_at?: string | null } | null;
  if (!row) return "missing";
  // A check is already running: the Retry is already happening.
  if (faceCheckLocked(readFaceSamples(row.face_samples), now)) return "running";
  const query = db
    .from("creative_lab_clips")
    .update({ face_samples: null, face_samples_at: null })
    .eq("id", clipId)
    .eq("user_id", userId);
  const update = await (row.face_samples_at == null ? query.is("face_samples_at", null) : query.eq("face_samples_at", row.face_samples_at)).select("id");
  if (update.error) throw new Error(`creative_lab_clips: ${update.error.message}`);
  // The row changed after it was read: a tick claimed it, so a check is starting.
  return ((update.data ?? []) as unknown[]).length > 0 ? "cleared" : "running";
}
