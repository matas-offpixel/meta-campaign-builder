/**
 * Thumbnails for promoter Instagram candidates listed before the find
 * path stored a picture. Puzzle's eight rows are the ones with client_id
 * set and thumbnail_path empty.
 *
 * Dry run by default: reads that client's own posts and prints each media
 * id and the path it would get. --apply uploads the JPEG to
 * creative-thumbnails and sets thumbnail_path on those rows only.
 * An artist candidate, a row that already has a path, and every other
 * client are left as they are.
 *
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/backfill-promoter-thumbs.mts --handle puzzleofficialuk
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/backfill-promoter-thumbs.mts --handle puzzleofficialuk --apply
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and the
 * operator's Facebook token (user_facebook_tokens, else META_ACCESS_TOKEN).
 * Never prints tokens or thumbnail URLs.
 */

import { createClient } from "@supabase/supabase-js";

import { fillMissingPromoterThumbs } from "../lib/creative-lab/ig-discovery.ts";
import type { ServiceRoleDb } from "../lib/creative-lab/load.ts";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const handle = arg("--handle")?.trim().replace(/^@/, "");
const apply = process.argv.includes("--apply");
if (!handle) throw new Error("Usage: --handle <instagram> [--apply]");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const clients = await db.from("clients").select("id, user_id, instagram_handle").in("instagram_handle", [handle, `@${handle}`]);
  if (clients.error) throw new Error(clients.error.message);
  const matches = (clients.data ?? []).filter((row) => String(row.instagram_handle ?? "").replace(/^@/, "").toLowerCase() === handle.toLowerCase());
  if (matches.length !== 1) throw new Error(`${matches.length} clients match @${handle}.`);
  const client = matches[0]!;
  const userId = String(client.user_id ?? "");
  if (!userId) throw new Error("That client has no user.");
  const result = await fillMissingPromoterThumbs(db as unknown as ServiceRoleDb, {
    clientId: String(client.id),
    userId,
    apply,
  });
  console.log(`@${handle} ${apply ? "apply" : "dry-run"}: ${result.filled.length} thumbnail path${result.filled.length === 1 ? "" : "s"}`);
  for (const row of result.filled) console.log(`${row.igMediaId} ${row.path}`);
  if (result.skipped.length > 0) console.log(`no picture in this read: ${result.skipped.join(", ")}`);
}

await main();
