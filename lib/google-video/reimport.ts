/**
 * lib/google-video/reimport.ts
 *
 * A second import of the same workbook onto the same event is a 409,
 * not a silent extra plan. Match is the stored source filename.
 * `google_video_plans` has no content hash, so a renamed file is not
 * detected. `import_as_new` skips this check.
 */

export interface VideoPlanIdentity {
  id: string;
  name: string;
  event_id: string | null;
  source_filename: string | null;
}

export function findVideoReimport(
  plans: readonly VideoPlanIdentity[],
  eventId: string | null,
  sourceFilename: string | null,
): { id: string; name: string } | null {
  const file = sourceFilename?.trim() ?? "";
  if (!eventId || !file) return null;
  const hit = plans.find((plan) => plan.event_id === eventId && (plan.source_filename?.trim() ?? "") === file);
  return hit ? { id: hit.id, name: hit.name } : null;
}
