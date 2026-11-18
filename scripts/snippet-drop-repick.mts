/**
 * TK3's amendment to CT4 (docs/design-record/2026-11-18-creative-lab-top-tracks.html):
 * snippet static drafts re-pick their drop with the Top tracks drop choice.
 * Approved renders and drops the operator set are kept.
 *
 *   npx tsx scripts/snippet-drop-repick.mts [--event CODE] [--apply]
 *
 * Dry run by default: it reads creative_lab_audio_files rows whose drop the
 * Lab set (drop_source 'lab' or no drop yet), downloads each Storage copy,
 * runs TK3's choice with CT1's window as the fit, and prints old → new.
 * --apply writes the new drop, window, drops and drop_choice on those rows,
 * and moves each unapproved, not-yet-launched final snippet render of that
 * file to the new window (start_s) and back to queued, so the draft re-cuts.
 * An operator's drop (drop_source 'operator') and any approved render are
 * never touched. Needs migration 260 for --apply.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { withTempDir } from "../lib/creative-tests/audio-ffmpeg.ts";
import { AUDIO_BUCKET, tk3SnippetDrop } from "../lib/creative-tests/audio-intake.ts";
import { clampLength, mmss, windowForDrop } from "../lib/creative-tests/snippet.ts";
import { decodeForAnalysis } from "../lib/creative-tests/top-tracks/ffmpeg.ts";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const eventCode = argv.includes("--event") ? argv[argv.indexOf("--event") + 1] : undefined;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed");
const db = createClient(url, key, { auth: { persistSession: false } });

let eventIds: string[] | null = null;
if (eventCode) {
  const ev = await db.from("events").select("id").eq("event_code", eventCode);
  if (ev.error) throw new Error(ev.error.message);
  eventIds = (ev.data ?? []).map((e) => e.id as string);
  if (!eventIds.length) throw new Error(`no event ${eventCode}`);
}

let q = db.from("creative_lab_audio_files").select("id, event_id, drive_file_name, storage_path, duration_s, drop_s, drop_source, unusable_reason, length_s").not("storage_path", "is", null).is("unusable_reason", null);
if (eventIds) q = q.in("event_id", eventIds);
const rows = await q.order("created_at", { ascending: true }).range(0, 999);
if (rows.error) throw new Error(rows.error.message);

let changed = 0;
for (const row of rows.data ?? []) {
  if (row.drop_source === "operator") {
    console.log(`${row.drive_file_name}: drop set by an operator (${mmss(Number(row.drop_s))}) — kept`);
    continue;
  }
  const duration = Number(row.duration_s);
  const tk3 = await withTempDir("repick-", async (dir) => {
    const { data, error } = await db.storage.from(AUDIO_BUCKET).download(String(row.storage_path));
    if (error || !data) throw new Error(`storage download: ${error?.message ?? "no file"}`);
    const local = path.join(dir, path.basename(String(row.storage_path)));
    await writeFile(local, new Uint8Array(await data.arrayBuffer()));
    return tk3SnippetDrop(await decodeForAnalysis(local), duration);
  });
  const before = row.drop_s != null ? mmss(Number(row.drop_s)) : "none";
  const after = tk3.dropS != null ? `${mmss(tk3.dropS)} (${tk3.choice})` : "none";
  const same = (row.drop_s == null && tk3.dropS == null) || (row.drop_s != null && tk3.dropS != null && Math.abs(Number(row.drop_s) - tk3.dropS) < 0.05);
  console.log(`${row.drive_file_name}: ${before} → ${after}${same ? " (same)" : ""}`);
  if (same) continue;
  changed += 1;
  if (!apply) continue;
  const win = tk3.dropS != null ? windowForDrop(tk3.dropS, duration, clampLength(row.length_s)) : null;
  const up = await db.from("creative_lab_audio_files").update({ drop_s: tk3.dropS, drop_source: tk3.dropS != null ? "lab" : null, window_start_s: win?.startS ?? null, drops: tk3.drops, drop_choice: tk3.choice }).eq("id", row.id).neq("drop_source", "operator");
  if (up.error) throw new Error(up.error.message);
  if (!win) continue;
  const drafts = await db.from("creative_lab_snippet_renders").select("id, test_id").eq("audio_file_id", row.id).eq("purpose", "final").is("approved_at", null).in("status", ["done", "failed", "queued"]);
  if (drafts.error) throw new Error(drafts.error.message);
  for (const d of drafts.data ?? []) {
    const launched = d.test_id ? await db.from("creative_test_variants").select("id").eq("snippet_render_id", d.id).not("meta_ad_id", "is", null).limit(1) : { data: [], error: null };
    if (launched.error) throw new Error(launched.error.message);
    if ((launched.data ?? []).length) continue;
    const re = await db.from("creative_lab_snippet_renders").update({ start_s: win.startS, status: "queued", error: null }).eq("id", d.id).is("approved_at", null);
    if (re.error) throw new Error(re.error.message);
  }
}
console.log(`\n${rows.data?.length ?? 0} files read · ${changed} would change${apply ? " · applied" : " · dry run (pass --apply to write)"}`);
