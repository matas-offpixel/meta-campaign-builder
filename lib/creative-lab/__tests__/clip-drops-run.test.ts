/**
 * VW1's run: ffmpeg's arguments, the stored shape, the window it writes, the
 * failure it stores, and a real decode through ffmpeg-static of generated
 * sound (a WAV and an MP4 with a video stream), never a real track.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  FfmpegUnavailable,
  columnsAfterDetection,
  decodeClipSound,
  detectClipDrops,
  dropDecodeArgs,
  dropsNeedCheck,
  noAudioStream,
  parseDurationS,
  storeClipDropsSafely,
  storedFromSound,
  sweepClipDrops,
} from "../clip-drops-run.ts";
import type { ServiceRoleDb } from "../load.ts";

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the service-role client: select / eq / is / gte / order / limit / maybeSingle / update. */
function fakeDb(tables: Record<string, Row[]>) {
  const writes: { table: string; patch: Row; where: [string, unknown][] }[] = [];
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    const where: [string, unknown][] = [];
    let patch: Row | null = null;
    let limit = Infinity;
    const q = {
      select: () => q,
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        where.push([column, value]);
        return q;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (row[column] ?? null) === value);
        return q;
      },
      gte(column: string, value: string) {
        filters.push((row) => String(row[column] ?? "") >= value);
        return q;
      },
      order: () => q,
      limit(n: number) {
        limit = n;
        return q;
      },
      update(p: Row) {
        patch = p;
        return q;
      },
      maybeSingle: async () => ({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      then(resolve: (v: { data: Row[] | null; error: null }) => unknown) {
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (patch) {
          for (const row of rows) Object.assign(row, patch);
          writes.push({ table, patch, where });
          return Promise.resolve(resolve({ data: null, error: null }));
        }
        return Promise.resolve(resolve({ data: rows.slice(0, limit), error: null }));
      },
    };
    return q;
  };
  return { db: { from } as unknown as ServiceRoleDb, tables, writes };
}

/** s16le PCM: `segments` of [seconds, dBFS] as seeded noise scaled per 50 ms (as clip-drops.test.ts). */
function pcm(segments: [number, number][]): Uint8Array {
  let seed = 11;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const step = 800;
  const out: number[] = [];
  for (const [seconds, level] of segments) {
    for (let f = 0; f < Math.round(seconds / 0.05); f += 1) {
      const raw = Array.from({ length: step }, () => random() * 2 - 1);
      const rms = Math.sqrt(raw.reduce((s, v) => s + v * v, 0) / step);
      for (const v of raw) out.push(Math.round((v / rms) * 10 ** (level / 20) * 32767));
    }
  }
  const bytes = new Uint8Array(out.length * 2);
  const view = new DataView(bytes.buffer);
  out.forEach((v, i) => view.setInt16(i * 2, Math.max(-32768, Math.min(32767, v)), true));
  return bytes;
}

const BANNER = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x':\n  Duration: 00:00:42.00, start: 0.000000, bitrate: 2000 kb/s\n";

describe("VW1's ffmpeg", () => {
  it("decodes the first audio stream only, never video or cover art, to mono 16 kHz on stdout", () => {
    const args = dropDecodeArgs("https://x/clip.mp4");
    assert.deepEqual(args.slice(args.indexOf("-vn"), args.indexOf("-vn") + 5), ["-vn", "-sn", "-dn", "-map", "0:a:0"]);
    assert.ok(args.includes("-ac") && args[args.indexOf("-ac") + 1] === "1");
    assert.equal(args[args.indexOf("-ar") + 1], "16000");
    assert.equal(args.at(-1), "pipe:1");
    assert.ok(!args.includes("-y"), "writes no file");
  });

  it("reads the container's length and a missing audio stream from stderr", () => {
    assert.equal(parseDurationS(BANNER), 42);
    assert.equal(parseDurationS("nothing"), null);
    assert.equal(noAudioStream("Stream map '0:a:0' matches no streams.\nTo ignore this, add a trailing '?' to the map."), true);
    assert.equal(noAudioStream(BANNER), false);
  });
});

