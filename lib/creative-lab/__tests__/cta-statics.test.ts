import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { SLOTS, planFaceCrop } from "../artist-card.ts";
import { CLAIM_SLOT, KIT_RED, KIT_WHITE, estimateWidth, faceBandWithClaim, planClaim, renderClaimLines, splitTwo, type ClaimPlan } from "../claim-slot.ts";
import { FontHeldError, SERVER_RENDER_ALLOWLIST, fontsDir, indexFonts, readFontFaces, requireFont, resolveFont, serverRenderAllowed, type FontEntry } from "../kit-font.ts";
import { DEFAULT_GRADIENT_SHADOW, J2_FALL, bandAlphaAt, effectiveAlpha, gradientDirection, gradientStops, knotAt, profiles, renderGradientShadow, summarizeProfile } from "../overlay-gradient.ts";

/** A minimal sfnt: head (unitsPerEm), OS/2 v2 (cap height) and a Windows name table. */
function fakeFont(names: Record<number, string>, opts: { upm?: number; cap?: number; tag?: number } = {}): Uint8Array {
  const head = new Uint8Array(54);
  new DataView(head.buffer).setUint16(18, opts.upm ?? 1000);
  const os2 = new Uint8Array(96);
  new DataView(os2.buffer).setUint16(0, 2);
  new DataView(os2.buffer).setInt16(88, opts.cap ?? 712);
  const entries = Object.entries(names).map(([id, s]) => ({ id: Number(id), bytes: Uint8Array.from([...s].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff])) }));
  const strLen = entries.reduce((n, e) => n + e.bytes.length, 0);
  const name = new Uint8Array(6 + entries.length * 12 + strLen);
  const nv = new DataView(name.buffer);
  nv.setUint16(2, entries.length);
  nv.setUint16(4, 6 + entries.length * 12);
  let off = 0;
  entries.forEach((e, i) => {
    const r = 6 + i * 12;
    nv.setUint16(r, 3);
    nv.setUint16(r + 2, 1);
    nv.setUint16(r + 4, 0x409);
    nv.setUint16(r + 6, e.id);
    nv.setUint16(r + 8, e.bytes.length);
    nv.setUint16(r + 10, off);
    name.set(e.bytes, 6 + entries.length * 12 + off);
    off += e.bytes.length;
  });
  const tables = [
    ["OS/2", os2],
    ["head", head],
    ["name", name],
  ] as const;
  const dirLen = 12 + tables.length * 16;
  const total = dirLen + tables.reduce((n, [, t]) => n + t.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, opts.tag ?? 0x4f54544f);
  dv.setUint16(4, tables.length);
  let at = dirLen;
  tables.forEach(([tag, t], i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k += 1) out[r + k] = tag.charCodeAt(k);
    dv.setUint32(r + 8, at);
    dv.setUint32(r + 12, t.length);
    out.set(t, at);
    at += t.length;
  });
  return out;
}

const bootzy = fakeFont({ 1: "Bootzy Condensed TM", 2: "Regular", 4: "Bootzy Condensed TM Regular", 6: "BootzyCondensedTM-Regular" });
const drukTrial = fakeFont({ 1: "Druk Text Trial", 2: "Heavy", 6: "DrukTextTrial-Heavy" });
const goodSans = fakeFont({ 1: "Good Sans", 2: "Bold", 6: "GoodSans-Bold" }, { cap: 780 });

function fakeIndex(files: Record<string, Uint8Array>): FontEntry[] {
  return indexFonts("/fonts", { list: () => Object.keys(files), read: (p) => files[p.split("/").pop()!]!, isFile: () => true });
}

