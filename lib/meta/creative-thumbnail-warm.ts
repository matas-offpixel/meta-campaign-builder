import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { getOwnerFacebookToken } from "@/lib/db/report-shares";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";
import { verifyAdAccountForThumbnail } from "@/lib/meta/thumbnail-proxy-server";
import { fetchAndCacheThumbnail } from "@/lib/meta/creative-thumbnail-cache";

const MAX_WARM = 50;

/**
 * After an active-creatives snapshot is written, pre-download thumbnails into
 * Supabase Storage so the public venue report never cold-misses Meta / CDN
 * during business hours.
 */
export async function warmCreativeThumbnailsForGroups(args: {
  supabase: SupabaseClient<Database>;
  userId: string;
  adAccountId: string | null;
  groups: ConceptGroupRow[];
}): Promise<void> {
  if (!args.adAccountId) return;
  const admin = args.supabase;
  const fbToken = await getOwnerFacebookToken(args.userId, admin);
  if (!fbToken) {
    console.warn(
      "[warm-creative-thumbnails] no Facebook token; skipping warm",
    );
    return;
  }

  const ids = new Set<string>();
  for (const g of args.groups) {
    const ad =
      g.representative_thumbnail_ad_id?.trim() ||
      g.representative_ad_id?.trim() ||
      "";
    if (ad && /^[0-9]+$/.test(ad) && ad.length <= 64) ids.add(ad);
    if (ids.size >= MAX_WARM) break;
  }
  if (ids.size === 0) return;

  let allowed = 0;
  for (const adId of ids) {
    try {
      const ok = await verifyAdAccountForThumbnail(
        adId,
        fbToken,
        args.adAccountId,
      );
      if (!ok) continue;
      await fetchAndCacheThumbnail({
        admin,
        adId,
        fbToken,
      });
      allowed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[warm-creative-thumbnails] ad=${adId.slice(0, 8)} failed: ${msg}`,
      );
    }
  }
  if (allowed > 0) {
    console.log(
      `[warm-creative-thumbnails] cached ${allowed}/${ids.size} thumbnails`,
    );
  }
}
