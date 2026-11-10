/**
 * Render copies for Puzzle 4th Birthday's 4K clips, Luke 4 and Luke 5.
 * The original stays the master. A copy is made only when the narrowest
 * crop window is wider than 1080, at the same size the import uses
 * (Lanczos, CRF 16). A clip that already has one is left as it is.
 *
 * Dry run by default: reads each file's header and prints the planned size.
 * --apply downloads, encodes and stores the copy.
 *
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/backfill-render-copies.mts
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/backfill-render-copies.mts --apply
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Never prints tokens or file URLs.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { probeMp4Url } from "../lib/creative-lab/mp4-probe.ts";
import { attachRenderProxy, renderProxySize } from "../lib/creative-lab/render-proxy.ts";
import type { ServiceRoleDb } from "../lib/creative-lab/load.ts";

const apply = process.argv.includes("--apply");

type Row = Record<string, unknown>;

function text(row: Row | null, key: string): string {
  return String(row?.[key] ?? "").trim();
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const events = await db.from("events").select("id, name, client_id").ilike("name", "Puzzle 4th Birthday");
  if (events.error) throw new Error(events.error.message);
  const eventRows = events.data ?? [];
  if (eventRows.length !== 1) throw new Error(`${eventRows.length} events named Puzzle 4th Birthday.`);
  const event = eventRows[0]!;
  const artists = await db.from("creative_lab_artists").select("id, name").eq("client_id", event.client_id).ilike("name", "Luke%");
  if (artists.error) throw new Error(artists.error.message);
  const luke = (artists.data ?? []).filter((row) => /^luke\b/i.test(String(row.name ?? "")));
  if (luke.length !== 1) throw new Error(`${luke.length} Luke artists on that client.`);
  const clips = await db
    .from("creative_lab_clips")
    .select("id, clip_no, user_id, artist_id, creative_asset_id, render_asset_id")
    .eq("artist_id", luke[0]!.id)
    .in("clip_no", [4, 5]);
  if (clips.error) throw new Error(clips.error.message);
  const rows = [...(clips.data ?? [])].sort((a, b) => Number(a.clip_no) - Number(b.clip_no));
  let wouldWrite = 0;
  let already = 0;
  let notOver = 0;
  console.log(`Puzzle 4th Birthday · Luke clips 4 and 5: ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  for (const clip of rows) {
    const label = `Luke ${clip.clip_no}`;
    if (clip.render_asset_id) {
      already += 1;
      const copy = await db.from("creative_assets").select("storage_path").eq("id", clip.render_asset_id).maybeSingle();
      const kind = text(copy.data as Row | null, "storage_path").includes("proxy-1080") ? "1080 proxy" : "linked copy";
      console.log(`${label}: already has a render copy (${kind})`);
      continue;
    }
    const asset = await db.from("creative_assets").select("id, storage_path, filename, duration_seconds").eq("id", clip.creative_asset_id).maybeSingle();
    if (asset.error) throw new Error(asset.error.message);
    const storagePath = text(asset.data as Row | null, "storage_path");
    if (!storagePath) {
      console.log(`${label}: no original file`);
      continue;
    }
    const signed = await db.storage.from("campaign-assets").createSignedUrl(storagePath, 60 * 10);
    if (signed.error || !signed.data?.signedUrl) {
      console.log(`${label}: could not read the original`);
      continue;
    }
    const measured = await probeMp4Url(signed.data.signedUrl);
    const size = renderProxySize(measured.width, measured.height);
    if (!size) {
      notOver += 1;
      console.log(`${label}: ${measured.width}×${measured.height}, no copy (not over 1080)`);
      continue;
    }
    wouldWrite += 1;
    console.log(`${label}: ${measured.width}×${measured.height} → ${size.width}×${size.height}`);
    if (!apply) continue;
    const downloaded = await fetch(signed.data.signedUrl);
    if (!downloaded.ok) throw new Error(`${label}: download failed`);
    const original = Buffer.from(await downloaded.arrayBuffer());
    const duration = Number((asset.data as Row | null)?.duration_seconds);
    const stored = await attachRenderProxy(db as unknown as ServiceRoleDb, {
      clipId: String(clip.id),
      userId: String(clip.user_id ?? ""),
      artistId: String(clip.artist_id ?? ""),
      name: text(asset.data as Row | null, "filename") || `clip ${clip.clip_no}.mp4`,
      original,
      width: measured.width,
      height: measured.height,
      durationSeconds: Number.isFinite(duration) ? duration : measured.durationInSeconds,
      upload: async (path, bytes, contentType) => {
        const saved = await (db as SupabaseClient).storage.from("campaign-assets").upload(path, bytes, { contentType, upsert: true });
        if (saved.error) throw new Error(saved.error.message);
      },
    });
    console.log(`${label}: ${stored?.created ? "stored" : "left as it was"}`);
  }
  console.log(`${apply ? "apply" : "dry-run"}: ${wouldWrite} to write, ${already} already stored, ${notOver} not over 1080`);
}

await main();
