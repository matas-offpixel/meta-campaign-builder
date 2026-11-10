import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MASTER, RECT_45, type Piece, type Rect } from "../artist-card.ts";
import { SAMPLE_ROLL_CALL } from "../claim-approval.ts";
import { backingAlphaAt } from "../red-backing.ts";
import { planClaim, splitTwo, type ClaimPlan } from "../claim-slot.ts";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { KIT_FACES, providedFace } from "../kit-faces.ts";
import { KIT_FONT_BUCKET, KIT_FONT_URL_TTL_S, KitFaceHeldError, didNotLoad, kitFontPath, renderT1ClipOnLambda, withKitFace, type KitFaceDeps } from "../t1-lambda.ts";
import {
  FORMAT_SIZE,
  MIN_CLAIM_CLIP_S,
  T1C,
  T1V_LINES,
  assignUse,
  captionT1Conflicts,
  chooseCrop,
  claimAllowed,
  claimBlockRect,
  claimOpacity,
  footageWindow,
  insideVideoSafe,
  judgeContrastOverClip,
  judgeFaceOverTime,
  moveRect,
  planVideoClaim,
  releaseNamesOf,
  sampleTimes,
  typeTransform,
  backingRect,
  chooseBacking,
  chooseStep,
  clipBandStops,
  clipBands,
  countedFaces,
  formatTooSmall,
  planClipLayout,
  type ContrastSample,
  type FaceSample,
  type VideoClaimPlan,
} from "../t1-video.ts";
import { sampleStops } from "../t2-render.ts";
import { BAND_KNEE_ROWS_916, MAX_KNEE_STEP, MAX_ROW_STEP, VIDEO_GRADIENT_SHADOW, VIDEO_STOPS_45, VIDEO_STOPS_916, blueNoise, maxRowStep, overFlatGrey, renderVideoBands, rowMeanLuma } from "../video-bands.ts";
import { bandAlphaAt } from "../overlay-gradient.ts";

/** A Bootzy-like fake width: 0.35 cap per character. */
const measure = (t: string, cap: number) => t.length * 0.35 * cap;
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const BOOTZY = "BootzyCondensedTM-Regular";

describe("H36 · O37 the claim's entrance", () => {
  it("a 4.7 s clip has no claim, with the record's line; 4.75 s is the minimum", () => {
    assert.deepEqual(claimAllowed(4.7), { ok: false, line: "Clip too short for a claim — needs 4.75 s" });
    assert.equal(T1V_LINES.tooShort, "Clip too short for a claim — needs 4.75 s");
    close(MIN_CLAIM_CLIP_S, 4.75);
    assert.deepEqual(claimAllowed(4.75), { ok: true });
  });

  it("a 12 s clip's claim is at 0 % at 1.49 s and 100 % at 1.75 s, linear between, and holds to the end", () => {
    assert.equal(claimOpacity(0), 0);
    assert.equal(claimOpacity(1.49), 0);
    assert.equal(claimOpacity(1.5), 0);
    close(claimOpacity(1.625), 0.5);
    assert.equal(claimOpacity(1.75), 1);
    assert.equal(claimOpacity(11.99), 1);
  });
});