describe("what a detection stores", () => {
  it("stores the drops and the clip's length from the banner", () => {
    const drops = storedFromSound({ pcm: pcm([[16.4, -32], [25.6, -21]]), stderr: BANNER, noAudio: false }, "asset-1");
    assert.equal(drops.status, "ok");
    if (drops.status !== "ok") return;
    assert.equal(drops.assetId, "asset-1");
    assert.equal(drops.durationS, 42);
    assert.equal(drops.candidates.length, 1);
    assert.ok(Math.abs(drops.mainS! - 16.4) <= 0.1 + 1e-9);
    assert.equal(drops.hasSound, true);
  });

  it("no audio stream is no sound", () => {
    const drops = storedFromSound({ pcm: new Uint8Array(0), stderr: BANNER, noAudio: true }, "a");
    assert.deepEqual(drops, { v: 1, status: "ok", assetId: "a", durationS: 42, hasSound: false, lufs: null, candidates: [], mainS: null, peaks: [] });
  });

  it("writes VW2's window on VW7's main drop into in_s / out_s; a hand-set window that still fits is kept with its drop (VW9)", () => {
    const drops = { v: 1 as const, status: "ok" as const, assetId: "a", durationS: 42, hasSound: true, lufs: -12, candidates: [{ tS: 16.4, riseDb: 11 }, { tS: 31.2, riseDb: 8 }], mainS: 31.2, peaks: [] };
    const now = new Date("2026-11-17T12:00:00Z");
    assert.deepEqual(columnsAfterDetection(drops, { in_s: 0, out_s: 30, window_by_hand: false }, now), {
      drops,
      drops_at: "2026-11-17T12:00:00.000Z",
      in_s: 27,
      out_s: 42,
      window_drop_s: null,
      window_by_hand: false,
    });
    // A hand-set window on 0:16.4 is kept, with its drop, though the main drop is now 0:31.2.
    assert.deepEqual(columnsAfterDetection(drops, { in_s: 12.9, out_s: 30.9, window_by_hand: true, window_drop_s: 16.4 }, now), {
      drops,
      drops_at: "2026-11-17T12:00:00.000Z",
      in_s: 12.9,
      out_s: 30.9,
      window_drop_s: 16.4,
      window_by_hand: true,
    });
    const onMain = columnsAfterDetection(drops, { in_s: 26.7, out_s: 41.7, window_by_hand: true, window_drop_s: 31.2 }, now);
    assert.deepEqual([onMain.in_s, onMain.out_s, onMain.window_drop_s, onMain.window_by_hand], [26.7, 41.7, 31.2, true]);
    // One that no longer fits the clip falls back to that drop's default, which is the detected window.
    const stale = columnsAfterDetection(drops, { in_s: 27.7, out_s: 45, window_by_hand: true, window_drop_s: 31.2 }, now);
    assert.deepEqual([stale.in_s, stale.out_s, stale.window_drop_s, stale.window_by_hand], [27, 42, null, false]);
  });

  it("a refused clip keeps its stored in/out and loses any choice", () => {
    const drops = { v: 1 as const, status: "ok" as const, assetId: "a", durationS: 12.6, hasSound: true, lufs: -12, candidates: [{ tS: 5, riseDb: 9 }], mainS: 5, peaks: [] };
    const cols = columnsAfterDetection(drops, { in_s: null, out_s: null, window_by_hand: true }, new Date(0));
    assert.equal("in_s" in cols, false);
    assert.equal(cols.window_by_hand, false);
    assert.equal(cols.window_drop_s, null);
  });
});

