/**
 * lib/google-video/delete-plan.ts
 *
 * A draft or exported YouTube plan can be removed from the database.
 * Live plans stay. The delete never calls Google Ads.
 */

import type { GoogleVideoPlanStatus } from "./types.ts";

export function videoPlanDeletable(status: GoogleVideoPlanStatus): boolean {
  return status === "draft" || status === "exported";
}
