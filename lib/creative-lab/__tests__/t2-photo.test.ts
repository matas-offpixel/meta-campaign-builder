import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type Rect } from "../artist-card.ts";
import {
  EXPERIENCE,
  EXPERIENCE_LINES,
  checkExperienceLine,
  doubleSpaceRun,
  saveExperienceLine,
  experienceDisplay,
  photoT2Stamp,
  storedExperienceLine,
  suggestExperienceLines,
  suggestPrompt,
  suggestionProblems,
  type ExperienceFacts,
  type ExperienceModel,
} from "../experience-line.ts";
import { fontsDir, indexFonts, resolveFont } from "../kit-font.ts";
import { sampleTimes } from "../t1-video.ts";
import {
  T2P,
  T2P_DATA_NOTE,
  T2P_LINES,
  dataNoteChecks,
  dataNoteWord,
  VIDEO_SAFE,
  assignPhotoT2,
  captionTemplateConflicts,
  choosePhotoBandSteps,
  judgeClipFaces,
  judgeStillFaces,
  photoBandAlphaAt,
  photoBandAnchors,
  photoClaimOpacity,
  photoClipSafe,
  photoClipTiming,
  photoDetails,
  photoGroundAllowed,
  photoLineupNames,
  photoTooSmall,
  clipTooSmall,
  planPhotoBlock,
  planPhotoLayout,
  planPhotoMaster,
  type PhotoSlotsInput,
} from "../t2-photo.ts";
import { withMeasure } from "../t2-render.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
/** The stand-in measure the T2 tests use: 0.35 cap a character. */
const measure = (text: string, cap: number) => text.length * 0.35 * cap;

const MATAS = "SOUTHAMPTON'S BIGGEST HOUSE PARTY";
const ROLL_CALL = "EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT\n3RD RELEASE SELLING FAST";
const PUZZLE: PhotoSlotsInput = {
  experience: MATAS,
  claim: ROLL_CALL,
  lineup: ["Enzo Siragusa", "Luke Dean", "Reeshy", "Phill de Janeiro", "Benji King"],
  moreToAnnounce: false,
  details: ["SUNDAY 27TH DECEMBER", "CIRCUIT > SOUTHAMPTON"],
  logo: { ink: { width: 400, height: 180 }, kind: "lockup" },
};

describe("H77 · O76 the grounds", () => {
  it("an artist-owned clip can't take T2's photo ground; a promoter clip featuring Luke can", () => {
    assert.deepEqual(photoGroundAllowed({ owner: "artist" }), { ok: false, line: T2P_LINES.artistFootage });
    assert.equal(photoGroundAllowed({ owner: null }).ok, false);
    // W8: a promoter clip featuring an artist is still the promoter's (artist_id null, featured ids set).
    const featuringLuke = { owner: "promoter" as const, artistId: null, featuredArtistIds: ["luke"] };
    assert.deepEqual(photoGroundAllowed(featuringLuke), { ok: true });
  });
});

describe("H78 · O77 the experience line", () => {
  it("Matas's line saves verbatim, its superlative kept: the bans are the writer's, never a typed line's", () => {
    assert.deepEqual(checkExperienceLine(MATAS), { ok: true, text: MATAS });
    assert.deepEqual(checkExperienceLine("Southampton's biggest house party"), { ok: true, text: "Southampton's biggest house party" });
    assert.equal(experienceDisplay("Southampton's biggest house party"), MATAS);
    assert.ok(suggestionProblems(MATAS).some((p) => p.includes("biggest")));
  });

  it("breaks as SOUTHAMPTON'S / BIGGEST HOUSE PARTY", () => {
    const r = planPhotoBlock({ experience: MATAS, claim: null }, T2P.widthPx, measure);
    assert.ok(r.ok);
    assert.deepEqual(r.block.lines.map((l) => l.text), ["SOUTHAMPTON'S", "BIGGEST HOUSE PARTY"]);
  });

  it("a typed break is kept; two lines and 40 characters at most; no emoji", () => {
    assert.equal(storedExperienceLine("  SOUTHAMPTON'S BIGGEST \n HOUSE PARTY  "), "SOUTHAMPTON'S BIGGEST\nHOUSE PARTY");
    const r = planPhotoBlock({ experience: "SOUTHAMPTON'S BIGGEST\nHOUSE PARTY", claim: null }, 929, measure);
    assert.ok(r.ok);
    assert.deepEqual(r.block.lines.map((l) => l.text), ["SOUTHAMPTON'S BIGGEST", "HOUSE PARTY"]);
    assert.deepEqual(checkExperienceLine("A\nB\nC"), { ok: false, line: EXPERIENCE_LINES.tooLong });
    assert.deepEqual(checkExperienceLine("x".repeat(41)), { ok: false, line: EXPERIENCE_LINES.tooLong });
    assert.equal(checkExperienceLine("x".repeat(40)).ok, true);
    assert.deepEqual(checkExperienceLine("HOUSE PARTY 🎉"), { ok: false, line: EXPERIENCE_LINES.emoji });
    assert.equal(EXPERIENCE.maxChars, 40);
  });

  it("a line that doesn't fit two lines at the last step can't be saved", () => {
    const r = planPhotoBlock({ experience: "SUPERCALIFRAGILISTICEXPIALIDOCIOUSHOUSE", claim: null }, 929, measure);
    assert.deepEqual(r, { ok: false, line: "Too long for two lines — shorten the experience line" });
  });

  it("stamped until approved", () => {
    assert.equal(photoT2Stamp("held", null), "DRAFT · experience line not approved");
    assert.equal(photoT2Stamp("approved", "held"), "DRAFT · claim not approved");
    assert.equal(photoT2Stamp("held", "held"), "DRAFT · experience line and claim not approved");
    assert.equal(photoT2Stamp("approved", "approved"), null);
    assert.equal(photoT2Stamp("approved", null), null);
  });
});

