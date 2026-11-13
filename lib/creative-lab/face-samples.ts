import type { ServiceRoleDb } from "./load.ts";

/** Clears a clip's samples so the next tick detects this crop again. */
export async function clearFaceSamples(db: ServiceRoleDb, clipId: string, userId: string): Promise<boolean> {
  const update = await db
    .from("creative_lab_clips")
    .update({ face_samples: null, face_samples_at: null })
    .eq("id", clipId)
    .eq("user_id", userId)
    .select("id");
  if (update.error) throw new Error(`creative_lab_clips: ${update.error.message}`);
  return ((update.data ?? []) as unknown[]).length > 0;
}
