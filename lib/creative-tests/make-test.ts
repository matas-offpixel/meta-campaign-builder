/**
 * CT10's "Make Test 1": one snippet per picked track, all on the chosen
 * static, queued for the render tick. It makes the event's plan on first
 * use (CT6's default: Test 1 · Tracks, Test 2 · Statics, Test 3 · Together,
 * the later two waiting), Test 1's variants, and their renders.
 *
 * Nothing goes to Meta here. A test reaches Meta only when Matas approves its
 * variants ("Approve variants", made ACTIVE, TT9).
 *
 * While Test 1 is still being made it can be made again: its variants are
 * replaced and its earlier renders are left as they are (unlinked). Once it's
 * approved, it can't.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { renderStage } from "../drive/tree.ts";
import type { AudioFileRow } from "./audio-intake.ts";
import { clampPairStart, orderBoxes, readPairHeld, trackPairRefusal, type PairBox, type PairHeld } from "./pair.ts";
import { DEFAULT_PLAN, variantCountOk } from "./plan.ts";
import { fileWindow, renderRefusal } from "./snippet-render.ts";
import { SNIPPET, clampLength, snippetFileName, type TopTrack } from "./snippet.ts";
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

// ── VP2: a track pair ───────────────────────────────────────────────────────

export type MakePairInput = {
  eventId: string;
  userId: string;
  /** The one track file. */
  fileId: string;
  static: { driveFileId: string; fileName: string };
  /** VP1: both windows run this long (15–20 s). */
  lengthS: number;
  /** The two boxes, each a window (its start and its drop marker) and a label. */
  boxes: PairBox[];
};

export type MakePairResult = { ok: true; testId: string; n: number; renderIds: string[]; rerendered: boolean } | { ok: false; error: string; status: number };

const PAIR_TEST_COLUMNS = "id, n, kind, state, held";

/**
 * VP2's "Make pair · {Track}": two snippets of one track file on one static at
 * one length, as a test of kind "pair" in the event's plan (VP4: a lane of its
 * own, so it takes the plan's next number and waits on nothing). The plan is
 * made if there isn't one, with no CT6 tests in it: a pair doesn't need them.
 *
 * While the pair is still being made it can be made again. If only its labels
 * changed, they're saved and nothing re-renders, and the sign-off stands. If a
 * window, the length or the static changed, it's a new asset: both snippets
 * render again and the sign-offs are cleared, because Matas signed off the old
 * one (VP7). Once it's approved, a new pair of the same track is a new test.
 *
 * Nothing goes to Meta here.
 */