describe("H37 · O38 the bands on a clip", () => {
  const W = 1080;
  const layer = renderVideoBands(W, 1920);
  it("the 9:16 stops are within ±1 % on 3 × 3 averages; 0.53–0.55 H is clear", () => {
    const got = sampleStops(layer, MASTER, 4, VIDEO_STOPS_916);
    for (const s of got) assert.ok(s.ok, `${s.at} H read ${s.got} % (want ${s.want})`);
    assert.deepEqual(VIDEO_STOPS_916.filter(([f]) => f >= 0.53 && f <= 0.55).map(([, a]) => a), [0, 0, 0]);
  });

  it("carried into the 4:5 and the 1:1 as the type is (O25)", async () => {
    const sharp = ((await import("sharp")) as unknown as { default: typeof import("sharp") }).default;
    const png = await sharp(Buffer.from(layer), { raw: { width: W, height: 1920, channels: 4 } }).png().toBuffer();
    const c45 = await sharp(png).extract({ left: 0, top: RECT_45.top, width: W, height: RECT_45.bottom - RECT_45.top }).raw().toBuffer({ resolveWithObject: true });
    for (const s of sampleStops(c45.data, { width: W, height: 1350 }, 4, VIDEO_STOPS_45)) assert.ok(s.ok, `4:5 ${s.at} read ${s.got} (want ${s.want})`);
    const sq = await sharp(png).extract({ left: 0, top: RECT_45.top, width: W, height: 1350 }).resize(1080, 1080, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    for (const s of sampleStops(sq.data, { width: 1080, height: 1080 }, sq.info.channels, VIDEO_STOPS_45)) assert.ok(s.ok, `1:1 ${s.at} read ${s.got} (want ${s.want})`);
  });
});

describe("H38 · O39 the face over time", () => {
  // A 12 s clip at 5 samples a second. The face drifts down through the claim box between 3 s and 4 s on the clip's own crop.
  const top: Rect = { left: 120, top: 361, width: 840, height: 500 };
  const claim: Rect = { left: 300, top: 1060, width: 480, height: 188 };
  const samplesAt = (shiftY: number): FaceSample[] =>
    sampleTimes(12).map((tS) => ({ tS, faces: [{ left: 420, top: (tS >= 3 && tS < 4 ? 1000 : 1300) + shiftY, width: 240, height: 240 }, { left: 900, top: 100, width: 60, height: 60 }] }));

  it("a fixture clip with the face crossing the claim for 1 s is refused with the record's line", () => {
    const v = judgeFaceOverTime(samplesAt(0), { always: [top], claim });
    assert.equal(v.ok, false);
    close(v.longestRunS, 1);
    assert.equal(v.line, T1V_LINES.face(Math.round(v.claimShare * 100)));
    assert.match(v.line!, /^Face in the type for \d+ % of the claim's time — choose another crop or clip$/);
  });

  it("the same clip passes on a lower crop, which is tried before the clip is refused", () => {
    const pick = chooseCrop([0, 300], (shift) => judgeFaceOverTime(samplesAt(shift), { always: [top], claim }));
    assert.equal(pick.crop, 300);
    assert.ok(pick.verdict.ok);
    const none = chooseCrop([0], (shift) => judgeFaceOverTime(samplesAt(shift), { always: [top], claim }));
    assert.equal(none.crop, null);
  });

  it("≤ 10 % of samples and never more than 0.5 s in a row; faces under half the main face's width don't count", () => {
    // Two samples (0.4 s) in the claim: inside both limits.
    const s: FaceSample[] = sampleTimes(12).map((tS) => ({ tS, faces: [{ left: 420, top: tS >= 5 && tS < 5.4 ? 1100 : 1350, width: 240, height: 240 }] }));
    assert.ok(judgeFaceOverTime(s, { always: [top], claim }).ok);
    const small: FaceSample[] = sampleTimes(12).map((tS) => ({ tS, faces: [{ left: 420, top: 1350, width: 240, height: 240 }, { left: 500, top: 1100, width: 100, height: 100 }] }));
    assert.ok(judgeFaceOverTime(small, { always: [top], claim }).ok);
  });
});

describe("H39 · O40 contrast over the clip", () => {
  const samples = (failShare: number): ContrastSample[] => {
    const ts = sampleTimes(20);
    const claimTs = ts.filter((t) => t > 1.5);
    const fails = Math.round(claimTs.length * failShare);
    return ts.map((tS) => {
      const i = claimTs.indexOf(tS);
      return { tS, topBlock: 0.02, claimBox: 0.05, redInk: i >= 0 && i < fails ? 0.6 : 0.05 };
    });
  };

  it("a clip whose red fails in 3 % of samples stays red", () => {
    const v = judgeContrastOverClip(samples(0.03));
    assert.equal(v.red, true);
    assert.deepEqual(v.approvalLines, []);
  });

  it("one failing in 10 % turns white for the whole clip, with the clip's approval line", () => {
    const v = judgeContrastOverClip(samples(0.1));
    assert.equal(v.red, false);
    assert.deepEqual(v.approvalLines, ["claim line 1 in white — red unreadable on this clip"]);
  });

  it("the figure is the p95 by nearest rank over the samples in which the type is on screen", () => {
    const v = judgeContrastOverClip([{ tS: 0, topBlock: 0.5, claimBox: 0.9, redInk: 0.9 }, ...sampleTimes(10).slice(10).map((tS) => ({ tS, topBlock: 0.02, claimBox: 0.05, redInk: 0.05 }))]);
    assert.equal(v.claimBoxP95, 0.05);
    assert.equal(v.red, true);
  });
});

const piece = (w: number, h: number, cap: number, label: string): Piece => ({ png: Buffer.alloc(0), width: w, height: h, capPx: cap, label });
const pieces = { lockup: piece(1290, 388, 0, "lockup"), name: piece(1000, 220, 220, "name"), date: piece(800, 60, 60, "date"), claim: planVideoClaim("General sale live", measure) as VideoClaimPlan };

describe("H40 · O41 / O42 the crop moves the footage, never the type", () => {
  const plan = planVideoClaim("General sale live", measure) as VideoClaimPlan;
  it("moving crop_focus_y moves the footage window and no slot", () => {
    const src = { width: 1080, height: 2400 };
    const a = footageWindow(src, "9:16", 0.3);
    const b = footageWindow(src, "9:16", 0.7);
    assert.notEqual(a.top, b.top);
    for (const f of ["9:16", "4:5", "1:1"] as const) {
      const t = typeTransform(f);
      assert.deepEqual(moveRect(claimBlockRect(plan), t), moveRect(claimBlockRect(plan), typeTransform(f)));
      // O54's layout takes no crop at all: the same pieces give the same boxes whatever the footage does.
      assert.deepEqual(planClipLayout(pieces, f, "A").boxes, planClipLayout(pieces, f, "A").boxes);
      assert.ok(!("cropFocusY" in t));
    }
  });

  it("the 1:1 is a crop: a 1080-wide 9:16 source gives a 1080 × 1080 window, never padded", () => {
    const w = footageWindow({ width: 1080, height: 1920 }, "1:1", 0.5);
    assert.deepEqual([w.width, w.height], [1080, 1080]);
    const low = footageWindow({ width: 1080, height: 1920 }, "1:1", 1);
    assert.equal(low.top + low.height, 1920);
    const w45 = footageWindow({ width: 1080, height: 1920 }, "4:5", 0.5);
    assert.deepEqual([w45.width, w45.height], [1080, 1350]);
    assert.deepEqual(FORMAT_SIZE["1:1"], { width: 1080, height: 1080 });
  });

  it("the type in the 1:1 is the 4:5 at the 0.8× re-sit", () => {
    assert.deepEqual(typeTransform("1:1"), { k: 0.8, dx: 108, dy: -228 });
    assert.deepEqual(typeTransform("4:5"), { k: 1, dx: 0, dy: -285 });
  });
});

describe("O43 · the claim on a clip", () => {
  it("the claim's last line sits on 0.65 H; one line has its cap top at 0.610 H, two lines' line 1 at 0.552 H", () => {
    const one = planVideoClaim("General sale live", measure) as VideoClaimPlan;
    assert.equal(one.step, 0);
    close(one.lines[0]!.capTop + one.lines[0]!.capPx, 0.65 * 1920);
    close(one.lines[0]!.capTop / 1920, 0.61, 1e-9);
    const two = planVideoClaim("Final release tickets now on sale everywhere", measure) as VideoClaimPlan;
    assert.equal(two.step, 1);
    close(two.lines[0]!.capTop / 1920, 0.5517, 1e-9);
    close(two.lines[1]!.capTop + two.lines[1]!.capPx, 1248);
    assert.ok(two.lines.every((l) => l.widthPx <= 840));
  });

  it("the roll-call keeps its lockup on a clip: line 1 red at 0.625 of line 2's cap; line 1 never shortened", () => {
    const p = planVideoClaim("Early bird, 1st & 2nd release sold out\n3rd release selling fast", measure) as VideoClaimPlan;
    assert.deepEqual(p.lines.map((l) => l.color), ["red", "white"]);
    close(p.lines[0]!.capPx / p.lines[1]!.capPx, 0.217 / 0.347);
    assert.equal(p.lines[0]!.text, "EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT");
  });
});

describe("H42 · O44 a caption or T1, never both", () => {
  it("no render carries both: conflicts are found, and assignment refuses either way round", () => {
    assert.deepEqual(captionT1Conflicts([{ clipId: "a", use: "caption" }, { clipId: "a", use: "t1" }, { clipId: "b", use: "t1" }]), ["a"]);
    assert.deepEqual(assignUse([{ clipId: "a", use: "caption" }], { clipId: "a", use: "t1" }), { ok: false, line: "A clip takes a UGC caption or T1, never both" });
    assert.deepEqual(assignUse([{ clipId: "a", use: "t1" }], { clipId: "a", use: "caption" }), { ok: false, line: "A clip takes a UGC caption or T1, never both" });
    assert.deepEqual(assignUse([{ clipId: "a", use: "t1" }], { clipId: "b", use: "caption" }), { ok: true });
  });
});

/** A minimal OpenType file holding only a name table with this PostScript name (no glyphs: never a usable font). */
function fakeFace(postscriptName: string): Uint8Array {
  const str = Buffer.from(postscriptName, "utf16le").swap16();
  const name = Buffer.alloc(6 + 12 + str.length);
  name.writeUInt16BE(0, 0);
  name.writeUInt16BE(1, 2);
  name.writeUInt16BE(18, 4);
  name.writeUInt16BE(3, 6);
  name.writeUInt16BE(1, 8);
  name.writeUInt16BE(0x409, 10);
  name.writeUInt16BE(6, 12);
  name.writeUInt16BE(str.length, 14);
  name.writeUInt16BE(0, 16);
  str.copy(name, 18);
  const head = Buffer.alloc(12 + 16);
  head.writeUInt32BE(0x4f54544f, 0);
  head.writeUInt16BE(1, 4);
  head.write("name", 12, "latin1");
  head.writeUInt32BE(28, 20);
  head.writeUInt32BE(name.length, 24);
  return new Uint8Array(Buffer.concat([head, name]));
}

describe("H47–H49 · issue 7: a provided face is cleared; delivery is a per-render signed URL", () => {
  const face = { postscriptName: BOOTZY, path: kitFontPath("92f7334b-ef76-4095-88d6-f422ba1ff3f2", BOOTZY, "otf") };
  const depsFor = (bytes: Uint8Array | null, seen: { ttl?: number; bucket?: string } = {}): KitFaceDeps => ({
    signUrl: async (bucket, _path, ttl) => {
      seen.ttl = ttl;
      seen.bucket = bucket;
      return "https://storage.example/signed?token=SECRET";
    },
    fetchBytes: async () => bytes,
  });

  it("the face lives under the client's kit in the private bucket, signed for at most an hour", async () => {
    assert.equal(face.path, `92f7334b-ef76-4095-88d6-f422ba1ff3f2/${BOOTZY}.otf`);
    assert.throws(() => kitFontPath("puzzle", BOOTZY, "otf"));
    const seen: { ttl?: number; bucket?: string } = {};
    await withKitFace(face, depsFor(fakeFace(BOOTZY), seen), async () => null);
    assert.equal(seen.bucket, KIT_FONT_BUCKET);
    assert.ok(seen.ttl! <= 3600 && KIT_FONT_URL_TTL_S === 3600);
  });

  it("a Lambda render of a T1 clip with a provided face is not held; the type is set from the fetched file, then removed", async () => {
    let fileSeen = "";
    const out = await renderT1ClipOnLambda({ clipId: "c", durationS: 12, claim: "General sale live" }, face, {
      ...depsFor(fakeFace(BOOTZY)),
      setType: async (_req, file) => {
        fileSeen = file;
        assert.ok(existsSync(file));
        return { topUrl: "top.png", claimUrl: "claim.png" };
      },
      renderOnLambda: async (req, layers) => ({ req, layers }),
    });
    assert.equal(out.claimDropped, null);
    assert.deepEqual(out.rendered.layers, { topUrl: "top.png", claimUrl: "claim.png" });
    assert.equal(existsSync(fileSeen), false);
    const short = await renderT1ClipOnLambda({ clipId: "c", durationS: 4.7, claim: "General sale live" }, face, { ...depsFor(fakeFace(BOOTZY)), setType: async () => ({ topUrl: "t", claimUrl: null }), renderOnLambda: async (req) => req.claim });
    assert.deepEqual(short, { rendered: null, claimDropped: "Clip too short for a claim — needs 4.75 s" });
  });

  it("a missing or wrong face stops the render with the held line, before any type is set or any frame drawn", async () => {
    for (const bytes of [null, fakeFace("SomeOtherFace-Regular"), new Uint8Array([1, 2, 3])]) {
      let set = 0;
      let rendered = 0;
      await assert.rejects(
        renderT1ClipOnLambda({ clipId: "c", durationS: 12, claim: null }, face, { ...depsFor(bytes), setType: async () => ((set += 1), { topUrl: "", claimUrl: null }), renderOnLambda: async () => (rendered += 1) }),
        (e: unknown) => e instanceof KitFaceHeldError && e.message === didNotLoad(BOOTZY),
      );
      assert.deepEqual([set, rendered], [0, 0]);
    }
    assert.equal(didNotLoad(BOOTZY), `Held — ${BOOTZY} didn't load for this render · retry`);
  });

  it("the signed URL appears in no log line", async () => {
    const lines: string[] = [];
    const orig = [console.log, console.info, console.warn, console.error];
    console.log = console.info = console.warn = console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    try {
      await withKitFace(face, depsFor(fakeFace(BOOTZY)), async () => null);
      await withKitFace(face, depsFor(null), async () => null).catch(() => null);
    } finally {
      [console.log, console.info, console.warn, console.error] = orig;
    }
    assert.ok(lines.every((l) => !l.includes("SECRET")));
  });

  it("O51: Puzzle's kit holds Bootzy, recorded as supplied by the client; a face the client didn't supply is in no kit", () => {
    const f = providedFace("92f7334b-ef76-4095-88d6-f422ba1ff3f2", BOOTZY)!;
    assert.equal(f.source.from, "client");
    assert.deepEqual([f.source.recordedBy, f.source.at], ["Matas", "2026-11-10"]);
    assert.deepEqual(f.storage, { bucket: KIT_FONT_BUCKET, path: face.path });
    assert.equal(providedFace("92f7334b-ef76-4095-88d6-f422ba1ff3f2", "AeroportMono-Regular"), null);
    assert.equal(KIT_FACES.every((k) => k.source.from === "client"), true);
  });

  it("O50: none of O45's four phrases is in the app or the Lab", () => {
    const phrases = ["Licence · Add proof", "_Brand kit / Licences", "Licence recorded · server · video", "licence for server rendering not recorded"];
    const roots = ["app", "components", "lib", "src", "scripts"].map((d) => join(process.cwd(), d)).filter(existsSync);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        if (n === "node_modules" || n.startsWith(".")) continue;
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mts)$/.test(n) && !p.endsWith("t1-video.test.ts") && phrases.some((ph) => readFileSync(p, "utf8").includes(ph))) hits.push(p);
      }
    };
    roots.forEach(walk);
    assert.deepEqual(hits, []);
  });

  it("H49: no font file is committed outside the app's own UI fonts, and none sits in the Remotion site's source or public folder", () => {
    let tracked: string[] = [];
    try {
      tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter((f) => /\.(otf|ttf|ttc|otc|woff2?)$/i.test(f));
    } catch {
      return;
    }
    assert.deepEqual(tracked.filter((f) => !/^src\/remotion\/fonts\/TikTokSans/.test(f)), []);
    assert.ok(tracked.every((f) => !f.startsWith("public/")));
  });
});

