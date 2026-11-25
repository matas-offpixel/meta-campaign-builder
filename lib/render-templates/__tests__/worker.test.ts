import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeDrive } from "../../drive/__tests__/fake-drive.ts";
import type { CompositionRender } from "../../creative-lab/lambda.ts";
import { requestPackage } from "../start.ts";
import { runPackageTick, type WorkerDeps } from "../worker.ts";
import { EVENT, MATAS, NOW, TODAY, fakeStartDeps, fixtureTables } from "./fixtures.ts";
import { fakeDb } from "../../mcp/__tests__/fake-db.ts";

const SIZE: Record<string, { width: number; height: number }> = { "9:16": { width: 1080, height: 1920 }, "4:5": { width: 1080, height: 1350 }, "1:1": { width: 1080, height: 1080 } };

function setup(opts: { failRatio?: string; wrong45?: boolean } = {}) {
  const db = fakeDb({ ...fixtureTables({ puzzleClips: 0, enzoClips: 16 }), drive_folders: [], artist_library_folders: [] });
  const drive = fakeDrive();
  const renders: CompositionRender[] = [];
  const uploads: string[] = [];
  let libraryFolder: string | null = null;
  const deps: WorkerDeps = {
    ...fakeStartDeps(),
    signUrl: async (bucket, p) => `https://signed.example/${bucket}/${p}`,
    upload: async (_b, p) => void uploads.push(p),
    render: async (req) => {
      renders.push(req);
      const ratio = String(req.inputProps.ratio);
      if (ratio === opts.failRatio) throw new Error("Lambda: ENOMEM at function 7 (s3://bucket/x)");
      return { bytes: new TextEncoder().encode(`mp4:${ratio}`), renderMs: 1234 };
    },
    probe: (bytes) => {
      const ratio = new TextDecoder().decode(bytes).slice(4);
      const size = opts.wrong45 && ratio === "4:5" ? SIZE["1:1"]! : SIZE[ratio]!;
      return { ...size, fps: 30, durationInSeconds: 15 };
    },
    layers: async ({ variant, plan }) => plan.texts[variant].map((b, i) => ({ url: `https://signed.example/layer-${variant}-${i}.png`, fromFrame: b.fromFrame, toFrame: b.toFrame })),
    latestArt: async () => true,
    drive,
    libraryRenders: async (artist) => {
      if (!libraryFolder) libraryFolder = (await drive.createFolder("ROOT", `${artist.name} Renders`)).id;
      return libraryFolder;
    },
    now: () => NOW,
    today: TODAY,
  };
  return { db, drive, deps, renders, uploads };
}

async function startAndRun(s: ReturnType<typeof setup>) {
  const started = await requestPackage(s.db, { ...s.deps, ...fakeStartDeps() }, { userId: MATAS, eventId: EVENT, recipes: ["montage"], source: "lab", approval: null, now: NOW, today: TODAY });
  assert.ok(started.ok);
  const tick = await runPackageTick(s.db, s.deps, { maxAtOnce: 9 });
  const rows = (await s.db.from("creative_lab_renders").select("*")).data as Record<string, unknown>[];
  const pkg = ((await s.db.from("creative_lab_render_packages").select("*")).data as Record<string, unknown>[])[0]!;
  return { tick, rows, pkg };
}

test("a package renders on Lambda as H.264 CRF 18 yuv420p, every file filed in Drive under its own name with the cut sheet beside it, checks on every file", async () => {
  const s = setup();
  const { tick, rows, pkg } = await startAndRun(s);
  assert.equal(tick.claimed, 9);
  assert.equal(tick.done, 9);
  assert.equal(pkg.status, "done");
  assert.equal(s.renders.length, 9);
  for (const r of s.renders) {
    assert.equal(r.composition, "Montage");
    assert.equal(r.crf, 18);
    assert.equal(r.pixelFormat, "yuv420p");
    assert.equal(r.frameCount, 450);
    assert.equal((r.inputProps.segments as unknown[]).length, 16);
  }
  assert.ok(s.renders.filter((r) => (r.inputProps.layers as unknown[]).length === 0).length === 3, "No text has no layers");
  const names = [...s.drive.files.values()].map((f) => f.name);
  for (const r of rows) {
    assert.equal(r.status, "done");
    assert.deepEqual((r.checks as { passed: boolean }).passed, true, String(r.file_name));
    assert.ok(names.includes(String(r.file_name)), `${r.file_name} is in Drive`);
    assert.equal(r.drive_status, "copied");
  }
  assert.ok(names.some((n) => n === "P26-BDAY__offpixel__montage__cut-sheet__r1.txt"), "one cut sheet per package");
  // Shareable (No text, artist material only, passed): a library shortcut and an artist_assets row each.
  const shortcuts = [...s.drive.files.values()].filter((f) => f.mimeType === "application/vnd.google-apps.shortcut");
  assert.equal(shortcuts.length, 3);
  const assets = (await s.db.from("artist_assets").select("*")).data as Record<string, unknown>[];
  assert.equal(assets.length, 3);
  assert.ok(assets.every((a) => a.shareable === true && a.owner_kind === "offpixel" && String(a.asset_key).startsWith("m4_render:")));
});

test("a file that fails Format is done with the failure on its row, keeps its Drive copy, and never joins the library", async () => {
  const s = setup({ wrong45: true });
  const { rows } = await startAndRun(s);
  const bad = rows.filter((r) => r.aspect === "4:5");
  assert.equal(bad.length, 3);
  for (const r of bad) assert.deepEqual((r.checks as { failed: string[] }).failed, ["format"]);
  const shortcuts = [...s.drive.files.values()].filter((f) => f.mimeType === "application/vnd.google-apps.shortcut");
  assert.equal(shortcuts.length, 2, "the 4:5 No text failed, so only 9:16 and 1:1 No text join");
});

test("a render that doesn't finish: the row reads Didn't render, the tick carries on, the package still settles", async () => {
  const s = setup({ failRatio: "1:1" });
  const { tick, rows, pkg } = await startAndRun(s);
  assert.equal(tick.failed, 3);
  assert.equal(rows.filter((r) => r.status === "failed").length, 3);
  assert.equal(pkg.status, "done");
});
