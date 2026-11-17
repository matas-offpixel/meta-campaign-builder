/**
 * VW1's backfill (docs/design-record/2026-11-17-creative-lab-video-window.html,
 * VW3 "Existing clips are checked once, by a backfill"): finds the drops in
 * every Lab clip's own sound and VW2's window, or VW3's refusal.
 *
 *   node --experimental-strip-types --env-file=.env.local scripts/backfill-clip-drops.mts
 *   node --experimental-strip-types --env-file=.env.local scripts/backfill-clip-drops.mts --event P26-BDAY
 *   node --experimental-strip-types --env-file=.env.local scripts/backfill-clip-drops.mts --apply
 *
 * Dry run by default: reads prod (SELECTs and signed Storage reads only),
 * decodes each clip's sound and prints, per clip, the drops found, the main
 * drop, and the window or the refusal. Nothing is written.
 *   --apply      writes creative_lab_clips.drops / drops_at and VW2's window
 *                (in_s / out_s, and the made triple-fit's); needs migration 258.
 *                Renders are not re-queued: a draft is re-cut the next time
 *                it renders (VW6), and approved renders are never touched.
 *   --event CODE only that event's clips (repeatable): its lineup artists'
 *                clips, its promoter clips, and clips filmed at it.
 *   --recheck    every clip, not only the unchecked, failed and stale ones.
 *   --limit N    stop after N clips.
 *
 * Streams: ffmpeg reads each render copy (else original) from a signed URL
 * and decodes its audio to memory (-vn), one clip at a time. Nothing is
 * written to disk, so a 400 MB 4K original needs no temp space. A made
 * triple-fit is skipped: it cuts its source's window.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Never
 * prints tokens or file URLs.
 */

import { createClient } from "@supabase/supabase-js";

import { detectClipDrops, dropsNeedCheck, failedDrops, writeClipDrops } from "../lib/creative-lab/clip-drops-run.ts";
import { VW_LINES, clock, refusalOf, windowState, type StoredDrops } from "../lib/creative-lab/edit-window.ts";
import type { ServiceRoleDb } from "../lib/creative-lab/load.ts";
import { renderSourceAsset } from "../lib/creative-lab/render-source.ts";

type Row = Record<string, unknown>;

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const recheck = argv.includes("--recheck");
const codes = argv.flatMap((arg, i) => (arg === "--event" && argv[i + 1] ? [argv[i + 1]!] : []));
const limitArg = argv.flatMap((arg, i) => (arg === "--limit" && argv[i + 1] ? [Number(argv[i + 1])] : []))[0];
const limit = limitArg != null && Number.isFinite(limitArg) && limitArg > 0 ? limitArg : Infinity;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const text = (row: Row | null | undefined, k: string) => String(row?.[k] ?? "").trim();