describe("H45 · O46 dithering the bands", () => {
  it("the blue-noise map is fixed (the same every call) and spans [0, 1) evenly", () => {
    const a = blueNoise(32);
    const b = blueNoise(32);
    assert.deepEqual(a, b);
    assert.equal(new Set(a).size, 1024);
    close(a.reduce((s, v) => s + v, 0) / a.length, 0.5, 1e-9);
  });

  it("over a flat mid-grey, no step between adjacent rows' mean luma larger than 2 levels across the fades; J2's knees are reported", () => {
    const w = 1080;
    const h = 1920;
    const grey = overFlatGrey(renderVideoBands(w, h), w, h);
    const means = rowMeanLuma(grey, w, h, 3);
    const steps = Array.from(means, (m, y) => (y ? Math.abs(m - means[y - 1]!) : 0));
    const fades = steps.filter((_, y) => !BAND_KNEE_ROWS_916.includes(y));
    assert.ok(Math.max(...fades) <= MAX_ROW_STEP, `step ${Math.max(...fades)}`);
    // The knees: J2 drops 10 % of the band's opacity inside one row (2 % alpha: about 2.6 levels on 128 grey at 0.60 H).
    const knees = BAND_KNEE_ROWS_916.map((y) => steps[y]!);
    assert.ok(knees.every((k) => k > MAX_ROW_STEP && k <= MAX_KNEE_STEP), knees.join(", "));
    assert.equal(maxRowStep(means).row, 1152);
  });

  it("each dithered pixel is within one level of its exact 16-bit value, and the error averages out", () => {
    const w = 256;
    const h = 1920;
    const d = renderVideoBands(w, h);
    let sum = 0;
    for (let y = 0; y < h; y += 1) {
      let a = 0;
      for (const band of VIDEO_GRADIENT_SHADOW.bands) {
        const ba = bandAlphaAt(band, y, h);
        if (ba > 0) a = ba + a * (1 - ba);
      }
      const exact = Math.round(a * 65535) / 257;
      for (let x = 0; x < w; x += 1) {
        const e = d[(y * w + x) * 4 + 3]! - exact;
        assert.ok(Math.abs(e) < 1, `${y},${x}: ${e}`);
        sum += e;
      }
    }
    assert.ok(Math.abs(sum / (w * h)) < 0.01, String(sum / (w * h)));
  });
});