describe("kit fonts: the installed folder, indexed by name table", () => {
  it("reads PostScript name, family, style, unitsPerEm and cap height from the font itself", () => {
    const [f] = readFontFaces(bootzy);
    assert.equal(f!.postscriptName, "BootzyCondensedTM-Regular");
    assert.equal(f!.family, "Bootzy Condensed TM");
    assert.equal(f!.style, "Regular");
    assert.equal(f!.unitsPerEm, 1000);
    assert.equal(f!.capHeight, 712);
    assert.equal(f!.trialName, false);
    assert.deepEqual(readFontFaces(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), []);
  });

  it("defaults to ~/Library/Fonts; FONTS_DIR overrides it", () => {
    assert.match(fontsDir({}), /Library\/Fonts$/);
    assert.equal(fontsDir({ FONTS_DIR: "/opt/fonts" }), "/opt/fonts");
  });

  it("resolves the PSD's name against the file's own name, whatever the file is called", () => {
    const ix = fakeIndex({ "Bootzy-Condensed-TM-Regular.otf": bootzy, "renamed.otf": goodSans, "notes.txt": bootzy });
    assert.equal(ix.length, 2);
    const r = resolveFont("BootzyCondensedTM-Regular", ix);
    assert.equal(r.status, "found");
    if (r.status === "found") assert.equal(r.entry.file, "Bootzy-Condensed-TM-Regular.otf");
    assert.equal(resolveFont("GoodSans-Bold", ix).status, "found");
  });

  it("a missing face holds the card; nothing is substituted", () => {
    const ix = fakeIndex({ "GoodSans-Bold.otf": goodSans });
    const r = resolveFont("BootzyCondensedTM-Regular", ix);
    assert.deepEqual(r, { status: "missing", message: "Claim held — BootzyCondensedTM-Regular not installed" });
    assert.throws(() => requireFont("BootzyCondensedTM-Regular", ix), (e: unknown) => e instanceof FontHeldError && e.message === "Claim held — BootzyCondensedTM-Regular not installed");
  });

  it("a trial font is refused, by its file name or its name table", () => {
    const byName = fakeIndex({ "DrukText-Heavy-Trial (1).otf": drukTrial });
    assert.equal(byName[0]!.trial, true);
    const r = resolveFont("DrukText-Heavy", byName);
    assert.equal(r.status, "trial");
    if (r.status === "trial") assert.equal(r.message, "DrukText-Heavy is a trial font — not for client work");
    // A trial build saved under an innocent file name is still caught by its name table.
    const byTable = fakeIndex({ "DrukText-Heavy.otf": drukTrial });
    assert.equal(byTable[0]!.trial, true);
    // A licensed copy of a face never resolves to the trial file.
    const fileTrial = fakeIndex({ "Bootzy-Trial.otf": bootzy });
    assert.equal(resolveFont("BootzyCondensedTM-Regular", fileTrial).status, "trial");
    assert.throws(() => requireFont("DrukText-Heavy", byName), /trial font — not for client work/);
  });

  it("server rendering is off for every face until its licence is recorded", () => {
    assert.deepEqual([...SERVER_RENDER_ALLOWLIST], []);
    assert.equal(serverRenderAllowed("BootzyCondensedTM-Regular"), false);
    const ix = fakeIndex({ "Bootzy-Condensed-TM-Regular.otf": bootzy });
    assert.equal(requireFont("BootzyCondensedTM-Regular", ix).file, "Bootzy-Condensed-TM-Regular.otf");
    assert.throws(() => requireFont("BootzyCondensedTM-Regular", ix, { server: true }), /server rendering is off/);
  });

  it("claim text is not rendered without the face", async () => {
    const plan = planClaim({ kind: "claim", text: "Final release selling fast", approvedBy: "m", approvedAt: "2026-11-10" }) as ClaimPlan;
    await assert.rejects(renderClaimLines(plan, []), (e: unknown) => e instanceof FontHeldError && /not installed/.test(e.message));
    await assert.rejects(renderClaimLines(plan, fakeIndex({ "Bootzy-Trial.otf": bootzy })), /trial font/);
  });

  it("no font file is committed, and the folder pattern is ignored", () => {
    const gi = readFileSync(new URL("../../../.gitignore", import.meta.url), "utf8");
    for (const p of ["*.otf", "*.ttf", "*.woff", "*.woff2"]) assert.ok(gi.split("\n").includes(p), `.gitignore lacks ${p}`);
    let tracked: string[] = [];
    try {
      tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter((f) => /\.(otf|ttf|ttc|otc|woff2?)$/i.test(f));
    } catch {
      return; // no git here
    }
    assert.deepEqual(tracked.filter((f) => !/^src\/remotion\/fonts\/TikTokSans/.test(f)), []);
  });
});

