/**
 * CT10's "Make Test 1": one snippet per picked track, all on the chosen
 * static, queued for the render tick. It makes the event's plan on first
 * use (CT6's default: Test 1 · Tracks, Test 2 · Statics, Test 3 · Together,
 * the later two waiting), Test 1's variants, and their renders.
 *
 * Nothing goes to Meta here. A test reaches Meta only when Matas approves its
 * variants (PR D, "Approve variants", created paused) and starts it.
 *
 * While Test 1 is still being made it can be made again: its variants are
 * replaced and its earlier renders are left as they are (unlinked). Once it's
 * approved, it can't.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { renderStage } from "../drive/tree.ts";
import type { AudioFileRow } from "./audio-intake.ts";
import { DEFAULT_PLAN, variantCountOk } from "./plan.ts";
import { fileWindow, renderRefusal } from "./snippet-render.ts";
import { SNIPPET, snippetFileName, type TopTrack } from "./snippet.ts";
import { staticName, staticSlugForName } from "./statics.ts";

type Db = Pick<SupabaseClient, "from">;

export type MakeTestInput = {
  eventId: string;
  userId: string;
  /** The picked files, in picker order. */
  fileIds: string[];
  static: { driveFileId: string; fileName: string };
};

export type MakeTestResult = { ok: true; testId: string; renderIds: string[] } | { ok: false; error: string; status: number };

export type PickerTrackN = (file: AudioFileRow) => number;

/**
 * CT1's {track n}: the track's place in the picker. A Spotify top track is its
 * rank; a Drive file in no top track is listed under them, so it comes after
 * the top tracks in the order the folder lists them.
 */
export function trackNumbers(files: readonly AudioFileRow[], tracks: readonly TopTrack[]): Map<string, number> {
  const rank = new Map(tracks.map((t) => [t.id, t.rank]));
  const out = new Map<string, number>();
  let extra = tracks.length;
  for (const file of files) {
    const r = file.spotify_track_id ? rank.get(file.spotify_track_id) : undefined;
    if (r != null) out.set(file.id, r);
    else out.set(file.id, (extra += 1));
  }
  return out;
}

/** The variant's name on the event page and the share link (CT11): the track title, else the file's name. */
export function variantLabel(file: Pick<AudioFileRow, "spotify_title" | "drive_file_name">): string {
  return file.spotify_title?.trim() || staticName(file.drive_file_name);
}

export async function makeTest1(
  db: Db,
  input: MakeTestInput,
  ctx: { event: { event_code: string | null; status: string | null }; artistNames: Map<string, string>; allFiles: AudioFileRow[]; tracksByArtist: Map<string, TopTrack[]> },
): Promise<MakeTestResult> {
  const ids = [...new Set(input.fileIds)];
  if (!variantCountOk("tracks", ids.length)) return { ok: false, error: `Test 1 takes ${SNIPPET.minPicks} to ${SNIPPET.maxPicks} tracks.`, status: 400 };
  const byId = new Map(ctx.allFiles.map((f) => [f.id, f]));
  const files = ids.map((id) => byId.get(id));
  if (files.some((f) => !f)) return { ok: false, error: "A picked file isn't in this event's audio.", status: 400 };
  for (const file of files as AudioFileRow[]) {
    const refusal = renderRefusal(file);
    if (refusal) return { ok: false, error: `${variantLabel(file)}: ${refusal}`, status: 409 };
  }

  // The plan, made on first use with CT6's default tests.
  const planRead = await db.from("creative_test_plans").select("id").eq("event_id", input.eventId).maybeSingle();
  if (planRead.error) throw new Error(`creative_test_plans: ${planRead.error.message}`);
  let planId = (planRead.data as { id: string } | null)?.id ?? null;
  if (!planId) {
    const made = await db.from("creative_test_plans").insert({ user_id: input.userId, event_id: input.eventId }).select("id").single();
    if (made.error) throw new Error(`creative_test_plans: ${made.error.message}`);
    planId = (made.data as { id: string }).id;
    const tests = DEFAULT_PLAN.map((t) => ({ user_id: input.userId, plan_id: planId, event_id: input.eventId, n: t.n, kind: t.kind, format: t.format, runs_in: t.runsIn, state: t.n === 1 ? "making" : "waiting" }));
    const insert = await db.from("creative_tests").insert(tests);
    if (insert.error) throw new Error(`creative_tests: ${insert.error.message}`);
  }
  const testRead = await db.from("creative_tests").select("id, state, kind").eq("plan_id", planId).eq("n", 1).maybeSingle();
  if (testRead.error) throw new Error(`creative_tests: ${testRead.error.message}`);
  const test = testRead.data as { id: string; state: string; kind: string } | null;
  if (!test || test.kind !== "tracks") return { ok: false, error: "This plan's Test 1 isn't a tracks test.", status: 409 };
  if (test.state !== "making" && test.state !== "waiting") return { ok: false, error: "Test 1 has been approved, so its snippets can't be made again.", status: 409 };

  const cleared = await db.from("creative_test_variants").delete().eq("test_id", test.id).eq("state", "pending");
  if (cleared.error) throw new Error(`creative_test_variants: ${cleared.error.message}`);
  const held = { static: staticName(input.static.fileName), staticDriveFileId: input.static.driveFileId };
  const testUpdate = await db.from("creative_tests").update({ state: "making", held }).eq("id", test.id);
  if (testUpdate.error) throw new Error(`creative_tests: ${testUpdate.error.message}`);

  const renderIds: string[] = [];
  const stage = renderStage(ctx.event.status);
  const slug = staticSlugForName(input.static.fileName, ctx.event.event_code);
  for (const [i, file] of (files as AudioFileRow[]).entries()) {
    const artistName = (file.artist_id && ctx.artistNames.get(file.artist_id)) || "";
    const numbers = trackNumbers(ctx.allFiles.filter((f) => f.artist_id === file.artist_id), (file.artist_id && ctx.tracksByArtist.get(file.artist_id)) || []);
    const win = fileWindow(file);
    const render = await db
      .from("creative_lab_snippet_renders")
      .insert({
        user_id: input.userId,
        event_id: input.eventId,
        audio_file_id: file.id,
        purpose: "final",
        static_drive_file_id: input.static.driveFileId,
        static_name: staticName(input.static.fileName),
        start_s: win.startS,
        length_s: win.lengthS,
        test_id: test.id,
        status: "queued",
        file_name: snippetFileName({ eventCode: ctx.event.event_code, artistName, trackN: numbers.get(file.id) ?? i + 1, staticName: slug, stage, roundNo: 1 }),
      })
      .select("id")
      .single();
    if (render.error) throw new Error(`creative_lab_snippet_renders: ${render.error.message}`);
    const renderId = (render.data as { id: string }).id;
    renderIds.push(renderId);
    const variant = await db.from("creative_test_variants").insert({
      user_id: input.userId,
      test_id: test.id,
      position: i + 1,
      role: "variant",
      label: variantLabel(file),
      source: { kind: "snippet", audioFileId: file.id, snippetRenderId: renderId },
      snippet_render_id: renderId,
      state: "pending",
    });
    if (variant.error) throw new Error(`creative_test_variants: ${variant.error.message}`);
  }
  return { ok: true, testId: test.id, renderIds };
}