describe("H46 · O48 the event's release names on T1", () => {
  it("with an \"Early entry\" release, a T1 split never falls between EARLY and ENTRY", () => {
    const names = releaseNamesOf([{ name: "General sale", position: 2 }, { name: "Early entry", position: 1 }, { name: null }]);
    assert.deepEqual(names, ["Early entry", "General sale"]);
    // Without the names the most even break is EARLY | ENTRY.
    assert.deepEqual(splitTwo("TICKETS FOR EARLY ENTRY ON SALE"), ["TICKETS FOR EARLY", "ENTRY ON SALE"]);
    assert.deepEqual(splitTwo("TICKETS FOR EARLY ENTRY ON SALE", names), ["TICKETS FOR", "EARLY ENTRY ON SALE"]);
    const ok = { approvedBy: "m", approvedAt: "2026-11-10" };
    const p = planClaim({ kind: "claim", text: "Last tickets for early entry are on sale now at the door", releaseNames: names, ...ok }) as ClaimPlan;
    assert.equal(p.lines.length, 2);
    assert.ok(!(/\bEARLY$/.test(p.lines[0]!.text) && /^ENTRY\b/.test(p.lines[1]!.text)), p.lines.map((l) => l.text).join(" | "));
    const v = planVideoClaim("Last tickets for early entry are on sale now at the door", measure, { releaseNames: names }) as VideoClaimPlan;
    assert.ok(!(/\bEARLY$/.test(v.lines[0]!.text) && /^ENTRY\b/.test(v.lines[1]?.text ?? "")), v.lines.map((l) => l.text).join(" | "));
  });
});

