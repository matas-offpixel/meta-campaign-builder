/**
 * Put Puzzle's refused Instagram candidate back to candidate, so Add can
 * run again. One media id. Dry run by default: prints the row and writes
 * nothing. --apply sets status to candidate and clears the reason.
 *
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/reset-puzzle-candidate.mts
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/reset-puzzle-candidate.mts --apply
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Never prints tokens or file URLs.
 */

import { createClient } from "@supabase/supabase-js";

const MEDIA_ID = "17965611758980656";
const apply = process.argv.includes("--apply");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const found = await db
    .from("creative_lab_ig_candidates")
    .select("id, status, reason, client_id, artist_id, asset_id")
    .eq("ig_media_id", MEDIA_ID);
  if (found.error) throw new Error(found.error.message);
  const rows = found.data ?? [];
  console.log(`${MEDIA_ID}: ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  for (const row of rows) {
    const owner = row.client_id ? "client" : row.artist_id ? "artist" : "none";
    console.log(`${row.id} status=${row.status} owner=${owner} asset=${row.asset_id ? "yes" : "no"} reason=${row.reason ?? ""}`);
  }
  const skipped = rows.filter((row) => row.status === "skipped");
  console.log(`${apply ? "apply" : "dry-run"}: ${skipped.length} skipped row${skipped.length === 1 ? "" : "s"} set back to candidate`);
  if (!apply || skipped.length === 0) return;
  const updated = await db
    .from("creative_lab_ig_candidates")
    .update({ status: "candidate", reason: null })
    .eq("ig_media_id", MEDIA_ID)
    .eq("status", "skipped")
    .select("id");
  if (updated.error) throw new Error(updated.error.message);
  console.log(`updated ${updated.data?.length ?? 0}`);
}

await main();
