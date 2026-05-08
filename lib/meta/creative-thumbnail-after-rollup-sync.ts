import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { warmCreativeThumbnailsForGroups } from "@/lib/meta/creative-thumbnail-warm";
import { synthesizeShareForRunner } from "@/lib/reporting/active-creatives-refresh-runner";

/**
 * After a successful rollup-sync, re-fetch active creatives for the event and
 * warm Supabase Storage thumbnail objects — same idea as the active-creatives
 * cron, but on demand so operators see images within seconds of Sync now.
 *
 * Non-blocking: callers should invoke from `after()` or `void` — can take many
 * seconds when Meta is cold.
 */
export async function warmCreativeThumbnailsAfterRollupSync(args: {
  admin: SupabaseClient<Database>;
  eventId: string;
  userId: string;
  eventCode: string | null;
  adAccountId: string | null;
}): Promise<number> {
  if (!args.adAccountId || !args.eventCode?.trim()) return 0;

  const { fetchShareActiveCreatives } = await import(
    "@/lib/reporting/share-active-creatives"
  );

  const result = await fetchShareActiveCreatives({
    share: synthesizeShareForRunner(args.eventId, args.userId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    admin: args.admin as any,
    eventCode: args.eventCode,
    adAccountId: args.adAccountId,
    datePreset: "maximum",
    enrichVideoThumbnails: true,
  });

  if (result.kind !== "ok" || result.groups.length === 0) return 0;

  return warmCreativeThumbnailsForGroups({
    supabase: args.admin,
    userId: args.userId,
    adAccountId: args.adAccountId,
    groups: result.groups,
  });
}