// ─── Issue 8 (H53–H61) ──────────────────────────────────────────────────────

describe("H53 · O54 the clip layout", () => {
  it("A: the lockup, name and date inside 0.145–0.32 H, then the claim; no venue or time on a clip", () => {
    const a = planClipLayout(pieces, "9:16", "A");
    assert.deepEqual(Object.keys(a.pieces).sort(), ["date", "lockup", "name"]);
    close(a.boxes.lockup!.top / 1920, 0.145);
    close(a.boxes.lockup!.width, 0.25 * 1080);
    close(a.pieces.name.at.top / 1920, 0.205);
    close(a.pieces.name.at.height, 0.07 * 1920);
    close(a.pieces.date.at.top / 1920, 0.29);
    assert.ok(a.boxes.top.top >= 0.145 * 1920 - 1e-6 && a.boxes.top.top + a.boxes.top.height <= 0.32 * 1920 + 1e-6);
    assert.deepEqual(a.boxes.bottom, a.boxes.claim);
  });

  it("B: the top block inside 0.145–0.275 H; the date's baseline 0.015 H above the claim's first cap top", () => {
    const b = planClipLayout(pieces, "9:16", "B");
    assert.ok(b.boxes.top.top + b.boxes.top.height <= 0.275 * 1920 + 1e-6);
    close(b.pieces.date.at.top + b.pieces.date.at.height, b.claim[0]!.capTop - 0.015 * 1920);
    close(b.pieces.date.at.top / 1920, 0.565, 1e-3);
    const two = planClipLayout({ ...pieces, claim: planVideoClaim("Early bird, 1st & 2nd release sold out\n3rd release selling fast", measure) as VideoClaimPlan }, "9:16", "B");
    assert.ok(two.pieces.date.at.top + two.pieces.date.at.height < two.claim[0]!.capTop);
  });

  it("4:5 and 1:1: the lockup's top on 0.05 of the rectangle and the claim's last baseline on 0.90, the 1:1 at 0.8×", () => {
    for (const f of ["4:5", "1:1"] as const) {
      const l = planClipLayout(pieces, f, "A");
      close(l.boxes.lockup!.top / l.size.height, 0.05);
      close((l.claim[0]!.capTop + l.claim[0]!.capPx) / l.size.height, 0.9);
    }
    close(planClipLayout(pieces, "1:1", "A").pieces.name.at.height, 0.07 * 1920 * 0.8);
  });

  it("every 9:16 type box inside the video safe area, the name within 840 px", () => {
    for (const arr of ["A", "B"] as const) {
      const l = planClipLayout({ ...pieces, name: piece(1600, 220, 220, "wide name") }, "9:16", arr);
      const boxes = [l.boxes.lockup!, l.pieces.name.at, l.pieces.date.at, ...l.claim.map((c) => ({ left: (1080 - c.widthPx) / 2, top: c.capTop, width: c.widthPx, height: c.capPx }))];
      assert.ok(insideVideoSafe(boxes).ok, arr);
      assert.ok(l.pieces.name.at.width <= 840 + 1e-6);
    }
  });
});