describe("H78 · O77 Suggest (a stubbed writer, no live call)", () => {
  const facts: ExperienceFacts = { city: "Southampton", venue: "Circuit", nightName: "Puzzle 4th Birthday", sound: null, lineup: ["Enzo Siragusa", "Luke Dean"] };
  const voice = { handle: "puzzle", examples: ["SEE YOU ON THE FLOOR", "PUZZLE IS BACK AT CIRCUIT"] };

  it("never returns a number, a listed superlative or a scarcity word, and asks again for the rest", async () => {
    const batches = [
      ["SOUTHAMPTON'S BIGGEST HOUSE PARTY", "4 YEARS OF PUZZLE", "THE BEST NIGHT IN TOWN", "TICKETS SELLING FAST", "HOUSE MUSIC AT CIRCUIT"],
      ["NO. 1 FOR HOUSE", "THE ONLY PARTY THAT MATTERS", "FIRST AND LAST", "LOUDEST BIRTHDAY YET", "PUZZLE TURNS FOUR", "A BIRTHDAY ON THE FLOOR"],
      ["SOUTHAMPTON, WE DANCE", "ONE MORE FOR THE ROAD"],
    ];
    let calls = 0;
    const model: ExperienceModel = async () => batches[calls++] ?? [];
    // "1. " list markers are the model's, not the line's.
    batches[2] = batches[2]!.map((l, i) => `${i + 1}. ${l}`);
    const s = await suggestExperienceLines(facts, voice, model);
    assert.deepEqual(s.lines, ["HOUSE MUSIC AT CIRCUIT", "A BIRTHDAY ON THE FLOOR", "SOUTHAMPTON, WE DANCE"]);
    assert.equal(calls, 3);
    const banned = /\d|\b(biggest|best|no\.? ?1|only|first|loudest|tickets?|selling|fast|four|one)\b/i;
    for (const l of s.lines) assert.doesNotMatch(l, banned);
    assert.ok(s.dropped.length >= 8);
  });

  it("stops at three and never edits a line it drops", async () => {
    const model: ExperienceModel = async () => ["HOUSE AT CIRCUIT", "BIGGEST HOUSE AT CIRCUIT", "A NIGHT FOR THE FLOOR", "PUZZLE AT CIRCUIT", "MORE HOUSE"];
    const s = await suggestExperienceLines(facts, voice, model);
    assert.deepEqual(s.lines, ["HOUSE AT CIRCUIT", "A NIGHT FOR THE FLOOR", "PUZZLE AT CIRCUIT"]);
    assert.ok(s.dropped.some((d) => d.line === "BIGGEST HOUSE AT CIRCUIT"));
  });

  it("the prompt carries the event's facts only, and the bans", () => {
    const p = suggestPrompt(facts, voice);
    assert.match(p.user, /City: Southampton/);
    assert.match(p.user, /Venue: Circuit/);
    assert.match(p.user, /Night: Puzzle 4th Birthday/);
    assert.match(p.user, /Lineup: Enzo Siragusa, Luke Dean/);
    assert.doesNotMatch(p.user, /Sound:/);
    assert.match(p.system, /Never write a number, a ranking or superlative/);
  });
});