export async function makePair(
  db: Db,
  input: MakePairInput,
  ctx: { event: { event_code: string | null; status: string | null }; artistNames: Map<string, string>; allFiles: AudioFileRow[]; tracksByArtist: Map<string, TopTrack[]>; now?: Date },
): Promise<MakePairResult> {
  const file = ctx.allFiles.find((f) => f.id === input.fileId);
  if (!file) return { ok: false, error: "That file isn't in this event's audio.", status: 400 };
  const refusal = renderRefusal(file);
  if (refusal) return { ok: false, error: `${variantLabel(file)}: ${refusal}`, status: 409 };
  const lengthS = clampLength(input.lengthS);
  const duration = Number(file.duration_s ?? 0);
  const boxes: PairBox[] = input.boxes.map((b) => ({ label: String(b.label ?? ""), startS: b.startS == null ? null : clampPairStart(Number(b.startS), duration, lengthS), dropS: b.dropS == null ? null : Number(b.dropS) }));
  const wrong = trackPairRefusal({ lengthS, boxes });
  if (wrong) return { ok: false, error: wrong, status: 409 };
  const ordered = orderBoxes(boxes);
  const windows = ordered.map((b) => ({ startS: b.startS!, dropS: b.dropS! }));
  const labels = ordered.map((b) => b.label.trim());
  const asset = variantLabel(file);
  const staticLabel = staticName(input.static.fileName);

  // The plan, made on first use. A pair needs no CT6 tests in it.
  const planRead = await db.from("creative_test_plans").select("id").eq("event_id", input.eventId).maybeSingle();
  if (planRead.error) throw new Error(`creative_test_plans: ${planRead.error.message}`);
  let planId = (planRead.data as { id: string } | null)?.id ?? null;
  if (!planId) {
    const made = await db.from("creative_test_plans").insert({ user_id: input.userId, event_id: input.eventId }).select("id").single();
    if (made.error) throw new Error(`creative_test_plans: ${made.error.message}`);
    planId = (made.data as { id: string }).id;
  }
  const testsRead = await db.from("creative_tests").select(PAIR_TEST_COLUMNS).eq("plan_id", planId);
  if (testsRead.error) throw new Error(`creative_tests: ${testsRead.error.message}`);
  const planTests = (testsRead.data ?? []) as { id: string; n: number; kind: string; state: string; held: unknown }[];
  const existing = planTests.find((t) => t.kind === "pair" && t.state === "making" && readPairHeld(t.held)?.audioFileId === file.id) ?? null;
  const before = existing ? readPairHeld(existing.held) : null;
  const same =
    before != null &&
    before.staticDriveFileId === input.static.driveFileId &&
    before.lengthS === lengthS &&
    before.windows.length === windows.length &&
    before.windows.every((w, i) => w.startS === windows[i]!.startS && w.dropS === windows[i]!.dropS);
  const held: PairHeld = {
    pair: "track",
    audioFileId: file.id,
    asset,
    static: staticLabel,
    staticDriveFileId: input.static.driveFileId,
    lengthS,
    windows,
    signOff: same ? before!.signOff : null,
    artistPageApproval: same ? before!.artistPageApproval : null,
  };

  if (existing && same) {
    // Only the labels changed: the snippets and the sign-off stand.
    const variants = await db.from("creative_test_variants").select("id, position, snippet_render_id").eq("test_id", existing.id);
    if (variants.error) throw new Error(`creative_test_variants: ${variants.error.message}`);
    const rows = ((variants.data ?? []) as { id: string; position: number; snippet_render_id: string | null }[]).sort((a, b) => a.position - b.position);
    for (const [i, v] of rows.entries()) {
      const res = await db.from("creative_test_variants").update({ label: labels[i] }).eq("id", v.id);
      if (res.error) throw new Error(`creative_test_variants: ${res.error.message}`);
    }
    return { ok: true, testId: existing.id, n: existing.n, renderIds: rows.map((v) => v.snippet_render_id).filter((id): id is string => Boolean(id)), rerendered: false };
  }

  let testId: string;
  let n: number;
  if (existing) {
    testId = existing.id;
    n = existing.n;
    const cleared = await db.from("creative_test_variants").delete().eq("test_id", testId).eq("state", "pending");
    if (cleared.error) throw new Error(`creative_test_variants: ${cleared.error.message}`);
    const updated = await db.from("creative_tests").update({ held }).eq("id", testId);
    if (updated.error) throw new Error(`creative_tests: ${updated.error.message}`);
  } else {
    n = planTests.reduce((max, t) => Math.max(max, Number(t.n) || 0), 0) + 1;
    const made = await db
      .from("creative_tests")
      .insert({ user_id: input.userId, plan_id: planId, event_id: input.eventId, n, kind: "pair", format: "video", runs_in: "tests_adset", state: "making", held })
      .select("id")
      .single();
    if (made.error) throw new Error(`creative_tests: ${made.error.message}`);
    testId = (made.data as { id: string }).id;
  }

  // Both snippets, _r1 and _r2 (VP2), queued for the render tick.
  const renderIds: string[] = [];
  const stage = renderStage(ctx.event.status);
  const slug = staticSlugForName(input.static.fileName, ctx.event.event_code);
  const artistName = (file.artist_id && ctx.artistNames.get(file.artist_id)) || "";
  const numbers = trackNumbers(ctx.allFiles.filter((f) => f.artist_id === file.artist_id), (file.artist_id && ctx.tracksByArtist.get(file.artist_id)) || []);
  for (const [i, win] of windows.entries()) {
    const render = await db
      .from("creative_lab_snippet_renders")
      .insert({
        user_id: input.userId,
        event_id: input.eventId,
        audio_file_id: file.id,
        purpose: "final",
        static_drive_file_id: input.static.driveFileId,
        static_name: staticLabel,
        start_s: win.startS,
        length_s: lengthS,
        test_id: testId,
        status: "queued",
        file_name: snippetFileName({ eventCode: ctx.event.event_code, artistName, trackN: numbers.get(file.id) ?? 1, staticName: slug, stage, roundNo: i + 1 }),
      })
      .select("id")
      .single();
    if (render.error) throw new Error(`creative_lab_snippet_renders: ${render.error.message}`);
    const renderId = (render.data as { id: string }).id;
    renderIds.push(renderId);
    const variant = await db.from("creative_test_variants").insert({
      user_id: input.userId,
      test_id: testId,
      position: i + 1,
      role: "variant",
      label: labels[i],
      source: { kind: "snippet", audioFileId: file.id, snippetRenderId: renderId, startS: win.startS, dropS: win.dropS },
      snippet_render_id: renderId,
      state: "pending",
    });
    if (variant.error) throw new Error(`creative_test_variants: ${variant.error.message}`);
  }
  return { ok: true, testId, n, renderIds, rerendered: true };
}

export type PairApproval = "signOff" | "artistPageApproval";

/**
 * VP7: Matas records his sign-off ("Sign off") or the artist-page approval
 * ("Record artist-page approval") on a pair that's still being made. Only
 * Matas, and never after Approve: the caller checks he's Matas.
 */
export async function recordPairApproval(db: Db, input: { testId: string; userId: string; eventId: string; which: PairApproval; now?: Date }): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const read = await db.from("creative_tests").select("id, kind, state, held").eq("id", input.testId).eq("event_id", input.eventId).eq("user_id", input.userId).maybeSingle();
  if (read.error) throw new Error(`creative_tests: ${read.error.message}`);
  const test = read.data as { id: string; kind: string; state: string; held: unknown } | null;
  const held = test ? readPairHeld(test.held) : null;
  if (!test || test.kind !== "pair" || !held) return { ok: false, error: "No pair with that id.", status: 404 };
  if (test.state !== "making") return { ok: false, error: "This pair has been approved, so its sign-off can't change.", status: 409 };
  const next = { ...(test.held as Record<string, unknown>), [input.which]: { by: input.userId, at: (input.now ?? new Date()).toISOString() } };
  const res = await db.from("creative_tests").update({ held: next }).eq("id", test.id).eq("state", "making");
  if (res.error) throw new Error(`creative_tests: ${res.error.message}`);
  return { ok: true };
}