describe("H54 · O55 the bands follow the blocks", () => {
  it("a one-line claim in A gives O38's 0.55 / 0.60 / 0.68 H; B's are 0.505 / 0.555 / 0.635", () => {
    const a = planClipLayout(pieces, "9:16", "A").anchors;
    close(a.bottomZero / 1920, 0.55, 1e-9);
    close(a.bottomFull / 1920, 0.6, 1e-9);
    close(a.bottomRamp / 1920, 0.68, 1e-9);
    const b = planClipLayout(pieces, "9:16", "B").anchors;
    close(b.bottomZero / 1920, 0.505, 2e-3);
    close(b.bottomFull / 1920, 0.555, 2e-3);
    close(b.bottomRamp / 1920, 0.635, 2e-3);
    close(a.topFull / 1920, 0.34, 2e-3);
    close(a.topGone / 1920, 0.43, 2e-3);
  });

  it("A's and B's stops read within ±1 % on 3 × 3 averages in every format, at each band step", () => {
    for (const f of ["9:16", "4:5", "1:1"] as const) {
      for (const arr of ["A", "B"] as const) {
        for (const step of T1C.bandSteps) {
          const l = planClipLayout(pieces, f, arr);
          const steps = { top: step, bottom: step };
          const layer = renderVideoBands(l.size.width, l.size.height, clipBands(l, steps));
          for (const st of sampleStops(layer, l.size, 4, clipBandStops(l, steps))) assert.ok(st.ok, `${f} ${arr} +${step}: ${st.at} read ${st.got} (want ${st.want})`);
        }
      }
    }
  });
});