describe("H79 · O78 sizes, the claim under it, the block", () => {
  it("O85: the roll-call sits under the experience line at 0.50 of its cap, 0.34 of its cap below, O23's sizes", () => {
    const r = planPhotoBlock({ experience: MATAS, claim: ROLL_CALL }, 840, measure);
    assert.ok(r.ok);
    const [e1, e2, c1, c2] = r.block.lines;
    assert.equal(r.block.step, 0);
    close(e1!.capPx, 0.056 * 1920);
    close(e2!.capTop - e1!.capTop, 1.4 * 0.056 * 1920);
    close(c2!.capPx, 0.5 * 0.056 * 1920);
    close(c1!.capPx, c2!.capPx * (0.217 / 0.347));
    assert.equal(c1!.color, "red");
    assert.equal(c2!.color, "white");
    close(c1!.capTop - (e2!.capTop + e2!.capPx), 0.34 * 0.056 * 1920);
    close(c2!.capTop - (c1!.capTop + c1!.capPx), (22 / 76) * c2!.capPx);
  });

  it("drops apply to the claim and never to the experience line", () => {
    const narrow = 700; // the experience line fits; the claim's line 2 (843 px) doesn't until TICKETS goes (688 px)
    const r = planPhotoBlock({ experience: "HOUSE PARTY", claim: "EARLY BIRD SOLD OUT\nFINAL RELEASE TICKETS SELLING FAST NOW" }, narrow, measure);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(r.block.dropped.length > 0);
    assert.equal(r.block.lines[0]!.text, "HOUSE PARTY");
  });

  it("needs an experience line or a claim", () => {
    assert.deepEqual(planPhotoBlock({ experience: null, claim: null }, 929, measure), { ok: false, line: "Add an experience line or a claim" });
    const claimOnly = planPhotoBlock({ experience: null, claim: ROLL_CALL }, 929, measure);
    assert.ok(claimOnly.ok);
    assert.ok(claimOnly.block.lines.every((l) => l.role === "claim"));
  });

  it("H86: Matas's words fit at step 0 within 840 px (in Bootzy, when it's installed here)", async (t) => {
    const ix = indexFonts(fontsDir());
    const r = resolveFont("BootzyCondensedTM-Regular", ix);
    if (r.status !== "found") return t.skip("Bootzy isn't installed on this machine");
    for (const limit of [T2P.widthPx]) {
      const plan: ReturnType<typeof planPhotoBlock> = await withMeasure(r.entry, (m) => planPhotoBlock({ experience: MATAS, claim: ROLL_CALL }, limit, m));
      assert.ok(plan.ok, JSON.stringify(plan));
      assert.equal(plan.block.step, 0, String(limit));
      assert.deepEqual(plan.block.lines.slice(0, 2).map((l) => l.text), ["SOUTHAMPTON'S", "BIGGEST HOUSE PARTY"]);
      for (const l of plan.block.lines) assert.ok(l.widthPx <= limit, `${l.text} ${l.widthPx} > ${limit}`);
    }
  });
});

describe("H80 · O79 the other slots", () => {
  it("no \"& MORE\" without the facts' flag, even past six names; with it, the last line", () => {
    const seven = ["A", "B", "C", "D", "E", "F", "G"];
    assert.deepEqual(photoLineupNames(seven, false), { names: ["A", "B", "C", "D", "E", "F"], more: false });
    assert.deepEqual(photoLineupNames(seven, true), { names: ["A", "B", "C", "D", "E"], more: true });
    const m = planPhotoMaster({ ...PUZZLE, lineup: seven, moreToAnnounce: false }, "still", measure);
    assert.ok(m.ok);
    assert.ok(!m.layout.lineup.some((l) => /MORE/.test(l.text)));
    const withMore = planPhotoMaster({ ...PUZZLE, moreToAnnounce: true }, "still", measure);
    assert.ok(withMore.ok);
    assert.equal(withMore.layout.lineup.at(-1)!.text, "& MORE");
  });

  it("details: the kit's live layer verbatim, else {EEE} {d} {MMM} and the venue", () => {
    assert.deepEqual(photoDetails({ liveLayer: ["SUNDAY 27TH DECEMBER", "CIRCUIT > SOUTHAMPTON"], date: "2026-12-27", venue: "Circuit" }), ["SUNDAY 27TH DECEMBER", "CIRCUIT > SOUTHAMPTON"]);
    assert.deepEqual(photoDetails({ date: "2026-10-17", venue: "Circuit" }), ["SAT 17 OCT", "CIRCUIT"]);
  });

  it("O86 / O87 (still): the lineup right-aligned on 0.889 W from 0.207 H at 0.0276 / 0.0323 H; the details on 0.111 W, their last baseline on 0.793 H; the logo's ink on 0.889 W and on that baseline; the block on 0.535 H", () => {
    const m = planPhotoMaster(PUZZLE, "still", measure);
    assert.ok(m.ok);
    const L = m.layout;
    for (const l of L.lineup) close(l.left + l.widthPx, 0.889 * 1080);
    close(L.lineup[0]!.capTop, 0.207 * 1920);
    close(L.lineup[0]!.capPx, 0.0276 * 1920);
    close(L.lineup[1]!.capTop - L.lineup[0]!.capTop, 0.0323 * 1920);
    for (const d of L.details) close(d.left, 0.111 * 1080);
    close(L.details[0]!.capPx, 0.028 * 1920);
    close(L.details[1]!.capTop - L.details[0]!.capTop, 0.0328 * 1920);
    const last = L.details.at(-1)!;
    close(last.capTop + last.capPx, 0.793 * 1920);
    close(L.logo.left + L.logo.width, 0.889 * 1080);
    close(L.logo.width, 0.25 * 1080); // the kit's event lockup (O54)
    close(L.logo.top + L.logo.height, 0.793 * 1920);
    close((L.block.blockTop + L.block.blockBottom) / 2, 0.535 * 1920);
    const wordmark = planPhotoMaster({ ...PUZZLE, logo: { ink: { width: 174, height: 22 }, kind: "wordmark" } }, "still", measure);
    assert.ok(wordmark.ok);
    close(wordmark.layout.logo.width, 0.161 * 1080);
  });
});

