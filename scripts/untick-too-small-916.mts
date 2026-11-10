/**
 * Puzzle 4th Birthday, Luke clips whose 9:16 window is under 675 px.
 * Dry run by default. Lists each clip's probed size, the 9:16 window,
 * and whether a selection row is ticked. --apply sets those rows to
 * unselected. Mode "all" has no per-clip row: the Lab gate already
 * leaves them out, so there is nothing to write.
 *
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/untick-too-small-916.mts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Never prints tokens or file URLs.
 */

import { createClient } from "@supabase/supabase-js";

import { TOO_SMALL_FOR_916, tooSmallFor916 } from "../lib/creative-lab/import-quality.ts";
import { probeMp4Url } from "../lib/creative-lab/mp4-probe.ts";
import { footageWindow } from "../lib/creative-lab/t1-video-frame.ts";

const apply = process.argv.includes("--apply");
const CLIP_NOS = [1, 15, 16, 18, 21];

type Row = Record<string, unknown>;

function text(row: Row | null, key: string): string {
  return String(row?.[key] ?? "").trim();
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const events = await db.from("events").select("id, name, client_id, clip_selection_mode").ilike("name", "Puzzle 4th Birthday");
  if (events.error) throw new Error(events.error.message);
  const eventRows = events.data ?? [];
  if (eventRows.length !== 1) throw new Error(`${eventRows.length} events named Puzzle 4th Birthday.`);
  const event = eventRows[0]!;
  const mode = text(event as Row, "clip_selection_mode") === "chosen" ? "chosen" : "all";
  const artists = await db.from("creative_lab_artists").select("id, name").eq("client_id", event.client_id).ilike("name", "Luke%");
  if (artists.error) throw new Error(artists.error.message);
  const luke = (artists.data ?? []).filter((row) => /^luke\b/i.test(String(row.name ?? "")));
  if (luke.length !== 1) throw new Error(`${luke.length} Luke artists on that client.`);
  const clips = await db
    .from("creative_lab_clips")
    .select("id, clip_no, creative_asset_id")
    .eq("artist_id", luke[0]!.id)
    .in("clip_no", CLIP_NOS);
  if (clips.error) throw new Error(clips.error.message);
  const rows = [...(clips.data ?? [])].sort((a, b) => Number(a.clip_no) - Number(b.clip_no));
  const selections = await db.from("creative_lab_clip_selections").select("clip_id, selected").eq("event_id", event.id);
  if (selections.error && !/does not exist|schema cache/i.test(selections.error.message)) throw new Error(selections.error.message);
  const selectedById = new Map((selections.data ?? []).map((row) => [String(row.clip_id), row.selected === true]));
  console.log(`Puzzle 4th Birthday · selection mode ${mode} · Luke clips ${CLIP_NOS.join(", ")}: ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  const toUntick: string[] = [];
  for (const clip of rows) {
    const label = `Luke ${clip.clip_no}`;
    const asset = await db.from("creative_assets").select("storage_path").eq("id", clip.creative_asset_id).maybeSingle();
    if (asset.error) throw new Error(asset.error.message);
    const storagePath = text(asset.data as Row | null, "storage_path");
    if (!storagePath) {
      console.log(`${label} ${clip.id}: no file`);
      continue;
    }
    const signed = await db.storage.from("campaign-assets").createSignedUrl(storagePath, 60 * 10);
    if (signed.error || !signed.data?.signedUrl) {
      console.log(`${label} ${clip.id}: could not read the file`);
      continue;
    }
    const measured = await probeMp4Url(signed.data.signedUrl);
    const windowPx = Math.round(footageWindow(measured, "9:16").width);
    const small = tooSmallFor916(measured);
    const hasRow = selectedById.has(clip.id);
    const ticked = mode === "chosen" ? selectedById.get(clip.id) === true : true;
    let action = "not selected";
    if (!small) action = "9:16 window is large enough — left as it is";
    else if (mode === "all") action = "mode all — the gate leaves it out; no row to untick";
    else if (!hasRow) action = "no selection row";
    else if (ticked) {
      action = apply ? "unticked" : "dry run would set selected false";
      toUntick.push(clip.id);
    } else action = "selection row is already false";
    console.log(`${label} ${clip.id}: ${measured.width} × ${measured.height}, 9:16 window ${windowPx} px${small ? `, ${TOO_SMALL_FOR_916}` : ""} — ${action}`);
  }
  if (apply && toUntick.length > 0) {
    const updated = await db.from("creative_lab_clip_selections").update({ selected: false }).in("clip_id", toUntick).eq("event_id", event.id);
    if (updated.error) throw new Error(updated.error.message);
  }
  console.log(apply ? `wrote ${toUntick.length}` : `dry run — ${toUntick.length} row${toUntick.length === 1 ? "" : "s"} would be unticked`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