describe("H55 · O56 the face on clips", () => {
  const top: Rect = { left: 120, top: 278, width: 840, height: 336 };
  const claim: Rect = { left: 120, top: 1171, width: 840, height: 77 };
  it("a face whose chin sits under the claim passes: only the upper 60 % of the box is tested", () => {
    const s: FaceSample[] = sampleTimes(12).map((tS) => ({ tS, faces: [{ left: 400, top: 1020, width: 240, height: 240 }] }));
    // Both boxes reach into the claim (1171) with the chin. Upper 60 %: from 1020 it ends at 1164, inside the padded claim box (from 1159);
    // from 1010 it ends at 1154, clear of it.
    const ok = sampleTimes(12).map((tS) => ({ tS, faces: [{ left: 400, top: 1010, width: 240, height: 240 }] }));
    assert.equal(judgeFaceOverTime(s, { always: [top], claim }).ok, false);
    assert.equal(judgeFaceOverTime(ok, { always: [top], claim }).ok, true);
  });

  it("crowd faces narrower than 0.06 W (65 px) don't count", () => {
    assert.deepEqual(countedFaces([{ left: 0, top: 0, width: 60, height: 60 }], 1080), []);
    const crowd: FaceSample[] = sampleTimes(12).map((tS) => ({ tS, faces: [{ left: 400, top: 300, width: 50, height: 50 }] }));
    assert.ok(judgeFaceOverTime(crowd, { always: [top], claim }).ok);
  });
});