describe("H81 · O80 positions", () => {
  it("every type box inside x 120–960, y 269–1248 on the 9:16 clip", () => {
    const m = planPhotoMaster(PUZZLE, "clip", measure);
    assert.ok(m.ok);
    const safe = photoClipSafe(m.layout);
    assert.ok(safe.ok, JSON.stringify(safe.outside));
    const L = m.layout;
    // O87: the lineup as on the still (O94 moves it up on this roll-call clip, by lineupShift); the details' last baseline and the logo's ink bottom on 0.65 H.
    close(L.lineup[0]!.capTop + L.lineupShift, 0.207 * 1920);
    for (const l of L.lineup) close(l.left + l.widthPx, 0.889 * 1080);
    const lastDetail = L.details.at(-1)!;
    close(lastDetail.capTop + lastDetail.capPx, 0.65 * 1920);
    close(L.details[0]!.left, 0.111 * 1080);
    close(L.logo.left + L.logo.width, 0.889 * 1080);
    close(L.logo.top + L.logo.height, 0.65 * 1920);
    const lineupBaseline = L.boxes.lineup.top + L.boxes.lineup.height;
    close((L.block.blockTop + L.block.blockBottom) / 2, (lineupBaseline + L.boxes.details.top) / 2);
    assert.equal(VIDEO_SAFE.bottom, 1248);
  });

  it("the 4:5 is the 9:16 still's rectangle at the type's 9:16 size; the 1:1 its 0.8× re-sit at the same fractions", () => {
    const s = planPhotoLayout(PUZZLE, "still", "9:16", measure);
    const f = planPhotoLayout(PUZZLE, "still", "4:5", measure);
    const q = planPhotoLayout(PUZZLE, "still", "1:1", measure);
    assert.ok(s.ok && f.ok && q.ok);
    close(f.layout.boxes.lineup.top, s.layout.boxes.lineup.top - 285);
    close(f.layout.boxes.block.width, s.layout.boxes.block.width);
    close(q.layout.boxes.block.width, s.layout.boxes.block.width * 0.8);
    close(q.layout.boxes.lineup.top, (s.layout.boxes.lineup.top - 285) * 0.8);
    close(q.layout.boxes.block.left + q.layout.boxes.block.width / 2, 540);
    // A clip's 4:5 and 1:1 take the still's positions.
    const c45 = planPhotoLayout(PUZZLE, "clip", "4:5", measure);
    assert.ok(c45.ok);
    assert.deepEqual(c45.layout.boxes, f.layout.boxes);
    for (const L of [f.layout, q.layout]) for (const b of [L.boxes.lineup, L.boxes.block, L.boxes.details, L.boxes.logo]) assert.ok(b.top >= 0 && b.top + b.height <= L.size.height && b.left >= 0 && b.left + b.width <= L.size.width);
  });
});

describe("H82 · O81 contrast", () => {
  it("reading all three bands on a flat test photo: 20 % full behind each slot, J2's fade, the bottom band to 30 %", () => {
    const m = planPhotoMaster(PUZZLE, "still", measure);
    assert.ok(m.ok);
    const a = photoBandAnchors(m.layout);
    const s0 = { top: 0, centre: 0, bottom: 0 };
    close(photoBandAlphaAt(Math.floor(m.layout.boxes.lineup.top), a, s0), 0.2);
    close(photoBandAlphaAt(Math.floor((m.layout.block.blockTop + m.layout.block.blockBottom) / 2), a, s0), 0.2);
    close(photoBandAlphaAt(1919, a, s0), 0.3);
    // Between the top band's end and the centre band's fade there is clear photo.
    const gapRow = Math.floor((a.topGone + (a.centreFull[0] - a.centreFade)) / 2);
    if (a.topGone < a.centreFull[0] - a.centreFade) close(photoBandAlphaAt(gapRow, a, s0), 0);
    // Steps: 20 → 30 → 40 %, the bottom 30 → 40 → 50 %.
    close(photoBandAlphaAt(Math.floor(m.layout.boxes.lineup.top), a, { top: 2, centre: 0, bottom: 0 }), 0.4);
    close(photoBandAlphaAt(1919, a, { top: 0, centre: 0, bottom: 2 }), 0.5);
  });

  it("each band steps only for its own slot; past the last step the line names the slot", () => {
    const r = choosePhotoBandSteps((s) => ({ lineup: s.top >= 1 ? 0.05 : 0.2, block: 0.1, details: 0.05, logo: s.bottom >= 2 ? 0.1 : 0.3 }));
    assert.ok(r.ok);
    assert.deepEqual(r.steps, { top: 1, centre: 0, bottom: 2 });
    const busy = choosePhotoBandSteps(() => ({ lineup: 0, block: 0.5, details: 0, logo: 0 }));
    assert.equal(busy.ok, false);
    assert.equal(!busy.ok && busy.line, "Too busy behind the experience line — choose another photo or clip");
    const details = choosePhotoBandSteps(() => ({ lineup: 0, block: 0, details: 0.4, logo: 0 }));
    assert.equal(!details.ok && details.line, "Too busy behind the details — choose another photo or clip");
  });
});

