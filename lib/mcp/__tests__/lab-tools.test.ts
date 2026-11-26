/**
 * M3d-b: the Lab tools (list_tracks, set_track_drop, list_clips,
 * set_clip_owner) and render_package's picks.trackId. Each calls only its
 * Lab path (spies on ctx.lab), refuses what the brief says, and never
 * writes the database itself. Fixtures: the M4a P26-BDAY-shaped show.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeDb } from "./fake-db.ts";
import { fakeReaders } from "./fixtures.ts";
import { MCP_TOOLS } from "../tools/index.ts";
import { listClipsTool, listTracksTool, renderableTrack, setClipOwnerTool, setTrackDropTool } from "../tools/lab.ts";
import { renderPackageTool } from "../tools/render.ts";
import { LAB_FOR_DESIGN, LAB_RULED, LAB_WORDS, newFiles } from "../lab/words.ts";
import { ToolInputError, type McpLabDeps, type ToolContext } from "../tool-types.ts";
import { ELECTRIC, ENZO, EVENT, MATAS, NOW, PUZZLE, TODAY, TRACK, fakeStartDeps, fixtureTables } from "../../render-templates/__tests__/fixtures.ts";
import { runnerTrack } from "../../render-templates/runner.ts";
import { DROP_FOUND, NO_CLEAR_DROP, cantUseText, dropSetBy } from "../../creative-tests/snippet.ts";

type Row = Record<string, unknown>;
type Call = { fn: string; input: Record<string, unknown> };

const TRACK2 = "audio-enzo-2";
const UNUSABLE = "audio-enzo-low";
const FLAGGED = "audio-enzo-flagged";
const NODROP = "audio-enzo-nodrop";

function tables(): Record<string, Row[]> {
  const t = fixtureTables();
  const base = t.creative_lab_audio_files![0]!;
  t.creative_lab_audio_files!.push(
    { ...base, id: TRACK2, drive_file_name: "Enzo - Two.wav", spotify_title: "Track Two", drop_s: 21.5, drop_source: "operator", drop_set_by: MATAS, created_at: "2026-11-20T10:00:00Z" },
    { ...base, id: UNUSABLE, drive_file_name: "Enzo - low.mp3", spotify_title: null, storage_path: null, unusable_reason: "MP3 under 128 kbps", drop_s: null, drop_source: null, created_at: "2026-11-21T10:00:00Z" },
    { ...base, id: FLAGGED, drive_file_name: "Enzo - muted.wav", spotify_title: "Muted One", rights_flag: "Meta muted the audio (rights)", created_at: "2026-11-22T10:00:00Z" },
    { ...base, id: NODROP, drive_file_name: "Enzo - nodrop.wav", spotify_title: "No Drop", drop_s: null, drop_source: null, created_at: "2026-11-23T10:00:00Z" },
  );
  for (const r of t.creative_lab_audio_files!) r.created_at ??= "2026-11-01T10:00:00Z";
  // A clip nobody has said the owner of (a row from before the column existed).
  t.creative_lab_clips!.push({ ...t.creative_lab_clips![0]!, id: "puzzle-legacy", owner: null, clip_no: 50, creative_asset_id: "asset-puzzle-legacy", source_file_id: null });
  t.creative_assets!.push({ ...t.creative_assets![0]!, id: "asset-puzzle-legacy", filename: "legacy.mp4", drive_file_id: null });
  t.drive_folders = [];
  t.artist_library_folders = [];
  return t;
}

function labSpy(opts: { scanned?: boolean; added?: number; failed?: number; saveOk?: boolean; ownerThrowsAt?: number } = {}) {
  const calls: Call[] = [];
  let owners = 0;
  const lab: McpLabDeps = {
    async scanAudio(input) {
      calls.push({ fn: "scanAudio", input: input as never });
      return { scanned: opts.scanned ?? true, added: opts.added ?? 0, failed: opts.failed ?? 0 };
    },
    async saveAudioEdit(input) {
      calls.push({ fn: "saveAudioEdit", input: input as never });
      return opts.saveOk === false ? { ok: false, status: 409 } : { ok: true, dropS: input.edit.dropS };
    },
    async saveClipOwner(input) {
      owners += 1;
      if (opts.ownerThrowsAt && owners === opts.ownerThrowsAt) throw new Error("db down");
      calls.push({ fn: "saveClipOwner", input: input as never });
    },
    async firstNames(ids) {
      calls.push({ fn: "firstNames", input: { ids } as never });
      return new Map(ids.filter((id) => id === MATAS).map((id) => [id, "Matas"]));
    },
  };
  return { lab, calls };
}

function ctxFor(opts: { userId?: string; scope?: string; lab?: McpLabDeps; drive?: unknown; t?: Record<string, Row[]> } = {}) {
  const db = fakeDb(opts.t ?? tables());
  const spy = labSpy();
  const ctx: ToolContext = {
    db,
    readers: fakeReaders as never,
    userId: opts.userId ?? MATAS,
    scope: opts.scope ?? "mcp:read mcp:draft",
    draft: { drive: () => (opts.drive ?? null) } as never,
    lab: opts.lab ?? spy.lab,
    seesClientNames: true,
    today: TODAY,
    now: NOW,
  };
  return { ctx, db, calls: spy.calls };
}

async function refused(p: Promise<unknown>): Promise<ToolInputError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ToolInputError, String(e));
    return e;
  }
  assert.fail("expected a refusal");
}

const noDbWrites = (db: ReturnType<typeof fakeDb>) => assert.deepEqual(db.writes, [], "the tool writes nothing itself; only its Lab path does");

test("the Lab tools are draft tools, registered once each", () => {
  for (const name of ["list_tracks", "set_track_drop", "list_clips", "set_clip_owner"]) {
    const tool = MCP_TOOLS.find((t) => t.name === name);
    assert.ok(tool, name);
    assert.equal(tool!.kind, "draft", name);
  }
  // Every PENDING DESIGN string has a key and a where.
  for (const w of LAB_FOR_DESIGN) assert.ok(w.key && w.where && w.candidate, w.key);
  assert.equal(new Set(LAB_FOR_DESIGN.map((w) => w.key)).size, LAB_FOR_DESIGN.length);
});

test("list_tracks: reads the act's Audio folder first (the Snippet tab's scan), then lists the show's files in render order with the Lab's words", async () => {
  const { lab, calls } = labSpy({ added: 2 });
  const { ctx, db } = ctxFor({ lab });
  const out = await listTracksTool.run(ctx, { event: "P26-BDAY", artist: "enzo siragusa" });
  assert.deepEqual(calls.filter((c) => c.fn === "scanAudio").map((c) => c.input), [{ userId: MATAS, eventId: EVENT, artist: { libraryArtistId: ENZO, name: "Enzo Siragusa" } }]);
  noDbWrites(db);
  const data = out.data as { tracks: Array<Record<string, unknown>>; notes: string[] };
  // compareTracks: a drop set by hand first, then the Lab's, then none; oldest first.
  assert.deepEqual(data.tracks.map((t) => t.id), [TRACK2, TRACK, FLAGGED, UNUSABLE, NODROP]);
  const [byHand, lab1, flagged, low, nodrop] = data.tracks;
  assert.equal((byHand!.drop as { line: string }).line, dropSetBy("Matas"));
  assert.equal((lab1!.drop as { line: string }).line, DROP_FOUND);
  assert.equal((nodrop!.drop as { line: string }).line, NO_CLEAR_DROP);
  assert.equal(low!.usable, false);
  assert.equal(low!.why, cantUseText("MP3 under 128 kbps"));
  assert.match(String(flagged!.flagged), /Meta muted the audio \(rights\)/);
  assert.deepEqual(data.tracks.map((t) => t.renderable), [true, true, false, false, false]);
  assert.ok(data.notes.includes("Read Enzo Siragusa’s Audio folder: 2 new files."));
});

test("list_tracks with no act scans the whole lineup; another account's show is listed without a scan", async () => {
  const all = ctxFor();
  await listTracksTool.run(all.ctx, { event: "P26-BDAY" });
  assert.equal(all.calls.filter((c) => c.fn === "scanAudio").length, 6);
  const other = ctxFor({ userId: "4aa59005-5c1d-495c-8029-8c9453950c4d" });
  const out = await listTracksTool.run(other.ctx, { event: "P26-BDAY" });
  assert.equal(other.calls.filter((c) => c.fn === "scanAudio").length, 0);
  assert.ok((out.data as { notes: string[] }).notes.some((n) => /another account/.test(n)));
  const unknown = await refused(listTracksTool.run(all.ctx, { event: "P26-BDAY", artist: "Nobody" }));
  assert.match(unknown.message, /Nobody isn’t in P26-BDAY’s lineup\. The lineup is Enzo Siragusa, Luke Dean/);
  assert.match(unknown.message, /Nothing was changed\.$/);
});

test("design's corrected rows (26 Nov), word for word, with the typographic ’; they've left the For design list", () => {
  assert.equal(LAB_RULED.scanned, "Read {artist}’s Audio folder: {new}.");
  assert.equal(LAB_RULED.ownerUnknownClip, "Refused: {id} isn’t one of {code}’s clips. Get the ids from list_clips. Nothing was changed.");
  assert.equal(LAB_RULED.ownerUnknownClips, "Refused: {ids} aren’t {code}’s clips. Get the ids from list_clips. Nothing was changed.");
  assert.equal(LAB_RULED.ownerBadName, "Refused: the owner must be promoter or one of {code}’s lineup: {names}. Nothing was changed.");
  // lab.scanned's {new}: 0, 1 and n.
  assert.equal(newFiles(0), "no new files");
  assert.equal(newFiles(1), "1 new file");
  assert.equal(newFiles(3), "3 new files");
  assert.equal(LAB_WORDS.scanned("Enzo Siragusa", 0), "Read Enzo Siragusa’s Audio folder: no new files.");
  assert.equal(LAB_WORDS.scanned("Enzo Siragusa", 1), "Read Enzo Siragusa’s Audio folder: 1 new file.");
  assert.equal(LAB_WORDS.scanned("Enzo Siragusa", 3), "Read Enzo Siragusa’s Audio folder: 3 new files.");
  // owner.unknown_clip: one id, then more than one.
  assert.equal(LAB_WORDS.ownerUnknownClip(["nope-1"], "P26-BDAY"), "Refused: nope-1 isn’t one of P26-BDAY’s clips. Get the ids from list_clips. Nothing was changed.");
  assert.equal(LAB_WORDS.ownerUnknownClip(["nope-1", "nope-2"], "P26-BDAY"), "Refused: nope-1, nope-2 aren’t P26-BDAY’s clips. Get the ids from list_clips. Nothing was changed.");
  assert.equal(
    LAB_WORDS.ownerBadName("P26-BDAY", ["Enzo Siragusa", "Luke Dean"]),
    "Refused: the owner must be promoter or one of P26-BDAY’s lineup: Enzo Siragusa, Luke Dean. Nothing was changed.",
  );
  // set_track_drop's description: the snippet window is 16 s by default, not always.
  assert.match(setTrackDropTool.description, /the drop is set by hand and the snippet window \(16 s by default\) moves with it, starting 4 s before the drop\. /);
  const pendingKeys = new Set(LAB_FOR_DESIGN.map((w) => w.key));
  for (const k of ["claude.mcp.lab.scanned", "claude.mcp.lab.owner.unknown_clip", "claude.mcp.lab.owner.bad_name"]) assert.ok(!pendingKeys.has(k), k);
});

test("list_tracks says how many new files each read found: none, 1, or n; a failed read in has its own line instead", async () => {
  for (const [added, failed, line] of [
    [0, 0, "Read Enzo Siragusa’s Audio folder: no new files."],
    [1, 0, "Read Enzo Siragusa’s Audio folder: 1 new file."],
    [4, 0, "Read Enzo Siragusa’s Audio folder: 4 new files."],
  ] as const) {
    const { lab } = labSpy({ added, failed });
    const out = await listTracksTool.run(ctxFor({ lab }).ctx, { event: "P26-BDAY", artist: "Enzo Siragusa" });
    assert.ok((out.data as { notes: string[] }).notes.includes(line), line);
  }
  const { lab } = labSpy({ added: 0, failed: 2 });
  const notes = ((await listTracksTool.run(ctxFor({ lab }).ctx, { event: "P26-BDAY", artist: "Enzo Siragusa" })).data as { notes: string[] }).notes;
  assert.ok(!notes.some((n) => /no new files/.test(n)), "no 'no new files' beside a failure");
  assert.ok(notes.some((n) => /couldn’t be read in/.test(n)));
});

test("list_tracks with Drive off lists what's in and says so", async () => {
  const { lab } = labSpy({ scanned: false });
  const { ctx } = ctxFor({ lab });
  const out = await listTracksTool.run(ctx, { event: "P26-BDAY", artist: "Enzo Siragusa" });
  assert.ok((out.data as { notes: string[] }).notes.some((n) => /Drive isn’t connected/.test(n)));
});

test("a read-only grant can't run a Lab tool", async () => {
  const { ctx, calls } = ctxFor({ scope: "mcp:read" });
  for (const tool of [listTracksTool, setTrackDropTool, listClipsTool, setClipOwnerTool]) {
    const e = await refused(tool.run(ctx, { event: "P26-BDAY", track_id: TRACK, seconds: 10, clip_ids: ["puzzle-1"], owner: "promoter" }));
    assert.equal((e.summary as Row).refused, "insufficient_scope", tool.name);
  }
  assert.deepEqual(calls, []);
});

test("set_track_drop: the Snippet tab's edit { kind: drop }, and only that", async () => {
  const { ctx, db, calls } = ctxFor();
  const out = await setTrackDropTool.run(ctx, { event: "P26-BDAY", track_id: TRACK, seconds: 30.1234 });
  assert.deepEqual(calls, [{ fn: "saveAudioEdit", input: { userId: MATAS, fileId: TRACK, edit: { kind: "drop", dropS: 30.123 } } }]);
  noDbWrites(db);
  assert.match((out.data as { message: string }).message, /^Done: Track One · drop 0:\d\d → 0:30 \(30\.1 s\), set by hand\./);
  // A no-drop file takes one too (the M3d-b press fix's server half).
  await setTrackDropTool.run(ctx, { event: "P26-BDAY", track_id: NODROP, seconds: 18 });
  assert.match(String(((await setTrackDropTool.run(ctx, { event: "P26-BDAY", track_id: NODROP, seconds: 19 })).data as { message: string }).message), /drop not set → 0:19/);
});

test("set_track_drop refuses: not on the show, can't be used, flagged, outside the track, another account's show", async () => {
  const { ctx, calls } = ctxFor();
  const cases: Array<[Record<string, unknown>, RegExp, string]> = [
    [{ track_id: "nope", seconds: 5 }, /no track with id nope on P26-BDAY/, "track_not_found"],
    [{ track_id: UNUSABLE, seconds: 5 }, /can’t take a drop: MP3 under 128 kbps/, "unusable"],
    [{ track_id: FLAGGED, seconds: 5 }, /is flagged \(Meta muted the audio \(rights\)\)/, "flagged"],
    [{ track_id: TRACK, seconds: -1 }, /is 60\.0 s long/, "outside"],
    [{ track_id: TRACK, seconds: 61 }, /from 0 to 60\.0/, "outside"],
  ];
  for (const [args, msg, why] of cases) {
    const e = await refused(setTrackDropTool.run(ctx, { event: "P26-BDAY", ...args }));
    assert.match(e.message, msg);
    assert.match(e.message, /Nothing was changed\.$/);
    assert.equal((e.summary as Row).refused, why);
  }
  const t = tables();
  t.creative_lab_audio_files!.push({ ...t.creative_lab_audio_files![0]!, id: "other-event-track", event_id: "ev-other" });
  const other = ctxFor({ t });
  assert.equal(((await refused(setTrackDropTool.run(other.ctx, { event: "P26-BDAY", track_id: "other-event-track", seconds: 5 }))).summary as Row).refused, "track_not_found");
  const staff = ctxFor({ userId: "4aa59005-5c1d-495c-8029-8c9453950c4d" });
  assert.equal(((await refused(setTrackDropTool.run(staff.ctx, { event: "P26-BDAY", track_id: TRACK, seconds: 5 }))).summary as Row).refused, "not_owner");
  assert.deepEqual([...calls, ...other.calls, ...staff.calls].filter((c) => c.fn === "saveAudioEdit"), []);
});

test("list_clips: owner promoter, the act's name or unknown; another client's promoter footage can't be used here", async () => {
  const { ctx, db } = ctxFor();
  const out = await listClipsTool.run(ctx, { event: "P26-BDAY" });
  noDbWrites(db);
  const clips = (out.data as { clips: Array<Record<string, unknown>> }).clips;
  const by = new Map(clips.map((c) => [c.id, c]));
  assert.equal(by.get("puzzle-1")!.owner, "promoter");
  assert.equal(by.get("puzzle-1")!.usable, true);
  assert.equal(by.get("enzo-1")!.owner, "Enzo Siragusa");
  assert.equal(by.get("enzo-1")!.usable, true, "artist-owned footage travels");
  assert.equal(by.get("electric-1")!.usable, false);
  assert.equal(by.get("electric-1")!.why, "another client’s promoter footage");
  assert.equal(by.get("electric-1")!.client, "Electric Brixton");
  assert.equal(by.get("puzzle-legacy")!.owner, "unknown");
});

test("set_clip_owner: the Clips card's write, promoter or a lineup act's Lab artist on this client", async () => {
  const { ctx, db, calls } = ctxFor();
  const out = await setClipOwnerTool.run(ctx, { event: "P26-BDAY", clip_ids: ["puzzle-1", "puzzle-2"], owner: "Enzo Siragusa" });
  noDbWrites(db);
  assert.deepEqual(calls.map((c) => [c.fn, c.input.clipId, c.input.owner, c.input.artistId, c.input.who]), [
    ["saveClipOwner", "puzzle-1", "artist", "lab-puzzle-enzo", MATAS],
    ["saveClipOwner", "puzzle-2", "artist", "lab-puzzle-enzo", MATAS],
  ]);
  assert.equal((out.data as { message: string }).message, "Done: 2 clips are now Enzo Siragusa’s footage. Only the app changed; nothing went to Meta.");
  const back = ctxFor();
  await setClipOwnerTool.run(back.ctx, { event: "P26-BDAY", clip_ids: ["puzzle-legacy"], owner: "Promoter" });
  assert.deepEqual(back.calls.map((c) => [c.input.owner, c.input.artistId]), [["promoter", null]]);
});

test("set_clip_owner refuses another client's footage, a clip not on the show, an owner outside the lineup, an act with no Lab artist here", async () => {
  const { ctx, calls } = ctxFor();
  const other = await refused(setClipOwnerTool.run(ctx, { event: "P26-BDAY", clip_ids: ["puzzle-1", "enzo-1"], owner: "promoter" }));
  assert.match(other.message, /enzo-1\.mp4 is Electric Brixton’s footage/);
  assert.equal((other.summary as Row).refused, "other_client");
  const unknown = await refused(setClipOwnerTool.run(ctx, { event: "P26-BDAY", clip_ids: ["nope-1"], owner: "promoter" }));
  assert.equal((unknown.summary as Row).refused, "clip_not_on_show");
  assert.equal(unknown.message, "Refused: nope-1 isn’t one of P26-BDAY’s clips. Get the ids from list_clips. Nothing was changed.");
  const unknowns = await refused(setClipOwnerTool.run(ctx, { event: "P26-BDAY", clip_ids: ["nope-1", "puzzle-1", "nope-2"], owner: "promoter" }));
  assert.equal(unknowns.message, "Refused: nope-1, nope-2 aren’t P26-BDAY’s clips. Get the ids from list_clips. Nothing was changed.");
  const bad = await refused(setClipOwnerTool.run(ctx, { event: "P26-BDAY", clip_ids: ["puzzle-1"], owner: "Somebody Else" }));
  assert.equal(bad.message, "Refused: the owner must be promoter or one of P26-BDAY’s lineup: Enzo Siragusa, Luke Dean, Rossi., Seb Zito, Archie Hamilton, Josh Baker. Nothing was changed.");
  const noLab = await refused(setClipOwnerTool.run(ctx, { event: "P26-BDAY", clip_ids: ["puzzle-1"], owner: "Luke Dean" }));
  assert.match(noLab.message, /Luke Dean has no Lab artist on Puzzle yet/);
  for (const e of [other, unknown, unknowns, bad, noLab]) assert.match(e.message, /Nothing was changed\.$/);
  assert.deepEqual(calls, [], "nothing saved before a refusal");
});

test("set_clip_owner refuses a clip whose Drive file sits in another client's folders (resolveDriveOwner / mayUseFor)", async () => {
  const t = tables();
  t.drive_folders = [{ drive_folder_id: "f-electric", client_id: ELECTRIC, event_id: null }];
  const files: Record<string, { id: string; name: string; mimeType: string; parents?: string[] }> = {
    "drive-puzzle-1": { id: "drive-puzzle-1", name: "puzzle-1.mp4", mimeType: "video/mp4", parents: ["f-electric"] },
    "f-electric": { id: "f-electric", name: "Electric Brixton", mimeType: "application/vnd.google-apps.folder", parents: ["DRIVE"] },
  };
  const drive = { driveId: "DRIVE", getFile: async (id: string) => files[id] ?? null };
  const { ctx, calls } = ctxFor({ t, drive });
  const e = await refused(setClipOwnerTool.run(ctx, { event: "P26-BDAY", clip_ids: ["puzzle-1"], owner: "promoter" }));
  assert.equal((e.summary as Row).refused, "other_client_drive");
  assert.match(e.message, /Electric Brixton’s footage/);
  assert.deepEqual(calls, []);
  void PUZZLE;
});

test("set_clip_owner part way: says how many were saved", async () => {
  const { lab } = labSpy({ ownerThrowsAt: 2 });
  const { ctx } = ctxFor({ lab });
  const e = await refused(setClipOwnerTool.run(ctx, { event: "P26-BDAY", clip_ids: ["puzzle-1", "puzzle-2"], owner: "promoter" }));
  assert.match(e.message, /^1 of 2 clips saved before the save failed/);
});

// ── render_package's picks.trackId ───────────────────────────────────────────

const YES = { asked: "Render the P26-BDAY montage with Track Two: 9 files … OK?", answer: "yes" };

function renderCtx(t = tables()) {
  const db = fakeDb(t);
  const ctx: ToolContext = { db, readers: fakeReaders as never, userId: MATAS, scope: "mcp:read mcp:draft mcp:meta mcp:render", isMatas: true, render: fakeStartDeps(), seesClientNames: true, today: TODAY, now: NOW };
  return { db, ctx };
}

test("render_package with picks.trackId renders that track: the package stores it and the worker reads it from there", async () => {
  const { db, ctx } = renderCtx();
  const out = await renderPackageTool.run(ctx, { event: "P26-BDAY", recipe: "montage", picks: { trackId: TRACK2 }, approval: YES });
  assert.ok((out.summary as Row).packageId);
  const pkg = db.writes.find((w) => w.table === "creative_lab_render_packages" && w.op === "insert");
  assert.ok(pkg, "a package row");
  const row = (Array.isArray(pkg!.rows) ? pkg!.rows[0] : pkg!.rows) as Row;
  assert.equal((row.picks as Row).trackId, TRACK2);
  // Without trackId: the first track in loadTracks' order, a drop set by hand first (Track Two too here); the old `track` still works.
  const again = renderCtx();
  await renderPackageTool.run(again.ctx, { event: "P26-BDAY", recipe: "montage", picks: { track: TRACK }, approval: YES });
  const row2 = (() => {
    const w = again.db.writes.find((x) => x.table === "creative_lab_render_packages" && x.op === "insert")!;
    return (Array.isArray(w.rows) ? w.rows[0] : w.rows) as Row;
  })();
  assert.equal((row2.picks as Row).trackId, TRACK);
});

test("render_package refuses a trackId this show can't use on the ruled needs row, nothing rendered (#1388's rule)", async () => {
  const t = tables();
  t.creative_lab_audio_files!.push({ ...t.creative_lab_audio_files![0]!, id: "other-show", event_id: "ev-other" });
  for (const id of [FLAGGED, NODROP, UNUSABLE, "other-show", "missing"]) {
    const { db, ctx } = renderCtx(structuredClone(t));
    const e = await refused(renderPackageTool.run(ctx, { event: "P26-BDAY", picks: { trackId: id }, approval: YES }));
    assert.equal((e.summary as Row).refused, "needs", id);
    assert.equal(e.message, "Can’t render Montage (15 s) yet for P26-BDAY: track and drop missing. Nothing was rendered.", id);
    assert.deepEqual(db.writes.filter((w) => w.table === "creative_lab_render_packages" || w.table === "creative_lab_renders"), [], id);
  }
  // No approval is still refused first.
  const { ctx } = renderCtx();
  assert.equal(((await refused(renderPackageTool.run(ctx, { event: "P26-BDAY", picks: { trackId: FLAGGED } }))).summary as Row).refused, "no_approval");
});

test("the MCP's track rule is the runner's: renderableTrack agrees with runnerTrack on every fixture track", async () => {
  const { loadPackageState } = await import("../../render-templates/load.ts");
  const t = tables();
  const loaded = await loadPackageState(fakeDb(t) as never, EVENT, fakeStartDeps(), NOW, TODAY);
  assert.ok(loaded);
  for (const row of t.creative_lab_audio_files!) {
    assert.equal(renderableTrack(row, EVENT), runnerTrack(loaded!, String(row.id)).ok, String(row.id));
  }
});

test("consent: Matas's re-consent on the step-up scope Claude is sent gets mcp:render, and render_package is listed for that grant", async () => {
  const { CHALLENGE_SCOPE } = await import("../config.ts");
  const { OPERATOR, STAFF, connect, makeDeps, ORIGIN } = await import("./helpers.ts");
  const { handleMcpRequest } = await import("../server.ts");
  const { createActionLogger } = await import("../action-log.ts");
  const { resetMemoryRateLimit } = await import("../rate-limit.ts");
  const { MCP_PROTOCOL_VERSION } = await import("../config.ts");
  resetMemoryRateLimit();
  const flow = { ...makeDeps(new Set([OPERATOR, STAFF])), isMatas: (u: string) => u === OPERATOR };
  assert.match(CHALLENGE_SCOPE, /\bmcp:render\b/);
  const matas = await connect(flow, OPERATOR, undefined, CHALLENGE_SCOPE);
  assert.equal(matas.tokens.scope, "mcp:read mcp:draft mcp:meta mcp:render");
  const staff = await connect(flow, STAFF, undefined, CHALLENGE_SCOPE);
  assert.equal(staff.tokens.scope, "mcp:read mcp:draft");
  const db = fakeDb(tables());
  const deps = { ...flow, env: { ENABLE_MCP: "1" }, now: () => NOW, db, logDb: db, logger: createActionLogger(db, () => undefined), readers: fakeReaders as never, isMatas: (u: string) => u === OPERATOR, render: fakeStartDeps(), lab: labSpy().lab };
  const res = await handleMcpRequest(
    new Request(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_PROTOCOL_VERSION, authorization: `Bearer ${matas.tokens.access_token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
    deps as never,
  );
  const names = ((await res.json()).result.tools as Array<{ name: string }>).map((t) => t.name);
  for (const n of ["render_package", "list_tracks", "set_track_drop", "list_clips", "set_clip_owner"]) assert.ok(names.includes(n), n);
});