/** Every row, 1,000 at a time (PostgREST's cap). */
async function allRows(table: string, select: string, filter?: (q: ReturnType<typeof db.from>) => unknown): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(select).order("id", { ascending: true }).range(from, from + 999);
    if (filter) q = filter(q as unknown as ReturnType<typeof db.from>) as typeof q;
    const res = await q;
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
    const rows = (res.data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function scopedClipIds(): Promise<Set<string> | null> {
  if (!codes.length) return null;
  const ids = new Set<string>();
  for (const code of codes) {
    const ev = await db.from("events").select("id, client_id").eq("event_code", code).maybeSingle();
    if (ev.error) throw new Error(`events: ${ev.error.message}`);
    if (!ev.data) {
      console.log(`! ${code}: no event with that code`);
      continue;
    }
    const eventId = String(ev.data.id);
    const lineup = await allRows("event_artists", "id, artist_id", (q) => (q as unknown as { eq: (c: string, v: string) => unknown }).eq("event_id", eventId));
    const libraryIds = new Set(lineup.map((r) => text(r, "artist_id")).filter(Boolean));
    const labArtists = ev.data.client_id
      ? await allRows("creative_lab_artists", "id, artist_id", (q) => (q as unknown as { eq: (c: string, v: string) => unknown }).eq("client_id", String(ev.data!.client_id)))
      : [];
    const labIds = new Set(labArtists.filter((a) => libraryIds.has(text(a, "artist_id"))).map((a) => text(a, "id")));
    for (const clip of await allRows("creative_lab_clips", "id, artist_id, event_id, shown_on_event_id")) {
      if (labIds.has(text(clip, "artist_id")) || text(clip, "event_id") === eventId || text(clip, "shown_on_event_id") === eventId) ids.add(text(clip, "id"));
    }
  }
  return ids;
}

function describe(drops: StoredDrops): string[] {
  if (drops.status === "failed") return [`  check failed: ${drops.error}`, `  → ${VW_LINES.chip.noDrop}: ${VW_LINES.noDrop}`];
  const lines: string[] = [];
  lines.push(`  ${drops.durationS.toFixed(1)} s · ${drops.hasSound ? `${drops.lufs ?? "?"} LUFS` : "no sound"} · ${drops.candidates.length} drop${drops.candidates.length === 1 ? "" : "s"}`);
  for (const c of drops.candidates) {
    const main = drops.mainS != null && Math.abs(c.tS - drops.mainS) < 1e-6;
    lines.push(`    ${main ? "main " : "     "}${clock(c.tS)} · rises ${c.riseDb.toFixed(1)} dB`);
  }
  const refused = refusalOf(drops);
  if (refused) {
    lines.push(`  → ${refused.chip}: ${refused.sentence}`);
    if (refused.useDrop) lines.push(`    ${VW_LINES.dropAction(refused.useDrop.tS)}`);
    return lines;
  }
  const state = windowState(drops, { dropS: null, byHand: false, inS: null, outS: null });
  if (state.kind === "ok") lines.push(`  → window ${state.window.inS.toFixed(1)}–${state.window.outS.toFixed(1)} s · ${VW_LINES.summary(state.window, false)}`);
  return lines;
}

async function main() {
  const scope = await scopedClipIds();
  const clips = (await allRows("creative_lab_clips", "*"))
    .filter((clip) => !text(clip, "triple_fit_source_id"))
    .filter((clip) => !scope || scope.has(text(clip, "id")));
  if (clips.length && !("drops" in clips[0]!)) {
    console.error("creative_lab_clips has no drops column: apply migration 258 first (a dry run still prints; --apply can't write).");
    if (apply) process.exit(2);
  }
  const artists = new Map((await allRows("creative_lab_artists", "id, name")).map((a) => [text(a, "id"), text(a, "name")]));
  const todo = clips
    .filter((clip) => recheck || dropsNeedCheck(clip))
    .sort((a, b) => (artists.get(text(a, "artist_id")) ?? "promoter").localeCompare(artists.get(text(b, "artist_id")) ?? "promoter") || Number(a.clip_no) - Number(b.clip_no))
    .slice(0, limit);
  console.log(`${apply ? "APPLY" : "Dry run"} · ${todo.length} of ${clips.length} clip${clips.length === 1 ? "" : "s"} to check${codes.length ? ` · ${codes.join(", ")}` : ""}${recheck ? " · --recheck" : ""}\n`);

  const tally = { ok: 0, refused: 0, failed: 0, written: 0 } as Record<string, number> & { ok: number; refused: number; failed: number; written: number };
  const chips = new Map<string, number>();
  for (const clip of todo) {
    const label = `${artists.get(text(clip, "artist_id")) || "Promoter"} #${text(clip, "clip_no")}`;
    let source = "";
    try {
      source = renderSourceAsset(clip).copy ? "render copy" : "original";
    } catch {
      source = "no file";
    }
    console.log(`${label} (${source})`);
    let drops: StoredDrops;
    let result: Awaited<ReturnType<typeof detectClipDrops>> | null = null;
    try {
      result = await detectClipDrops(db as unknown as ServiceRoleDb, text(clip, "id"));
      drops = result.drops;
    } catch (err) {
      drops = failedDrops(err, null);
    }
    for (const line of describe(drops)) console.log(line);
    const refused = refusalOf(drops);
    if (drops.status === "failed") tally.failed += 1;
    else if (refused) tally.refused += 1;
    else tally.ok += 1;
    if (refused) chips.set(refused.chip, (chips.get(refused.chip) ?? 0) + 1);
    if (apply) {
      if (result) await writeClipDrops(db as unknown as ServiceRoleDb, result);
      else {
        const res = await db.from("creative_lab_clips").update({ drops, drops_at: new Date().toISOString(), window_drop_s: null, window_by_hand: false }).eq("id", text(clip, "id"));
        if (res.error) throw new Error(res.error.message);
      }
      tally.written += 1;
    }
  }
  console.log(`\n${tally.ok} make an edit · ${tally.refused} refused · ${tally.failed} failed to read${apply ? ` · ${tally.written} written` : " · nothing written (dry run)"}`);
  for (const [chip, n] of chips) console.log(`  ${chip}: ${n}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, "") : err);
  process.exit(1);
});