describe("H83 · O82 faces and resolution", () => {
  const m = planPhotoMaster(PUZZLE, "still", measure);
  assert.ok(m.ok);
  const block = m.layout.boxes.block;
  it("a still with a 0.1 W face under the block is refused", () => {
    const face: Rect = { left: 500, top: block.top + 20, width: 108, height: 108 };
    const v = judgeStillFaces([face], m.layout);
    assert.equal(v.ok, false);
    assert.equal(!v.ok && v.line, "Face in the type — choose another crop or photo");
  });

  it("unless a crop clears it (the face moved clear of every type box), and crowd faces under 0.08 W never count", () => {
    const cleared: Rect = { left: 140, top: 1250, width: 108, height: 108 };
    assert.deepEqual(judgeStillFaces([cleared], m.layout), { ok: true });
    assert.deepEqual(judgeStillFaces([{ left: 500, top: block.top + 20, width: 60, height: 60 }], m.layout), { ok: true });
  });

  it("a still is never upscaled; a clip follows O63", () => {
    assert.equal(photoTooSmall({ width: 1080, height: 1920 }, "9:16"), null);
    assert.equal(photoTooSmall({ width: 3000, height: 2000 }, "1:1"), null);
    assert.equal(photoTooSmall({ width: 1600, height: 900 }, "4:5"), "Photo too small for 4:5 — 506 px wide in the crop, needs 1080");
    assert.equal(photoTooSmall({ width: 720, height: 1280 }, "9:16"), "Photo too small for 9:16 — 720 px wide in the crop, needs 1080");
    assert.equal(clipTooSmall({ width: 720, height: 1280 }, "9:16"), null);
  });

  it("on a clip, O56's limits with the experience line on from frame 0", () => {
    const clip = planPhotoMaster(PUZZLE, "clip", measure);
    assert.ok(clip.ok);
    const e = clip.layout.boxes.experience!;
    const samples = sampleTimes(8).map((tS) => ({ tS, faces: tS < 1 ? [{ left: e.left + 50, top: e.top, width: 120, height: 120 }] : [] }));
    const v = judgeClipFaces(samples, clip.layout);
    assert.equal(v.ok, false);
    assert.ok(v.topShare > 0.1);
  });
});

describe("H84 · O83 on a clip", () => {
  it("a 12 s clip's claim is at 0 % at 1.49 s and 100 % at 1.75 s; the experience line is on at frame 0", () => {
    assert.equal(photoClaimOpacity(1.49), 0);
    assert.equal(photoClaimOpacity(1.75), 1);
    const t = photoClipTiming(12, true);
    assert.ok(t.fromFrame0.includes("experience"));
    assert.equal(t.claim, true);
    const short = photoClipTiming(4, true);
    assert.equal(short.claim, false);
    assert.equal(short.claimLine, "Clip too short for a claim — needs 4.75 s");
  });

  it("a UGC caption and this template never share a clip", () => {
    assert.deepEqual(captionTemplateConflicts([{ clipId: "a", use: "caption" }, { clipId: "a", use: "t2-photo" }, { clipId: "b", use: "t2-photo" }, { clipId: "c", use: "caption" }, { clipId: "c", use: "t1" }]), ["a", "c"]);
    assert.deepEqual(assignPhotoT2([{ clipId: "a", use: "caption" }], { clipId: "a", use: "t2-photo" }), { ok: false, line: "A clip takes a UGC caption or T2, never both" });
    assert.deepEqual(assignPhotoT2([{ clipId: "a", use: "t2-photo" }], { clipId: "a", use: "caption" }), { ok: false, line: "A clip takes a UGC caption or T2, never both" });
    assert.deepEqual(assignPhotoT2([{ clipId: "a", use: "t1" }], { clipId: "a", use: "t2-photo" }), { ok: true });
  });
});

