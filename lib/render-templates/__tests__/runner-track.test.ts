/**
 * The runner's --track (scripts/render-package.mts, through runner.ts): the
 * picked track drives the dry run's plan and the apply's package, which the
 * worker renders; an id this show can't use is refused with nothing written;
 * without --track the choice is stable (billing order, a drop set by hand
 * before the Lab's, oldest first).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeDb } from "../../mcp/__tests__/fake-db.ts";
import { renderPackageTool } from "../../mcp/tools/render.ts";
import { ToolInputError, type ToolContext } from "../../mcp/tool-types.ts";
import { fakeDrive } from "../../drive/__tests__/fake-drive.ts";
import { loadPackageState } from "../load.ts";
import { dryRunLines, runnerTrack, trackLine, RUNNER_LINES } from "../runner.ts";
import { requestPackage } from "../start.ts";
import { runPackageTick, type WorkerDeps } from "../worker.ts";
import { fixtureTrack } from "./fixture-track.ts";
import { EVENT, MATAS, NOW, TODAY, TRACK, fakeStartDeps, fixtureTables } from "./fixtures.ts";

const MAKE_BELIEVE = "9f5086f2-6382-4af6-b2b4-5a4672ba127c";
// On one of the fixture track's kicks (0.1 s + 45 beats at 126 BPM), as an operator would set it.
const HAND_DROP = 0.1 + 45 * (60 / 126);

function tables(order: "as-is" | "reversed" = "as-is") {
  const t = fixtureTables();
  const base = t.creative_lab_audio_files![0]!;
  Object.assign(base, { spotify_title: "The Finest", created_at: "2026-11-01T10:00:00Z" });
  const rows = [
    base,
    { ...base, id: MAKE_BELIEVE, spotify_title: "Make Believe", storage_path: "audio/make-believe.wav", drop_s: HAND_DROP, drop_source: "operator", created_at: "2026-11-20T10:00:00Z" },
    { ...base, id: "flagged", spotify_title: "Flagged", storage_path: "audio/flagged.wav", rights_flag: "label", created_at: "2026-11-02T10:00:00Z" },
    { ...base, id: "no-drop", spotify_title: "No Drop", storage_path: "audio/no-drop.wav", drop_s: null, drop_source: null, created_at: "2026-11-03T10:00:00Z" },
    { ...base, id: "unusable", spotify_title: "Unusable", storage_path: "audio/unusable.wav", unusable_reason: "too short", created_at: "2026-11-04T10:00:00Z" },
    { ...base, id: "other-event", event_id: "ev-other", spotify_title: "Elsewhere", storage_path: "audio/elsewhere.wav", created_at: "2026-11-05T10:00:00Z" },
  ];
  t.creative_lab_audio_files = order === "reversed" ? [...rows].reverse() : rows;
  return t;
}

const load = async (db: ReturnType<typeof fakeDb>) => (await loadPackageState(db, EVENT, fakeStartDeps(), NOW, TODAY))!;

test("without --track the choice is stable: a drop set by hand before the Lab's, whatever order the rows come in", async () => {
  for (const order of ["as-is", "reversed"] as const) {
    const loaded = await load(fakeDb(tables(order)));
    const choice = runnerTrack(loaded, null);
    assert.ok(choice.ok);
    assert.equal(choice.ok && choice.track?.id, MAKE_BELIEVE, order);
    assert.deepEqual(loaded.tracks.map((t) => t.id), [MAKE_BELIEVE, TRACK, "flagged", "no-drop"], order);
  }
});

test("--track picks that track for the dry run: its line names it with its id and drop, and the plan is cut on it", async () => {
  const loaded = await load(fakeDb(tables()));
  const choice = runnerTrack(loaded, TRACK);
  assert.ok(choice.ok && choice.track);
  assert.equal(trackLine(choice.track!), `Track: The Finest · ${TRACK} · drop at ${fixtureTrack().dropS.toFixed(3)} s, the Lab's`);
  const mb = runnerTrack(loaded, MAKE_BELIEVE);
  assert.ok(mb.ok && mb.track);
  assert.equal(trackLine(mb.track!), `Track: Make Believe · ${MAKE_BELIEVE} · drop at ${HAND_DROP.toFixed(3)} s, set by hand`);
  const lines = await dryRunLines(loaded, fakeStartDeps(), TRACK);
  assert.match(lines[1]!, /^Track: The Finest · /, "the cut sheet is The Finest's");
  const byHand = await dryRunLines(loaded, fakeStartDeps(), MAKE_BELIEVE);
  assert.match(byHand[1]!, /^Track: Make Believe · /);
});

test("an id this show can't use is refused before anything runs: flagged, no drop, unusable, another event's, unknown", async () => {
  const db = fakeDb(tables());
  const loaded = await load(db);
  for (const id of ["flagged", "no-drop", "unusable", "other-event", "nope"]) {
    assert.deepEqual(runnerTrack(loaded, id), { ok: false, line: RUNNER_LINES.badTrack }, id);
  }
  assert.equal(RUNNER_LINES.badTrack, "That track can't be used for this show. Nothing was rendered.");
  assert.deepEqual(db.writes.filter((w) => w.table !== "creative_lab_audio_files"), []);
});

test("--apply: the package stores the picked track and the worker renders it, never loadTracks' first", async () => {
  const db = fakeDb({ ...tables(), drive_folders: [], artist_library_folders: [] });
  const started = await requestPackage(db, fakeStartDeps(), { userId: MATAS, eventId: EVENT, recipes: ["montage"], picks: { track: TRACK }, source: "claude", approval: { asked: "Render it? OK?", answer: "yes" }, now: NOW, today: TODAY });
  assert.ok(started.ok);
  const pkg = ((await db.from("creative_lab_render_packages").select("*")).data as Record<string, unknown>[])[0]!;
  assert.equal((pkg.picks as { trackId: string }).trackId, TRACK);
  const audio: string[] = [];
  const deps: WorkerDeps = {
    ...fakeStartDeps(),
    signUrl: async (_b, p) => `https://signed.example/${p}`,
    upload: async () => {},
    download: async () => new Uint8Array(),
    render: async (req) => {
      audio.push(String(req.inputProps.audioUrl));
      return { bytes: new TextEncoder().encode("mp4"), renderMs: 1 };
    },
    probe: () => ({ width: 1080, height: 1920, fps: 30, durationInSeconds: 15 }),
    layers: async () => [],
    latestArt: async () => true,
    drive: fakeDrive(),
    libraryRenders: async () => null,
    now: () => NOW,
    today: TODAY,
  };
  await runPackageTick(db, deps, { maxAtOnce: 9 });
  assert.equal(audio.length, 9);
  assert.ok(audio.every((u) => u.endsWith("audio/enzo-track.wav")), "every file is cut on The Finest");
  assert.ok(!audio.some((u) => u.includes("make-believe")), "never the first track loadTracks returns");
});

test("render_package with a track this show can't use refuses on the ruled needs row, nothing rendered", async () => {
  const db = fakeDb(tables());
  const ctx = { db, readers: {} as never, userId: MATAS, scope: "mcp:read mcp:render", isMatas: true, render: fakeStartDeps(), seesClientNames: true, today: TODAY, now: NOW } as ToolContext;
  try {
    await renderPackageTool.run(ctx, { event: "P26-BDAY", picks: { track: "flagged" }, approval: { asked: "Render it? OK?", answer: "yes" } });
    assert.fail("expected a refusal");
  } catch (e) {
    assert.ok(e instanceof ToolInputError);
    assert.equal(e.message, "Can’t render Montage (15 s) yet for P26-BDAY: track and drop missing. Nothing was rendered.");
  }
  assert.deepEqual(db.writes.filter((w) => w.table === "creative_lab_render_packages" || w.table === "creative_lab_renders"), []);
});