describe("T1 claim slot (O3, O8, O12)", () => {
  const ok = { approvedBy: "matas", approvedAt: "2026-11-10" };

  it("step 0: one line in O3's box, centred band, white", () => {
    const p = planClaim({ kind: "claim", text: "final release selling fast", ...ok }) as ClaimPlan;
    assert.equal(p.step, 0);
    assert.equal(p.lines.length, 1);
    assert.equal(p.lines[0]!.text, "FINAL RELEASE SELLING FAST");
    assert.equal(p.lines[0]!.color, KIT_WHITE);
    assert.ok(Math.abs(p.lines[0]!.capTop - 0.7536) < 1e-9 && Math.abs(p.lines[0]!.baseline - 0.7927) < 1e-9);
    assert.equal(p.chinMax, 0.72);
    assert.equal(p.chinNote, null);
  });

  it("steps 1 and 2: two lines, the bottom one in O3's box, never a third", () => {
    const p1 = planClaim({ kind: "claim", text: "Tickets move up in price to final release this Wednesday", ...ok }) as ClaimPlan;
    assert.equal(p1.step, 1);
    assert.equal(p1.lines.length, 2);
    assert.ok(Math.abs(p1.lines[1]!.baseline - 0.7927) < 1e-9);
    const gap = p1.lines[1]!.capTop - p1.lines[0]!.baseline;
    assert.ok(Math.abs(gap - CLAIM_SLOT.gapPerCap * CLAIM_SLOT.cap) < 1e-9);
    assert.ok(p1.chinMax < 0.72 && Math.abs(p1.chinMax - p1.blockTop) < 1e-12);
    const long = planClaim({ kind: "claim", text: "x ".repeat(60), ...ok });
    assert.ok("blocker" in long);
    assert.deepEqual(splitTwo("ONE TWO THREE FOUR"), ["ONE TWO", "THREE FOUR"]);
  });

  it("refuses an unapproved or empty claim", () => {
    assert.ok("blocker" in planClaim({ kind: "claim", text: "FINAL 50", approvedBy: "", approvedAt: "2026-11-10" }));
    assert.ok("blocker" in planClaim({ kind: "claim", text: "  ", ...ok }));
  });

  it("roll-call: line 1 kit red at 0.625 of line 2, line 2 white in O3's box; the chin moves above the block", () => {
    const p = planClaim({ kind: "roll-call", soldOut: "Early bird, 1st, 2nd & 3rd release sold out", live: "Final release selling fast", ...ok }) as ClaimPlan;
    assert.equal(p.step, "roll-call");
    assert.deepEqual(p.dropped, []);
    assert.equal(KIT_RED, "#FE3232");
    assert.deepEqual(p.lines.map((l) => l.color), [KIT_RED, KIT_WHITE]);
    assert.ok(Math.abs(p.lines[0]!.cap / p.lines[1]!.cap - 0.625) < 1e-9);
    assert.ok(Math.abs(p.lines[1]!.capTop - 0.7536) < 1e-9);
    assert.ok(Math.abs(p.blockTop - 0.71317) < 1e-4);
    assert.ok(Math.abs(p.chinMax - p.blockTop) < 1e-12);
    assert.match(p.chinNote ?? "", /above the 0\.72 H chin limit/);
    assert.ok(p.lines.every((l) => l.estWidth <= 0.8));
  });

  it("O27 on T1: a roll-call too wide takes line 2's drops in order; line 1 is never shortened; past the last drop it can't shorten", () => {
    const soldOut = "Early bird, 1st & 2nd release sold out";
    // 33 characters × 0.35 × 0.0391 H × 1920 / 1080 = 0.803 W > 0.8; without TICKETS 25 characters, 0.608 W.
    const p = planClaim({ kind: "roll-call", soldOut, live: "Final 100 3rd release tickets now", ...ok }) as ClaimPlan;
    assert.deepEqual(p.dropped, ["TICKETS"]);
    assert.deepEqual(p.lines.map((l) => l.text), ["EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT", "FINAL 100 3RD RELEASE NOW"]);
    const never = planClaim({ kind: "roll-call", soldOut: "Early bird, 1st, 2nd, 3rd, 4th, 5th & 6th release sold out", live: "Final release selling fast", ...ok });
    assert.ok("blocker" in never);
    assert.match((never as { blocker: string }).blocker, /can't shorten/);
  });

  it("width is estimated at 0.35 cap per character until the face renders it", () => {
    // The PSD's measured line 2 (25 characters at 0.0396 H) spans 0.602 W; the estimate is not below it.
    assert.ok(estimateWidth("X".repeat(25), 0.0396) >= 0.602);
  });

  it("the face band with a claim: chin ≤ 0.72 H, and the crop planner honours it", () => {
    assert.equal(faceBandWithClaim(0.7536).chinMax, 0.72);
    assert.equal(faceBandWithClaim(0.7).chinMax, 0.7);
    assert.equal(faceBandWithClaim(0.7536).eyesMin, SLOTS.face.eyesMin);
    // A tall photo with room above and below, so neither plan is clamped by its edges.
    const photo = { width: 4000, height: 9000 };
    const face = { eyeX: 2000, eyeY: 4000, headTopY: 3500, chinY: 4600 };
    const plain = planFaceCrop(photo, face);
    const withClaim = planFaceCrop(photo, face, undefined, faceBandWithClaim(0.7536));
    assert.ok(plain.chin <= 0.76 + 1e-6 && plain.chin > 0.72);
    assert.ok(!withClaim.clamped.y);
    assert.ok(withClaim.chin <= 0.72 + 1e-6);
  });
});

describe("gradient shadow layer", () => {
  it("O25's fade shape: J2's mask, 90 % at 0.5 %, 50 % at 22.6 %, 10 % at 66.8 % of the fall", () => {
    assert.equal(knotAt(J2_FALL, 0), 1);
    assert.ok(Math.abs(knotAt(J2_FALL, 0.005) - 0.9) < 1e-12);
    assert.ok(Math.abs(knotAt(J2_FALL, 0.226) - 0.5) < 1e-12);
    assert.ok(Math.abs(knotAt(J2_FALL, 0.668) - 0.1) < 1e-12);
    assert.ok(Math.abs(knotAt(J2_FALL, 1)) < 1e-12);
  });

  it("the default: top and bottom bands, black, normal, 20 % (the bottom rising to 30 %)", () => {
    const [top, bottom] = DEFAULT_GRADIENT_SHADOW.bands;
    assert.equal(DEFAULT_GRADIENT_SHADOW.blendMode, "normal");
    assert.deepEqual([top!.edge, top!.plateau, top!.extent, top!.opacity, top!.color], ["top", 0.44, 0.53, 0.2, "#000000"]);
    assert.deepEqual([bottom!.edge, bottom!.plateau, bottom!.extent, bottom!.opacity, bottom!.color], ["bottom", 0.3, 0.36, 0.2, "#000000"]);
    assert.deepEqual(bottom!.ramp, { opacity: 0.3, at: 0.22 });
    // Neither band reaches the eyes (0.58–0.64 H).
    const H = 1920;
    for (let y = Math.ceil(0.58 * H); y < Math.floor(0.64 * H); y += 1) for (const b of DEFAULT_GRADIENT_SHADOW.bands) assert.equal(bandAlphaAt(b, y, H), 0);
  });

  it("renders rows: 20 % black at the top, 30 % at the bottom, 0 in the middle", () => {
    const W = 4;
    const H = 1920;
    const px = renderGradientShadow(DEFAULT_GRADIENT_SHADOW, W, H);
    const a = (y: number) => px[(y * W) * 4 + 3]!;
    assert.equal(a(0), 51);
    assert.equal(a(Math.round(0.4 * H)), 51);
    assert.equal(a(Math.round(0.6 * H)), 0);
    // The bottom band (amended): 30 % from 0.78 H to the bottom edge.
    assert.equal(a(Math.round(0.8 * H)), 77);
    assert.equal(a(H - 1), 77);
    assert.deepEqual([...px.subarray(0, 3)], [0, 0, 0]);
    // Half the band's opacity 22 % of the way through the top fall.
    const yHalf = Math.round((0.44 + 0.226 * 0.09) * H);
    assert.ok(Math.abs(a(yHalf) - 25.5) <= 1.5);
  });

  it("measures a solid fill through a gradient layer mask: direction, plateau and fall", () => {
    const W = 100;
    const H = 50;
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) mask[y * W + x] = x < 50 ? 255 : Math.max(0, 255 - (x - 50) * 10);
    const map = effectiveAlpha({ canvas: { width: W, height: H }, bounds: { left: 0, top: 0, right: W, bottom: H }, mask: { left: 0, top: 0, width: W, height: H, data: mask, defaultColor: 0 }, opacity: 0.5 });
    const pr = profiles(map);
    assert.equal(gradientDirection(pr), "horizontal");
    const s = summarizeProfile(pr.cols);
    assert.ok(Math.abs(s.max - 0.5) < 1e-6);
    assert.equal(s.start, 0);
    assert.ok(s.end > 0.7 && s.end < 0.8);
    assert.ok(s.fall.p50! > 0.6 && s.fall.p50! < 0.65);
  });

  it("reads a gradient fill's own stops", () => {
    const stops = gradientStops({ colorStops: [{ color: { r: 0, g: 0, b: 0 }, location: 0 }, { color: { r: 0, g: 0, b: 0 }, location: 1 }], opacityStops: [{ opacity: 0.2, location: 0 }, { opacity: 0, location: 1 }] });
    assert.deepEqual(stops, [{ position: 0, color: "#000000", opacity: 0.2 }, { position: 1, color: "#000000", opacity: 0 }]);
  });
});