describe("H82 · the still on a flat test photo (Bootzy, when it's installed here)", () => {
  const face = () => {
    const r = resolveFont("BootzyCondensedTM-Regular", indexFonts(fontsDir()));
    return r.status === "found" ? r.entry : null;
  };
  const flat = async (v: number) => {
    const sharp = (await import("sharp")).default;
    return sharp({ create: { width: 1200, height: 2133, channels: 3, background: { r: v, g: v, b: v } } }).png().toBuffer();
  };
  const logo = async () => {
    const sharp = (await import("sharp")).default;
    return sharp({ create: { width: 400, height: 180, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
  };

  it("mid-grey passes at step 0; a light grey steps every band to 30 %; three formats at their sizes", async (t) => {
    const f = face();
    if (!f) return t.skip("Bootzy isn't installed on this machine");
    const { renderPhotoStill } = await import("../t2-photo-render.ts");
    const base = { slots: PUZZLE, face: f, logoPng: await logo(), stamp: "DRAFT · claim not approved", faces: [], cropFocusY: [0.5] };
    const mid = await renderPhotoStill({ ...base, photo: await flat(110) });
    assert.equal(mid.held, null);
    assert.deepEqual(mid.report.steps, { top: 0, centre: 0, bottom: 0 });
    const light = await renderPhotoStill({ ...base, photo: await flat(200) });
    assert.equal(light.held, null, String(light.held));
    assert.deepEqual(light.report.steps, { top: 1, centre: 1, bottom: 1 });
    const sharp = (await import("sharp")).default;
    for (const [fmt, size] of [["9:16", [1080, 1920]], ["4:5", [1080, 1350]], ["1:1", [1080, 1080]]] as const) {
      const m = await sharp(light.images[fmt]!).metadata();
      assert.deepEqual([m.width, m.height], size);
    }
    // A white photo is too busy behind the lineup at 40 %.
    const white = await renderPhotoStill({ ...base, photo: await flat(255) });
    assert.match(String(white.held), /^Too busy behind the /);
  });

  it("a photo narrower than 1080 in its 9:16 window is never upscaled", async (t) => {
    const f = face();
    if (!f) return t.skip("Bootzy isn't installed on this machine");
    const { renderPhotoStill } = await import("../t2-photo-render.ts");
    const sharp = (await import("sharp")).default;
    const small = await sharp({ create: { width: 720, height: 1280, channels: 3, background: { r: 90, g: 90, b: 90 } } }).png().toBuffer();
    const r = await renderPhotoStill({ photo: small, slots: PUZZLE, face: f, logoPng: await logo(), stamp: null, faces: [], cropFocusY: [0.5] });
    assert.equal(r.held, "Photo too small for 9:16 — 720 px wide in the crop, needs 1080");
  });
});

describe("issue 12 · H86 the data note (Matas's example, measured), to within 0.005 H / W", () => {
  const ex = T2P_DATA_NOTE.example;
  const EXAMPLE: PhotoSlotsInput = { experience: ex.experience, claim: ex.claim, lineup: ex.lineup, moreToAnnounce: ex.moreToAnnounce, details: ex.details, logo: ex.logo };
  const N = T2P_DATA_NOTE;
  const tolY = 0.005 * 1920;
  const tolX = 0.005 * 1080;
  const within = (got: number, want: number, tol: number, what: string) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got.toFixed(1)} vs ${want} (±${tol})`);

  it("every slot's anchor, in every still format and on Puzzle's own words", () => {
    for (const input of [EXAMPLE, PUZZLE]) {
      for (const f of ["9:16", "4:5", "1:1"] as const) {
        const r = planPhotoLayout(input, "still", f, measure);
        assert.ok(r.ok);
        const checks = dataNoteChecks(r.layout);
        assert.equal(checks.length, 7);
        assert.deepEqual(checks.filter((c) => !c.ok), [], f);
        assert.match(dataNoteWord(checks), /^✓ \(7 within ±0\.005\)$/);
      }
    }
    const clip = planPhotoLayout(PUZZLE, "clip", "9:16", measure);
    assert.ok(clip.ok);
    assert.equal(dataNoteChecks(clip.layout).length, 4);
    assert.ok(dataNoteChecks(clip.layout).every((c) => c.ok));
  });

  it("each ink box of the example's own words on the 9:16 still: cap tops and baselines", () => {
    const r = planPhotoMaster(EXAMPLE, "still", measure);
    assert.ok(r.ok);
    const L = r.layout;
    assert.deepEqual(L.lineup.map((l) => l.text), ["JAMBACK", "MELLA DEE", "CAM STOCKMAN", "LI LI", "& MORE"]);
    L.lineup.forEach((l, i) => within(l.capTop, N.lineup.capTops[i]!, tolY, `lineup ${l.text} cap top`));
    within(L.lineup.at(-1)!.capTop + L.lineup.at(-1)!.capPx, N.lineup.lastBaseline, tolY, "lineup last baseline");
    within(L.lineup[0]!.capPx, N.lineup.cap, tolY, "lineup cap");
    const exp = L.block.lines.filter((l) => l.role === "experience");
    assert.deepEqual(exp.map((l) => l.text), ["SOUTHAMPTON'S", "BIGGEST HOUSE  PARTY"]);
    exp.forEach((l, i) => {
      within(l.capTop, N.experience.lines[i]!.top, tolY, `${l.text} top`);
      within(l.capTop + l.capPx, N.experience.lines[i]!.bottom, tolY, `${l.text} bottom`);
    });
    const claim = L.block.lines.find((l) => l.role === "claim")!;
    within(claim.capTop, N.claim.top, tolY, "claim top");
    within(claim.capTop + claim.capPx, N.claim.bottom, tolY, "claim bottom");
    within(L.block.blockTop, N.block.top, tolY, "block top");
    within(L.block.blockBottom, N.block.bottom, tolY, "block bottom");
    L.details.forEach((d, i) => {
      within(d.capTop, N.details.capTops[i]!, tolY, `${d.text} top`);
      within(d.capTop + d.capPx, N.details.bottoms[i]!, tolY, `${d.text} bottom`);
      within(d.left, N.details.left, tolX, `${d.text} left`);
    });
    within(L.logo.left, N.logo.left, tolX, "logo left");
    within(L.logo.left + L.logo.width, N.logo.right, tolX, "logo right");
    within(L.logo.top, N.logo.top, tolY, "logo top");
    within(L.logo.top + L.logo.height, N.logo.bottom, tolY, "logo bottom");
    // The 4:5 rectangle's fractions (O87): 0.083, 0.42–0.68, 0.916.
    const f = planPhotoLayout(EXAMPLE, "still", "4:5", measure);
    assert.ok(f.ok);
    close(f.layout.lineup[0]!.capTop / 1350, 0.083, 0.001);
    close(f.layout.block.blockTop / 1350, 0.42, 0.005);
    close(f.layout.block.blockBottom / 1350, 0.68, 0.005);
    const last = f.layout.details.at(-1)!;
    close((last.capTop + last.capPx) / 1350, 0.916, 0.002);
  });

  it("each line's width and centre in Bootzy (when it's installed here), side-bearing aside", async (t) => {
    const r0 = resolveFont("BootzyCondensedTM-Regular", indexFonts(fontsDir()));
    if (r0.status !== "found") return t.skip("Bootzy isn't installed on this machine");
    const r: ReturnType<typeof planPhotoMaster> = await withMeasure(r0.entry, (m) => planPhotoMaster(EXAMPLE, "still", m));
    assert.ok(r.ok);
    const L = r.layout;
    within(Math.max(...L.lineup.map((l) => l.widthPx)), N.lineup.widest, tolX, "lineup widest (CAM STOCKMAN)");
    const exp = L.block.lines.filter((l) => l.role === "experience");
    exp.forEach((l, i) => {
      const note = N.experience.lines[i]!;
      within(l.widthPx, note.right - note.left, tolX * 2, `${l.text} width`);
      within(540, (note.left + note.right) / 2, tolX, `${l.text} centre`);
    });
    // O91: the claim stays Bootzy at +25. Its width is logged against the example's 582 px, not judged; its cap height and centring are.
    const claim = L.block.lines.find((l) => l.role === "claim")!;
    within(claim.capPx, N.claim.bottom - N.claim.top, tolY, "claim cap height");
    within(540, (N.claim.left + N.claim.right) / 2, tolX, "claim centre");
    assert.equal(T2P.tracking.claim, 25);
    // O90: the date / venue lines at tracking 0, each line's cap top, baseline and text frame within 0.005 (checked above on the
    // stand-in too). By ink they start at x 121 here and at 131 in the example: O86 places them by the text frame, side-bearing aside.
    assert.equal(T2P.tracking.details, 0);
    L.details.forEach((d, i) => {
      within(d.capTop, N.details.capTops[i]!, tolY, `${d.text} top (Bootzy)`);
      within(d.capTop + d.capPx, N.details.bottoms[i]!, tolY, `${d.text} bottom (Bootzy)`);
      within(d.left, N.details.left, tolX, `${d.text} text frame (Bootzy)`);
    });
  });

  it("O90: the poster-panel T2 keeps its +5 on the details; the photo ground sets them at 0", async () => {
    const { PUZZLE_FLOATING_T2 } = await import("../overlay-kits.ts");
    assert.equal(PUZZLE_FLOATING_T2.tracking.details, 5);
    assert.equal(T2P.tracking.details, 0);
    const seen: number[] = [];
    planPhotoMaster(PUZZLE, "still", (text, cap, tracking) => {
      if (text === "SUNDAY 27TH DECEMBER") seen.push(tracking);
      return measure(text, cap);
    });
    assert.deepEqual([...new Set(seen)], [0]);
  });
});

describe("issue 12 · H87 two spaces (O88), O89 no lineup shadow", () => {
  const TWO = "SOUTHAMPTON'S BIGGEST HOUSE  PARTY";
  it("Matas's line asks once; Keep saves it as typed; Make it one touches nothing else", () => {
    assert.deepEqual(saveExperienceLine(TWO), { status: "ask", line: "Two spaces after HOUSE — keep them?", options: ["Keep", "Make it one"] });
    assert.deepEqual(saveExperienceLine(TWO, { answer: "keep" }), { status: "saved", text: TWO });
    assert.deepEqual(saveExperienceLine(TWO, { keptBefore: TWO }), { status: "saved", text: TWO });
    assert.deepEqual(saveExperienceLine(TWO, { answer: "one" }), { status: "saved", text: "SOUTHAMPTON'S BIGGEST HOUSE PARTY" });
    assert.deepEqual(saveExperienceLine("SOUTHAMPTON'S BIGGEST HOUSE PARTY"), { status: "saved", text: "SOUTHAMPTON'S BIGGEST HOUSE PARTY" });
    assert.deepEqual(saveExperienceLine("x".repeat(41)), { status: "refused", line: EXPERIENCE_LINES.tooLong });
    assert.equal(doubleSpaceRun("A\nB  C")?.word, "B");
  });

  it("the break keeps the two spaces in the line they fall in", () => {
    const r = planPhotoBlock({ experience: TWO, claim: null }, 840, measure);
    assert.ok(r.ok);
    assert.deepEqual(r.block.lines.map((l) => l.text), ["SOUTHAMPTON'S", "BIGGEST HOUSE  PARTY"]);
  });

  it("O89: the photo ground draws no shadow, stroke or glow under any type (O5)", () => {
    const src = readFileSync(join(process.cwd(), "lib/creative-lab/t2-photo-render.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /KIT_SHADOW|textOverlay|shadow\s*:|blur\(|stroke/i);
  });
});

describe("O82 on the still, per format: a face only the 1:1's type touches refuses the 1:1 alone (Bootzy, when it's installed here)", () => {
  it("the 9:16 and 4:5 pass; the 1:1 is drawn as a flagged preview with the line", async (t) => {
    const r0 = resolveFont("BootzyCondensedTM-Regular", indexFonts(fontsDir()));
    if (r0.status !== "found") return t.skip("Bootzy isn't installed on this machine");
    const sharp = (await import("sharp")).default;
    const { renderPhotoStill } = await import("../t2-photo-render.ts");
    const photo = await sharp({ create: { width: 1200, height: 2133, channels: 3, background: { r: 90, g: 90, b: 90 } } }).png().toBuffer();
    const logoPng = await sharp({ create: { width: 400, height: 180, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    // Master px (k = 0.9): x 220–330, y 1320–1430 — clear of the 9:16's type, on the 1:1's re-sat details.
    const face = { left: 220 / 0.9, top: 1320 / 0.9, width: 110 / 0.9, height: 110 / 0.9 };
    const r = await renderPhotoStill({ photo, slots: PUZZLE, face: r0.entry, logoPng, stamp: null, faces: [face], cropFocusY: [0.5] });
    assert.equal(r.held, null);
    assert.deepEqual(Object.keys(r.report.refused), ["1:1"]);
    assert.equal(r.report.refused["1:1"], "Face in the type — choose another crop or photo");
    for (const f of ["9:16", "4:5", "1:1"] as const) assert.ok(r.images[f]);
  });
});

describe("O94 (issue 15) · room on the 9:16 clip", () => {
  const gap = 0.04 * 1920;
  const room = (L: { boxes: { lineup: Rect; details: Rect }; block: { blockTop: number; blockBottom: number } }) => ({
    above: L.block.blockTop - (L.boxes.lineup.top + L.boxes.lineup.height),
    below: L.boxes.details.top - L.block.blockBottom,
  });

  it("the roll-call: the lineup moves up to 0.16 H, the block steps to 0.0485 H, at least 0.04 H each side", () => {
    const m = planPhotoMaster(PUZZLE, "clip", measure);
    assert.ok(m.ok);
    const L = m.layout;
    close(L.lineup[0]!.capTop, 0.16 * 1920);
    close(L.lineupShift, 0.207 * 1920 - 0.16 * 1920);
    assert.equal(L.block.step, 1);
    close(L.block.lines[0]!.capPx, 0.0485 * 1920);
    const r = room(L);
    assert.ok(r.above >= gap - 1e-6 && r.below >= gap - 1e-6, JSON.stringify(r));
    close(r.above, r.below);
    assert.ok(photoClipSafe(L).ok);
  });

  it("no claim: nothing moves, the block stays at step 0, and the room is still ≥ 0.04 H each side", () => {
    const m = planPhotoMaster({ ...PUZZLE, claim: null }, "clip", measure);
    assert.ok(m.ok);
    assert.equal(m.layout.lineupShift, 0);
    close(m.layout.lineup[0]!.capTop, 0.207 * 1920);
    assert.equal(m.layout.block.step, 0);
    const r = room(m.layout);
    assert.ok(r.above >= gap && r.below >= gap);
  });

  it("past the last step, refused with the line; stills and the 4:5 / 1:1 are untouched", () => {
    const long = planPhotoMaster({ ...PUZZLE, lineup: ["A", "B", "C", "D", "E", "F"], claim: "LAST FEW TICKETS LEFT FOR THE BIRTHDAY\nGET THEM BEFORE THEY GO" }, "clip", measure);
    assert.deepEqual(long, { ok: false, line: "No room for the claim on the 9:16 clip — shorten it" });
    const still = planPhotoMaster(PUZZLE, "still", measure);
    assert.ok(still.ok);
    assert.equal(still.layout.lineupShift, 0);
    close(still.layout.lineup[0]!.capTop, 0.207 * 1920);
    for (const f of ["4:5", "1:1"] as const) {
      const c = planPhotoLayout(PUZZLE, "clip", f, measure);
      const s = planPhotoLayout(PUZZLE, "still", f, measure);
      assert.ok(c.ok && s.ok);
      assert.deepEqual(c.layout.boxes, s.layout.boxes);
      assert.equal(c.layout.lineupShift, 0);
    }
  });

  it("the 0.005 slot check reads the moved lineup top", () => {
    const m = planPhotoMaster(PUZZLE, "clip", measure);
    assert.ok(m.ok);
    const checks = dataNoteChecks(m.layout);
    assert.ok(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok)));
    const top = checks.find((c) => c.slot.startsWith("lineup first cap top"))!;
    assert.match(top.slot, /moved up 90 px, O94/);
    close(top.want, T2P_DATA_NOTE.lineup.capTops[0] - m.layout.lineupShift);
  });
});
