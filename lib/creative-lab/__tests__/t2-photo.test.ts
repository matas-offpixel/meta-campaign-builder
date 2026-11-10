import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MASTER, type Rect } from "../artist-card.ts";
import {
  EXPERIENCE,
  EXPERIENCE_LINES,
  checkExperienceLine,
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
  T2P_LINES,
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
  logoInk: { width: 400, height: 180 },
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
    const r = planPhotoBlock({ experience: MATAS, claim: null }, T2P.stillWidth * MASTER.width, measure);
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
  it("the roll-call sits under the experience line at 0.55 of its cap, 0.025 H below, O23's sizes", () => {
    const r = planPhotoBlock({ experience: MATAS, claim: ROLL_CALL }, 929, measure);
    assert.ok(r.ok);
    const [e1, e2, c1, c2] = r.block.lines;
    assert.equal(r.block.step, 0);
    close(e1!.capPx, 0.06 * 1920);
    close(e2!.capTop - e1!.capTop, 0.0875 * 1920);
    close(c2!.capPx, 0.55 * 0.06 * 1920);
    close(c1!.capPx, c2!.capPx * (0.217 / 0.347));
    assert.equal(c1!.color, "red");
    assert.equal(c2!.color, "white");
    close(c1!.capTop - (e2!.capTop + e2!.capPx), 0.025 * 1920);
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

  it("Matas's words fit at step 0 at 0.86 W and at 840 px (in Bootzy, when it's installed here)", async (t) => {
    const ix = indexFonts(fontsDir());
    const r = resolveFont("BootzyCondensedTM-Regular", ix);
    if (r.status !== "found") return t.skip("Bootzy isn't installed on this machine");
    for (const limit of [T2P.stillWidth * MASTER.width, T2P.clipWidthPx]) {
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

  it("the lineup right-aligned on 0.857 W from 0.219 H, the details at 0.143 W on 0.767 H, the logo's right edge on 0.857 W (still)", () => {
    const m = planPhotoMaster(PUZZLE, "still", measure);
    assert.ok(m.ok);
    const L = m.layout;
    for (const l of L.lineup) close(l.left + l.widthPx, 0.857 * 1080);
    close(L.lineup[0]!.capTop, 0.219 * 1920);
    for (const d of L.details) close(d.left, 0.143 * 1080);
    close(L.boxes.details.top + L.boxes.details.height / 2, 0.767 * 1920);
    close(L.logo.left + L.logo.width, 0.857 * 1080);
    close(L.logo.width, 0.15 * 1080);
    close(L.logo.top + L.logo.height / 2, 0.767 * 1920);
    close((L.block.blockTop + L.block.blockBottom) / 2, 0.5 * 1920);
  });
});

describe("H81 · O80 positions", () => {
  it("every type box inside x 120–960, y 269–1248 on the 9:16 clip", () => {
    const m = planPhotoMaster(PUZZLE, "clip", measure);
    assert.ok(m.ok);
    const safe = photoClipSafe(m.layout);
    assert.ok(safe.ok, JSON.stringify(safe.outside));
    const L = m.layout;
    close(L.lineup[0]!.capTop, 0.15 * 1920);
    for (const l of L.lineup) close(l.left + l.widthPx, 0.889 * 1080);
    const lastDetail = L.details.at(-1)!;
    close(lastDetail.capTop + lastDetail.capPx, 0.65 * 1920);
    close(L.details[0]!.left, 0.111 * 1080);
    close(L.logo.left + L.logo.width, 0.889 * 1080);
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