describe("the run against the clip row", () => {
  const tables = () => ({
    creative_lab_clips: [
      { id: "c1", creative_asset_id: "orig", render_asset_id: "copy", in_s: 0, out_s: 30, window_by_hand: false, window_drop_s: null, created_at: "2026-11-17T10:00:00Z", drops: null, triple_fit_source_id: null },
      { id: "made", creative_asset_id: "orig", render_asset_id: null, in_s: 0, out_s: 30, triple_fit_source_id: "c1", created_at: "2026-11-17T10:00:00Z", drops: null },
    ] as Row[],
    creative_assets: [
      { id: "orig", storage_bucket: "campaign-assets", storage_path: "videos/orig.mp4" },
      { id: "copy", storage_bucket: "campaign-assets", storage_path: "videos/copy.mp4" },
    ] as Row[],
  });

  it("reads the render copy, stores the drops, and moves the made triple-fit's window with it", async () => {
    const fake = fakeDb(tables());
    const signed: string[] = [];
    const result = await storeClipDropsSafely(fake.db, "c1", {
      sign: async (bucket, p) => {
        signed.push(`${bucket}/${p}`);
        return `https://signed/${p}?token=secret`;
      },
      decode: async (url) => {
        assert.equal(url, "https://signed/videos/copy.mp4?token=secret");
        return { pcm: pcm([[16.4, -32], [25.6, -21]]), stderr: BANNER, noAudio: false };
      },
      now: () => new Date("2026-11-17T12:00:00Z"),
    });
    assert.deepEqual(signed, ["campaign-assets/videos/copy.mp4"]);
    assert.equal(result?.status, "ok");
    const clip = fake.tables.creative_lab_clips[0]!;
    const made = fake.tables.creative_lab_clips[1]!;
    assert.equal((clip.drops as { assetId: string }).assetId, "copy");
    assert.ok(Math.abs(Number(clip.in_s) - 12.4) <= 0.1 + 1e-9);
    assert.equal(Math.round((Number(clip.out_s) - Number(clip.in_s)) * 1000) / 1000, 16);
    assert.deepEqual([made.in_s, made.out_s], [clip.in_s, clip.out_s]);
    assert.equal(dropsNeedCheck(clip), false);
    assert.equal(dropsNeedCheck({ ...clip, render_asset_id: "another-copy" }), true);
  });

  it("stores a failed decode, without the URL, and never throws", async () => {
    const fake = fakeDb(tables());
    const result = await storeClipDropsSafely(fake.db, "c1", {
      sign: async () => "https://signed/x?token=secret",
      decode: async () => {
        throw new Error("ffmpeg: https://signed/x?token=secret: Invalid data found when processing input");
      },
      now: () => new Date(0),
    });
    assert.equal(result?.status, "failed");
    const stored = JSON.stringify(fake.tables.creative_lab_clips[0]!.drops);
    assert.ok(!stored.includes("secret"), stored);
    assert.ok(stored.includes("Invalid data"));
    assert.equal(dropsNeedCheck(fake.tables.creative_lab_clips[0]!), true);
  });

  it("stores nothing when ffmpeg isn't on this function", async () => {
    const fake = fakeDb(tables());
    const result = await storeClipDropsSafely(fake.db, "c1", {
      sign: async () => "https://signed/x",
      decode: async () => {
        throw new FfmpegUnavailable();
      },
    });
    assert.equal(result, null);
    assert.equal(fake.tables.creative_lab_clips[0]!.drops, null);
    assert.equal(fake.writes.length, 0);
  });

  it("refuses a clip whose file isn't in Storage", async () => {
    const t = tables();
    t.creative_assets[1]!.storage_path = null;
    await assert.rejects(detectClipDrops(fakeDb(t).db, "c1", { sign: async () => "x", decode: async () => ({ pcm: new Uint8Array(0), stderr: "", noAudio: true }) }), /isn't in Storage/);
  });

  it("the sweep checks unchecked clips from the last 48 h, never a made triple-fit", async () => {
    const t = tables();
    t.creative_lab_clips.push({ id: "old", creative_asset_id: "orig", created_at: "2026-11-01T00:00:00Z", drops: null, triple_fit_source_id: null });
    const fake = fakeDb(t);
    const seen: string[] = [];
    const out = await sweepClipDrops(fake.db, {
      limit: 6,
      now: new Date("2026-11-17T12:00:00Z"),
      deps: {
        sign: async (_b, p) => p,
        decode: async (url) => {
          seen.push(url);
          return { pcm: pcm([[30, -20]]), stderr: BANNER, noAudio: false };
        },
      },
    });
    assert.deepEqual(seen, ["videos/copy.mp4"]);
    assert.deepEqual(out, { checked: 1, refused: 1, failed: 0 });
  });
});

const ffmpegPath = (() => {
  try {
    const resolved = createRequire(import.meta.url)("ffmpeg-static") as string | null;
    return resolved && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
})();

describe("decodeClipSound with ffmpeg-static", { skip: ffmpegPath ? false : "no ffmpeg-static binary" }, () => {
  it("decodes a generated clip with a video stream and finds its drop; a silent-track-free file is no sound", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "drops-"));
    try {
      const withSound = path.join(dir, "drop.mp4");
      // 20 s: pink noise at −34 dB for 8 s, then at −22 dB, over a test-pattern video stream.
      execFileSync(ffmpegPath!, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10:duration=20",
        "-f", "lavfi", "-i", "anoisesrc=color=pink:seed=3:amplitude=1:duration=20:sample_rate=44100",
        "-filter_complex", "[1:a]volume='if(lt(t,8),0.02,0.08)':eval=frame[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", withSound,
      ]);
      const decoded = await decodeClipSound(withSound);
      assert.equal(decoded.noAudio, false);
      const drops = storedFromSound(decoded, "a");
      assert.equal(drops.status, "ok");
      if (drops.status !== "ok") return;
      assert.ok(Math.abs(drops.durationS - 20) < 0.2, `${drops.durationS}`);
      assert.equal(drops.candidates.length, 1, JSON.stringify(drops.candidates));
      assert.ok(Math.abs(drops.mainS! - 8) <= 0.15, `${drops.mainS}`);

      const silentVideo = path.join(dir, "video-only.mp4");
      execFileSync(ffmpegPath!, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10:duration=3", "-c:v", "libx264", "-preset", "ultrafast", silentVideo]);
      const none = await decodeClipSound(silentVideo);
      assert.equal(none.noAudio, true);
      assert.equal(storedFromSound(none, "a").status === "ok" && (storedFromSound(none, "a") as { hasSound: boolean }).hasSound, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
