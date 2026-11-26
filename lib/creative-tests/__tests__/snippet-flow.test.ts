/**
 * The snippet's flow on fakes (an in-memory database and Drive): the audio
 * folder made on first need, intake from 02 Source / Audio only, the
 * operator's edits, the render's refusals and steps, the render tick, Make
 * Test 1, the Spotify cache, and the source guard (CT2: no way in from a
 * link).
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { fakeDrive } from "../../drive/__tests__/fake-drive.ts";
import { AUDIO_KEY, audioKey, ensureAudioFolder } from "../../drive/folders.ts";
import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import { EXTRA_FILE, SNIPPET_FILES } from "../../../scripts/plan-frames/snippet-fixtures.ts";
import { editPatch } from "../audio-edits.ts";
import { audioFilesIn, scanArtistAudio, type AudioFileRow, type IntakeDeps } from "../audio-intake.ts";
import { makeTest1, trackNumbers, variantLabel } from "../make-test.ts";
import { MAX_SNIPPET_RENDERS_AT_ONCE, finalPath, renderRefusal, renderSnippet, runSnippetRenderTick, type RenderDeps, type SnippetRenderRow } from "../snippet-render.ts";
import { SPOTIFY_MARKET, rankTracks, readTopTracks } from "../spotify-top.ts";

const EVENT = { id: "ev1", client_id: "cl1", name: "Puzzle 4th Birthday", event_code: "P26-BDAY", event_date: "2026-12-27", status: "on_sale", drive_folder_id: "EVENT", drive_folder_linked: false, drive_cancel_marked_at: null };
const CLIENT = { id: "cl1", name: "Puzzle", status: "active", drive_folder_id: "CLIENT" };
const ARTIST = { libraryArtistId: "luke-dean", name: "Luke Dean" };

function intakeFakes(drive: ReturnType<typeof fakeDrive>, probes: Record<string, { codec: string; container: string; bitrateKbps: number | null; durationS: number | null }>) {
  const downloads: string[] = [];
  const uploads: string[] = [];
  const deps: IntakeDeps = {
    drive,
    async downloadTo(fileId, filePath) {
      downloads.push(fileId);
      void filePath;
    },
    async upload(storagePath) {
      uploads.push(storagePath);
    },
    async probe() {
      return probes[downloads.at(-1)!] ?? null;
    },
    async envelopes() {
      // A drop at 0:58: quiet low end, then loud (mono 8 kHz s16le).
      const seconds = 120;
      const low = new Uint8Array(seconds * 8000 * 2);
      const view = new DataView(low.buffer);
      for (let i = 0; i < seconds * 8000; i += 1) view.setInt16(i * 2, i >= 58 * 8000 ? (i % 2 ? 12000 : -12000) : i % 2 ? 300 : -300, true);
      return { full: low, low };
    },
    tempDir: (fn) => fn("/tmp/fake"),
  };
  return { deps, downloads, uploads };
}

describe("CT2: the audio folder and intake", () => {
  it("makes 02 Source / Audio / {artist} on first need, named as the lineup, and reuses it", async () => {
    const drive = fakeDrive();
    const { db, tables } = memoryDb({ drive_folders: [{ client_id: "cl1", event_id: "ev1", key: "event", name: "x", drive_folder_id: "EVENT" }, { client_id: "cl1", event_id: "ev1", key: "02", name: "02 Source", drive_folder_id: "SOURCE" }] });
    drive.files.set("EVENT", { id: "EVENT", name: "event", mimeType: "application/vnd.google-apps.folder", parents: ["ROOT"] });
    drive.files.set("SOURCE", { id: "SOURCE", name: "02 Source", mimeType: "application/vnd.google-apps.folder", parents: ["EVENT"] });
    const id = await ensureAudioFolder(db, drive, EVENT as never, CLIENT as never, ARTIST);
    assert.ok(id);
    assert.deepEqual(drive.childrenNamed("event / 02 Source"), ["Audio"]);
    assert.deepEqual(drive.childrenNamed("event / 02 Source / Audio"), ["Luke Dean"]);
    const keys = tables.drive_folders!.map((r) => r.key);
    assert.ok(keys.includes(AUDIO_KEY) && keys.includes(audioKey("luke-dean")));
    const again = await ensureAudioFolder(db, drive, EVENT as never, CLIENT as never, ARTIST);
    assert.equal(again, id);
    assert.deepEqual(drive.childrenNamed("event / 02 Source / Audio"), ["Luke Dean"]);
  });

  it("makes nothing for a cancelled event, an archived client, or an event with no tree", async () => {
    const drive = fakeDrive();
    const { db } = memoryDb({});
    assert.equal(await ensureAudioFolder(db, drive, { ...EVENT, status: "cancelled" } as never, CLIENT as never, ARTIST), null);
    assert.equal(await ensureAudioFolder(db, drive, EVENT as never, { ...CLIENT, status: "archived" } as never, ARTIST), null);
    assert.equal(await ensureAudioFolder(db, drive, { ...EVENT, drive_folder_id: null } as never, CLIENT as never, ARTIST), null);
  });

  it("reads only audio files in the act's folder: no folders, shortcuts, the app's own files, or trash", () => {
    const files = audioFilesIn([
      { id: "1", name: "a.wav", mimeType: "audio/wav" },
      { id: "2", name: "b.mp3", mimeType: "application/octet-stream" },
      { id: "3", name: "Old", mimeType: "application/vnd.google-apps.folder" },
      { id: "4", name: "c.wav", mimeType: "application/vnd.google-apps.shortcut" },
      { id: "5", name: "d.wav", mimeType: "audio/wav", appProperties: { offpixel_kind: "lab_snippet" } },
      { id: "6", name: "e.wav", mimeType: "audio/wav", trashed: true },
      { id: "7", name: "notes.pdf", mimeType: "application/pdf" },
    ]);
    assert.deepEqual(files.map((f) => f.id), ["1", "2"]);
  });

  it("checks, copies and reads each new file; an unusable one is recorded and not copied; nothing in Drive moves", async () => {
    const drive = fakeDrive();
    const folder = drive.drop("ROOT", "Luke Dean", { mimeType: "application/vnd.google-apps.folder" });
    const good = drive.drop(folder.id, "track two (club mix).aiff", { mimeType: "audio/aiff" });
    const low = drive.drop(folder.id, "rip.mp3", { mimeType: "audio/mpeg" });
    const before = JSON.stringify([...drive.files.values()].map((f) => [f.id, f.name, f.parents]));
    const { db, tables } = memoryDb({ creative_lab_audio_files: [] });
    const { deps, downloads, uploads } = intakeFakes(drive, {
      [good.id]: { codec: "pcm_s16be", container: "aiff", bitrateKbps: 1411, durationS: 120 },
      [low.id]: { codec: "mp3", container: "mp3", bitrateKbps: 96, durationS: 120 },
    });
    const result = await scanArtistAudio(db, { ...deps, ensureFolder: async () => folder.id }, { event: EVENT as never, client: CLIENT as never, artist: ARTIST, userId: "u1" });
    assert.equal(result.added, 2);
    assert.deepEqual(downloads.sort(), [good.id, low.id].sort());
    assert.deepEqual(uploads, [`audio/creative-lab/ev1/${good.id}.aiff`]);
    const rows = tables.creative_lab_audio_files as unknown as AudioFileRow[];
    const g = rows.find((r) => r.drive_file_id === good.id)!;
    assert.equal(g.unusable_reason, null);
    assert.ok(g.drop_s != null && Math.abs(Number(g.drop_s) - 58) <= 0.25);
    assert.equal(g.drop_source, "lab");
    assert.equal(g.window_start_s, Number(g.drop_s) - 4);
    const l = rows.find((r) => r.drive_file_id === low.id)!;
    assert.equal(l.unusable_reason, "MP3 under 128 kbps");
    assert.equal(l.storage_path, null);
    assert.equal(JSON.stringify([...drive.files.values()].map((f) => [f.id, f.name, f.parents])), before);
    assert.ok(!drive.calls.some((c) => /update|createFolder|upload/.test(c)), drive.calls.join(","));
    // A second scan reads nothing again.
    const again = await scanArtistAudio(db, { ...deps, ensureFolder: async () => folder.id }, { event: EVENT as never, client: CLIENT as never, artist: ARTIST, userId: "u1" });
    assert.equal(again.added, 0);
    assert.equal(downloads.length, 2);
  });
});

const row = (extra: Partial<AudioFileRow> = {}): AudioFileRow => ({ ...SNIPPET_FILES[1]!, ...extra });

describe("CT3 / CT4: the operator's edits", () => {
  it("dragging the marker sets the drop and moves the window with it; dragging the window moves the start alone", () => {
    assert.deepEqual(editPatch(row(), { kind: "drop", dropS: 70 }, "u1", "t"), { drop_s: 70, drop_source: "operator", drop_set_by: "u1", drop_set_at: "t", window_start_s: 66, length_s: 16 });
    assert.deepEqual(editPatch(row(), { kind: "window", startS: 50 }, "u1", "t"), { window_start_s: 50 });
    assert.deepEqual(editPatch(row({ drop_s: null }), { kind: "window", startS: 50 }, "u1", "t"), { refused: "Place the drop marker first." });
  });

  it("length is 15 to 20 s and keeps the start", () => {
    assert.deepEqual(editPatch(row(), { kind: "length", lengthS: 20 }, "u1", "t"), { length_s: 20, window_start_s: 54 });
    assert.deepEqual(editPatch(row(), { kind: "length", lengthS: 40 }, "u1", "t"), { length_s: 20, window_start_s: 54 });
  });

  it("a Drive file in no top track is picked as itself; a flag clears once", () => {
    assert.deepEqual(editPatch(row({ match_state: "none" }), { kind: "own_track" }, "u1", "t"), { spotify_track_id: null, spotify_title: null, match_state: "matched", matched_by: "u1", matched_at: "t" });
    assert.deepEqual(editPatch(row(), { kind: "clear_flag" }, "u1", "t"), { refused: "This file isn't flagged." });
    assert.deepEqual(editPatch(row({ rights_flag: "Meta muted the audio (rights)" }), { kind: "clear_flag" }, "u1", "t"), { rights_flag: null, rights_flag_cleared_by: "u1", rights_flag_cleared_at: "t" });
  });
});

describe("CT1 / CT10: the render", () => {
  it("renders with a confirmed match, a file that passes AU1 and a placed drop marker, and no rights flag (AU4)", () => {
    assert.equal(renderRefusal(row()), null);
    assert.equal(renderRefusal(row({ match_state: "suggested" })), "Match this file to a track first.");
    assert.equal(renderRefusal(row({ drop_s: null })), "No clear drop found. Pick where it lands.");
    assert.equal(renderRefusal(row({ rights_flag: "Meta muted the audio (rights)" })), "Meta muted the audio (rights)");
    assert.equal(renderRefusal(row({ unusable_reason: "MP3 under 128 kbps" })), "Can't use this file: MP3 under 128 kbps");
    assert.equal(renderRefusal(row({ storage_path: null })), "Can't use this file: it can't be read");
  });

  function renderFakes() {
    const calls: string[] = [];
    const deps: RenderDeps = {
      async download(bucket, p) {
        calls.push(`download ${bucket} ${p}`);
        return new Uint8Array([1]);
      },
      async exists() {
        return false;
      },
      async upload(bucket, p, _f, ct) {
        calls.push(`upload ${p} ${ct}`);
      },
      async cut(_i, _o, win) {
        calls.push(`cut ${win.startS} ${win.lengthS}`);
      },
      tempDir: async (fn) => {
        const dir = await mkdtemp(path.join(tmpdir(), "snippet-fake-"));
        try {
          return await fn(dir);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
      async staticUrl() {
        return "https://storage/static.png";
      },
      async renderStill({ lengthS }) {
        calls.push(`lambda StillWithAudio ${lengthS}s silent`);
        return { bytes: new Uint8Array([0]), renderMs: 30_000 };
      },
      async mux() {
        calls.push("mux copy");
      },
      async register() {
        return "asset-1";
      },
    };
    return { deps, calls };
  }

  it("cuts the window from the Storage copy, renders the still silent on Lambda, muxes, stores and registers", async () => {
    const file = row({ id: "f2" });
    const render: SnippetRenderRow = { id: "r1", user_id: "u1", event_id: "ev1", audio_file_id: "f2", purpose: "final", static_drive_file_id: "s1", static_name: "x", start_s: 54, length_s: 16, test_id: "t1", status: "rendering", attempt: 0, error: null, storage_path: null, file_name: "a_r1_9x16.mp4", updated_at: "2026-11-16T12:00:00Z" };
    const { db, tables } = memoryDb({ creative_lab_audio_files: [file as never], creative_lab_snippet_renders: [render as never] });
    const { deps, calls } = renderFakes();
    await renderSnippet(db, render, deps);
    assert.deepEqual(calls, [`download campaign-assets ${file.storage_path}`, "cut 54 16", "lambda StillWithAudio 16s silent", "mux copy", `upload ${finalPath("r1", 1)} video/mp4`]);
    const done = tables.creative_lab_snippet_renders![0]!;
    assert.equal(done.status, "done");
    assert.equal(done.creative_asset_id, "asset-1");
    assert.equal(done.storage_path, "videos/creative-lab/snippet/r1-9x16.mp4");
    assert.equal(done.file_name, "a_r1_9x16.mp4");
  });

  it("the tick runs at most two at once, oldest first, and fails a render stuck 15 minutes", async () => {
    const base = { user_id: "u1", event_id: "ev1", audio_file_id: "f2", purpose: "final", static_drive_file_id: "s1", static_name: "x", start_s: 54, length_s: 16, test_id: null, attempt: 0, error: null, storage_path: null, file_name: "a_r1_9x16.mp4" };
    const { db, tables } = memoryDb({
      creative_lab_audio_files: [row({ id: "f2" }) as never],
      creative_lab_snippet_renders: [
        { ...base, id: "stuck", status: "rendering", updated_at: "2026-11-16T11:00:00Z", created_at: "2026-11-16T10:00:00Z" },
        { ...base, id: "q1", status: "queued", updated_at: "2026-11-16T11:59:00Z", created_at: "2026-11-16T11:01:00Z" },
        { ...base, id: "q2", status: "queued", updated_at: "2026-11-16T11:59:00Z", created_at: "2026-11-16T11:02:00Z" },
        { ...base, id: "q3", status: "queued", updated_at: "2026-11-16T11:59:00Z", created_at: "2026-11-16T11:03:00Z" },
      ],
    });
    const { deps } = renderFakes();
    const result = await runSnippetRenderTick(db, deps, { now: new Date("2026-11-16T12:00:00Z") });
    assert.equal(MAX_SNIPPET_RENDERS_AT_ONCE, 2);
    assert.deepEqual(result, { claimed: 2, timedOut: 1, failed: 0, busy: false });
    const by = new Map(tables.creative_lab_snippet_renders!.map((r) => [r.id, r]));
    assert.equal(by.get("stuck")!.status, "failed");
    assert.equal(by.get("stuck")!.error, "timeout");
    assert.equal(by.get("q1")!.status, "done");
    assert.equal(by.get("q2")!.status, "done");
    assert.equal(by.get("q3")!.status, "queued");
  });

  it("a render whose file was flagged meanwhile fails with the record's words", async () => {
    const render = { id: "r9", user_id: "u1", event_id: "ev1", audio_file_id: "f2", purpose: "final", static_drive_file_id: "s1", static_name: "x", start_s: 54, length_s: 16, test_id: null, status: "queued", attempt: 0, error: null, storage_path: null, file_name: "a_r1_9x16.mp4", updated_at: "2026-11-16T11:59:00Z", created_at: "2026-11-16T11:00:00Z" };
    const { db, tables } = memoryDb({ creative_lab_audio_files: [row({ id: "f2", rights_flag: "Meta muted the audio (rights)" }) as never], creative_lab_snippet_renders: [render as never] });
    const result = await runSnippetRenderTick(db, renderFakes().deps, { now: new Date("2026-11-16T12:00:00Z") });
    assert.equal(result.failed, 1);
    assert.equal(tables.creative_lab_snippet_renders![0]!.error, "Meta muted the audio (rights)");
  });
});

describe("CT10: Make Test 1", () => {
  const tracks = ["Track one", "Track two", "Track three", "Track four", "Track five", "Track six"].map((title, i) => ({ id: `t${i + 1}`, title, rank: i + 1 }));
  const ctx = (files: AudioFileRow[]) => ({ event: { event_code: "P26-BDAY", status: "on_sale" }, artistNames: new Map([["luke-dean", "Luke Dean"]]), allFiles: files, tracksByArtist: new Map([["luke-dean", tracks]]) });

  it("makes the default plan, Test 1's variants, and one queued snippet per track on the static", async () => {
    const files = [SNIPPET_FILES[0]!, SNIPPET_FILES[1]!, EXTRA_FILE];
    const { db, tables } = memoryDb({ creative_test_plans: [], creative_tests: [], creative_test_variants: [], creative_lab_snippet_renders: [] });
    const made = await makeTest1(db, { eventId: "ev1", userId: "u1", fileIds: files.map((f) => f.id), static: { driveFileId: "s1", fileName: "P26-BDAY_puzzle_t2-roll-call-w23nov_9x16.png" } }, ctx(files));
    assert.ok(made.ok);
    assert.deepEqual(tables.creative_tests!.map((t) => [t.n, t.kind, t.format, t.state]), [[1, "tracks", "video", "making"], [2, "statics", "video", "waiting"], [3, "together", "video", "waiting"]]);
    assert.deepEqual(tables.creative_test_variants!.map((v) => v.label), ["Track one", "Track two", "LD_unreleased-edit"]);
    const renders = tables.creative_lab_snippet_renders!;
    assert.equal(renders.length, 3);
    assert.ok(renders.every((r) => r.status === "queued" && r.purpose === "final" && r.static_drive_file_id === "s1"));
    assert.deepEqual(renders.map((r) => r.file_name), [
      "P26-BDAY_luke-dean-1_snippet-puzzle_t2-roll-call-w23nov-on-sale_r1_9x16.mp4",
      "P26-BDAY_luke-dean-2_snippet-puzzle_t2-roll-call-w23nov-on-sale_r1_9x16.mp4",
      "P26-BDAY_luke-dean-7_snippet-puzzle_t2-roll-call-w23nov-on-sale_r1_9x16.mp4",
    ]);
    // Nothing reaches Meta: no launched rows, no ledger.
    assert.equal(tables.launched_ads, undefined);
    assert.equal(tables.meta_write_idempotency, undefined);
  });

  it("refuses a flagged track, fewer than 2 or more than 5", async () => {
    const files = [SNIPPET_FILES[0]!, SNIPPET_FILES[4]!];
    const { db } = memoryDb({ creative_test_plans: [], creative_tests: [] });
    const held = await makeTest1(db, { eventId: "ev1", userId: "u1", fileIds: files.map((f) => f.id), static: { driveFileId: "s1", fileName: "s.png" } }, ctx(files));
    assert.deepEqual(held, { ok: false, error: "Track six: Meta muted the audio (rights)", status: 409 });
    const one = await makeTest1(db, { eventId: "ev1", userId: "u1", fileIds: ["f1"], static: { driveFileId: "s1", fileName: "s.png" } }, ctx([SNIPPET_FILES[0]!]));
    assert.equal(one.ok, false);
  });

  it("can't be made again once Test 1 is approved", async () => {
    const files = [SNIPPET_FILES[0]!, SNIPPET_FILES[1]!];
    const { db } = memoryDb({ creative_test_plans: [{ id: "p1", event_id: "ev1" }], creative_tests: [{ id: "t1", plan_id: "p1", n: 1, kind: "tracks", state: "approved" }] });
    const made = await makeTest1(db, { eventId: "ev1", userId: "u1", fileIds: files.map((f) => f.id), static: { driveFileId: "s1", fileName: "s.png" } }, ctx(files));
    assert.deepEqual(made, { ok: false, error: "Test 1 has been approved, so its snippets can't be made again.", status: 409 });
  });

  it("{track n} is the picker place; a file in no top track comes after them", () => {
    const numbers = trackNumbers([EXTRA_FILE, SNIPPET_FILES[1]!], tracks);
    assert.equal(numbers.get("f2"), 2);
    assert.equal(numbers.get("fx"), 7);
    assert.equal(variantLabel(EXTRA_FILE), "LD_unreleased-edit");
  });
});

describe("CT3: Spotify, once a day per act", () => {
  it("keeps Spotify's order and the first 10", () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `Song ${i}` }));
    const ranked = rankTracks(raw);
    assert.equal(ranked.length, 10);
    assert.deepEqual(ranked.slice(0, 2), [{ id: "s0", title: "Song 0", rank: 1 }, { id: "s1", title: "Song 1", rank: 2 }]);
  });

  it("reads the cache within a day, fetches after, and falls back to a stale row when Spotify fails", async () => {
    const now = new Date("2026-11-16T12:00:00Z");
    const { db, tables } = memoryDb({ spotify_top_tracks_cache: [{ artist_id: "a1", market: SPOTIFY_MARKET, tracks: [{ id: "x", title: "Old", rank: 1 }], fetched_at: "2026-11-16T01:00:00Z" }] });
    let fetched = 0;
    const fetch = async () => {
      fetched += 1;
      return [{ id: "n", name: "New" }];
    };
    const fresh = await readTopTracks(db, { artistId: "a1", spotifyArtistId: "sp1", userId: "u1" }, { fetch, now });
    assert.ok(fresh.ok && fresh.cached && fresh.tracks[0]!.title === "Old");
    assert.equal(fetched, 0);
    const later = await readTopTracks(db, { artistId: "a1", spotifyArtistId: "sp1", userId: "u1" }, { fetch, now: new Date("2026-11-17T13:00:00Z") });
    assert.ok(later.ok && !later.cached && later.tracks[0]!.title === "New");
    assert.equal(tables.spotify_top_tracks_cache!.length, 1);
    const failing = async () => {
      throw new Error("HTTP 429");
    };
    const stale = await readTopTracks(db, { artistId: "a1", spotifyArtistId: "sp1", userId: "u1" }, { fetch: failing, now: new Date("2026-11-19T13:00:00Z") });
    assert.ok(stale.ok && stale.tracks[0]!.title === "New");
    const none = await readTopTracks(memoryDb({}).db, { artistId: "a2", spotifyArtistId: "sp2", userId: "u1" }, { fetch: failing, now });
    assert.equal(none.ok, false);
  });
});

describe("CT2: no way in from a link", () => {
  const root = path.join(process.cwd(), "lib/creative-tests");
  const sources = [
    ...readdirSync(root).filter((f) => f.endsWith(".ts")).map((f) => path.join(root, f)),
    path.join(process.cwd(), "app/api/creative-lab/events/[eventId]/snippet/route.ts"),
    path.join(process.cwd(), "components/dashboard/events/creative-lab/snippet.tsx"),
  ];

  it("names no audio site, preview URL or download-from-link path", () => {
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, /youtube|youtu\.be|soundcloud|preview_url|open\.spotify\.com\/track|yt-dlp|ytdl/i, file);
    }
  });

  it("calls fetch only for Spotify's top-tracks list", () => {
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      const fetches = [...text.matchAll(/\bfetch\(\s*([`"'][^`"']*)/g)].map((m) => m[1]!);
      // The app's own routes: the Snippet tab's, and a variant pair's "Approve variants" (VP7).
      for (const target of fetches) assert.ok(target.startsWith("`https://api.spotify.com/v1/artists/") || target.startsWith("`/api/creative-lab/events/") || target.startsWith("`/api/creative-lab/tests/"), `${file}: fetch(${target}`);
    }
  });

  it("the renderer reads audio only from the file's Storage copy of its 02 Source / Audio file", () => {
    const render = readFileSync(path.join(root, "snippet-render.ts"), "utf8");
    assert.match(render, /deps\.download\(AUDIO_BUCKET, String\(file\.storage_path\)\)/);
    const intake = readFileSync(path.join(root, "audio-intake.ts"), "utf8");
    assert.match(intake, /ensureAudioFolder/);
    assert.match(intake, /audioFilesIn\(await deps\.drive\.listChildren\(folderId\)\)/);
  });
});
