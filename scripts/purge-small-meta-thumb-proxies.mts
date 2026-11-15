// scripts/purge-small-meta-thumb-proxies.mts
//
// Deletes creative-thumbnails proxy objects saved at `{adId}.{ext}` when
// they are under 8 KB. Those are the 64px cards from the old proxy order.
// `v2/` objects and `video-thumb/` objects are left alone. Dry run by
// default. --apply deletes. Counts only; never prints object bodies.
//
// Usage:
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/purge-small-meta-thumb-proxies.mts --client <client_id> [--apply]

import { createClient } from "@supabase/supabase-js";

import {
  CREATIVE_THUMB_MIN_BYTES,
  CREATIVE_THUMBNAIL_BUCKET,
  legacyProxyObjectsUnderFloor,
  purgeLegacyProxyObjects,
} from "../lib/meta/creative-thumbnail-pure.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const clientId = arg("--client");
if (!clientId) throw new Error("Usage: --client <client_id> [--apply]");

function addAdId(into: Set<string>, value: unknown) {
  if (typeof value === "string" && /^[0-9]+$/.test(value)) into.add(value);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: events, error } = await db.from("events").select("id").eq("client_id", clientId);
  if (error) throw new Error(`events read failed: ${error.message}`);

  const adIds = new Set<string>();
  for (const event of events ?? []) {
    const { data: snaps, error: snapError } = await db
      .from("active_creatives_snapshots")
      .select("payload")
      .eq("event_id", event.id);
    if (snapError) throw new Error(`snapshot read failed: ${snapError.message}`);
    for (const snap of snaps ?? []) {
      const groups = ((snap.payload as { groups?: Array<Record<string, unknown>> } | null)?.groups ?? []);
      for (const group of groups) {
        addAdId(adIds, group.representative_thumbnail_ad_id);
        addAdId(adIds, group.representative_ad_id);
      }
    }
  }

  const objects: Array<{ name: string; size: number }> = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error: listError } = await db.storage.from(CREATIVE_THUMBNAIL_BUCKET).list("", {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (listError) throw new Error(`storage list failed: ${listError.message}`);
    const page = data ?? [];
    for (const file of page) {
      const size = Number((file.metadata as { size?: number | string } | null)?.size);
      objects.push({ name: file.name, size });
    }
    if (page.length < pageSize) break;
  }

  const names = legacyProxyObjectsUnderFloor(objects, adIds, CREATIVE_THUMB_MIN_BYTES);
  const result = await purgeLegacyProxyObjects({
    names,
    apply: APPLY,
    remove: async (paths) => {
      const { error: removeError } = await db.storage.from(CREATIVE_THUMBNAIL_BUCKET).remove(paths);
      if (removeError) throw new Error(`storage remove failed: ${removeError.message}`);
    },
  });

  console.log(APPLY ? "mode: apply" : "mode: dry run (nothing deleted)");
  console.log(`client ads: ${adIds.size}`);
  console.log(`proxy objects under ${CREATIVE_THUMB_MIN_BYTES} bytes: ${result.matched}`);
  console.log(`deleted: ${result.deleted}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