describe("H56 · O57 contrast steps", () => {
  it("the first band step that passes is the clip's; past the last, the refusal line", () => {
    assert.equal(chooseStep([0.13, 0.09, 0.05], 0.1), 1);
    assert.equal(T1V_LINES.bands(10), "bands +10");
    assert.equal(chooseStep([0.3, 0.2, 0.12], 0.1), null);
    assert.equal(T1V_LINES.tooBright("name"), "Too bright behind the name — choose another clip");
    assert.deepEqual([...T1C.bandSteps], [0, 0.1, 0.2]);
  });
});

describe("H57 · O58 the red line stays red", () => {
  it("the backing steps 40 → 60 → 80 % before white; the line names the step", () => {
    assert.deepEqual(chooseBacking([0.1, 0, 0, 0]), { backing: null, white: false, line: null });
    assert.deepEqual(chooseBacking([0.6, 0.4, 0.2, 0.1]), { backing: 0.6, white: false, line: "red line backed 60 %" });
    assert.deepEqual(chooseBacking([0.9, 0.8, 0.7, 0.3], "photo"), { backing: null, white: true, line: "claim line 1 in white — red unreadable on this photo" });
  });

  it("the backing is line 1's ink box padded 0.5 cap and 1 cap at full opacity, feathered with J2 over 1 cap outside, cut at line 2 and 0.07–0.93 W", () => {
    const b = backingRect({ capTop: 1000, capPx: 54, widthPx: 700 }, 1080, { bottom: 1070 });
    close(b.rect.left, 1080 / 2 - 350 - 54);
    close(b.rect.top, 973);
    assert.equal(b.rect.top + b.rect.height, 1070);
    assert.equal(b.feather, 54);
    // Full across the padded box, edge to edge.
    close(backingAlphaAt(Math.ceil(b.rect.left), 1020, b, 0.8), 0.8);
    close(backingAlphaAt(540, 974, b, 0.8), 0.8);
    // Fading outside it over one cap, gone past it.
    const out = backingAlphaAt(Math.floor(b.rect.left) - 20, 1020, b, 0.8);
    assert.ok(out > 0 && out < 0.8, String(out));
    assert.equal(backingAlphaAt(Math.floor(b.rect.left) - 60, 1020, b, 0.8), 0);
    // Cut hard at line 2: nothing below 1070.
    assert.equal(backingAlphaAt(540, 1075, b, 0.8), 0);
    const wide = backingRect({ capTop: 1000, capPx: 54, widthPx: 1000 }, 1080);
    close(wide.rect.left, 0.07 * 1080);
    close(wide.rect.left + wide.rect.width, 0.93 * 1080);
    assert.equal(backingAlphaAt(70, 1020, wide, 0.8), 0);
  });
});

describe("H58 / H59 · O60 the sample claim is Puzzle's true claim", () => {
  it("the sample reads exactly Puzzle's tiers", () => {
    assert.equal(SAMPLE_ROLL_CALL, "EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT\n3RD RELEASE SELLING FAST");
  });

  it("no test or fixture carries the withdrawn sample", () => {
    const dir = new URL(".", import.meta.url).pathname;
    const bad = [["FINAL RELEASE", "SELLING FAST"].join(" "), ["1ST,", "2ND", "&", "3RD"].join(" ")];
    const hits = readdirSync(dir).filter((f) => f.endsWith(".ts")).filter((f) => bad.some((b) => readFileSync(join(dir, f), "utf8").toUpperCase().includes(b)));
    assert.deepEqual(hits, []);
  });
});

describe("H61 · O62 no upscaling", () => {
  it("a 720-wide clip makes no 4:5 or 1:1: the format is skipped with the line (the 9:16 is still made)", () => {
    const src = { width: 720, height: 1280 };
    assert.equal(formatTooSmall(src, "4:5"), "Clip too small for 4:5 — needs 1080 px wide");
    assert.equal(formatTooSmall(src, "1:1"), "Clip too small for 1:1 — needs 1080 px wide");
    assert.equal(formatTooSmall(src, "9:16"), null);
    assert.equal(formatTooSmall({ width: 1080, height: 1920 }, "1:1"), null);
  });
});
