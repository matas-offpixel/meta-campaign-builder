import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

import { FORMAT_RULES, FORMAT_SLOTS, renderCard, type Piece } from "../artist-card.ts";
import { renderClaimCard } from "../artist-card-claim.ts";
import { FORMAT_BANDS, claimTransform, faceTooLowLine, frameLeft, inkInRect, layoutFormatText, offCentreLine, planFormatPhoto } from "../artist-card-format.ts";
import { CARD_CLAIM, type CardClaimPlan } from "../claim-slot.ts";
import { fixtureCardInput } from "../framing-fixture.ts";
import { bandAlphaAt } from "../overlay-gradient.ts";

/** main when this branch was cut: the 9:16 is compared against its code, byte for byte. */
const PARENT = "adc332c";

const piece = (width: number, height: number, label: string, capPx = height): Piece => ({ png: Buffer.alloc(0), width, height, capPx, label });

describe("O119 strings (overlay-templates issue 17), exact", () => {
  it("off centre, and face too low", () => {
    assert.equal(offCentreLine(14, "left"), "Framed 14 px off centre: the photo ends at the left");
    assert.equal(offCentreLine(3, "right"), "Framed 3 px off centre: the photo ends at the right");
    assert.equal(faceTooLowLine("4:5", 37), "Face too low for 4:5: the photo ends 37 px below the chin");
    assert.equal(faceTooLowLine("1:1", 0), "Face too low for 1:1: the photo ends 0 px below the chin");
  });
});

describe("O117 / O118: the record's expected figures", () => {
  // The record sums the info as "0.62 + 2 × 0.042 + 0.030 = 0.704 H"; that sum is 0.734, so the claim is
  // 0.106 H clear of it in the 4:5 (the record says 0.136) and 0.092 H in the 1:1. Both clear O118's 0.02 H.
  it("AF-A, 4:5: eyes on 0.43 H, head top 0.301, chin 0.560; info 0.62–0.734; claim 0.840–0.944, 0.106 clear", () => {
    // The face box of the measured render: 0.259 H tall, the eyes 0.129 H under the head top (at scale 1).
    const H = 1350;
    const face = { eyeX: 1000, eyeY: 1000 + 0.129 * H, headTopY: 1000, chinY: 1000 + 0.259 * H };
    const plan = planFormatPhoto({ width: 2000, height: 3000 }, face, "4:5", 1);
    assert.equal(plan.skip, null);
    assert.equal(plan.scale, 1);
    assert.ok(Math.abs(plan.eyes - 0.43) < 1e-6);
    assert.ok(Math.abs(plan.headTop - 0.301) < 1e-6);
    assert.ok(Math.abs(plan.chin - 0.56) < 1e-6);
    const layout = layoutFormatText({ lockup: piece(518, 110, "lockup"), name: piece(1200, 300, "name"), info: [piece(1000, 81, "i1"), piece(900, 81, "i2"), piece(500, 81, "i3")] }, "4:5", plan.chin);
    assert.ok(Math.abs(layout.infoTop! / H - 0.62) < 1e-6);
    assert.ok(Math.abs(layout.infoBottom! / H - (0.62 + 2 * 0.042 + 0.03)) < 1e-6);
    assert.ok(Math.abs(layout.infoBottom! / H - 0.734) < 1e-6);
    // The name sits above the head's top.
    assert.ok(layout.name.top + layout.name.height < plan.headTop * H);
    const claim: CardClaimPlan = { kind: "two-line", lines: [], k: 1, blockTop: 1559 - 0.104 * H, bottom: 1559, dropped: [] };
    const t = claimTransform(claim, "4:5", layout.infoBottom);
    assert.ok(!("held" in t));
    if ("held" in t) return;
    const top = (claim.blockTop * t.t.k + t.t.dy) / H;
    // The record's figures are to 3 decimals: 1274 / 1350 = 0.9437, less the claim's 0.104 H.
    assert.ok(Math.abs(top - 0.84) < 1e-3);
    assert.ok(Math.abs((1559 * t.t.k + t.t.dy) / H - 1274 / H) < 1e-6);
    assert.ok(Math.abs(1274 / H - 0.9437) < 1e-4);
    assert.ok(Math.abs(top - layout.infoBottom! / H - 0.106) < 1e-3);
  });
  it("AF-B, 1:1: eyes on 0.445 H, head 0.32, chin 0.57; claim 0.826–0.93", () => {
    const H = 1080;
    const face = { eyeX: 1000, eyeY: 1000 + 0.125 * H, headTopY: 1000, chinY: 1000 + 0.25 * H };
    const plan = planFormatPhoto({ width: 2000, height: 3000 }, face, "1:1", 1.25);
    assert.equal(plan.scale, 1);
    assert.ok(Math.abs(plan.eyes - 0.445) < 1e-6);
    assert.ok(Math.abs(plan.headTop - 0.32) < 1e-6);
    assert.ok(Math.abs(plan.chin - 0.57) < 1e-6);
    const claim: CardClaimPlan = { kind: "two-line", lines: [], k: 1, blockTop: 1559 - 0.13 * 1080, bottom: 1559, dropped: [] };
    const t = claimTransform(claim, "1:1", 0.734 * H);
    if ("held" in t) return assert.fail(t.held);
    assert.equal(t.t.k, 0.8);
    assert.ok(Math.abs((1559 * t.t.k + t.t.dy) - 1004) < 1e-6);
    assert.ok(Math.abs((claim.blockTop * t.t.k + t.t.dy) / H - 0.826) < 1e-3);
    assert.ok(Math.abs(t.t.dx + 540 * t.t.k - 540) < 1e-6);
  });
  it("the slot tables are the record's", () => {
    assert.deepEqual(FORMAT_SLOTS["4:5"].face, { headTopMin: 0.27, eyes: 0.43, eyesMin: 0.4, eyesMax: 0.46, chinMax: 0.6 });
    assert.deepEqual(FORMAT_SLOTS["1:1"].face, { headTopMin: 0.29, eyes: 0.445, eyesMin: 0.42, eyesMax: 0.47, chinMax: 0.6 });
    assert.equal(FORMAT_SLOTS["4:5"].claim.bottom, 1274);
    assert.equal(FORMAT_SLOTS["1:1"].claim.bottom, 1004);
    assert.deepEqual([FORMAT_SLOTS["4:5"].lockup, FORMAT_SLOTS["1:1"].lockup], [{ top: 76, width: 0.24 }, { top: 76, width: 0.22 }]);
    assert.deepEqual([FORMAT_SLOTS["4:5"].name.cap, FORMAT_SLOTS["4:5"].name.floorCap, FORMAT_SLOTS["1:1"].name.cap, FORMAT_SLOTS["1:1"].name.floorCap], [0.12, 0.07, 0.11, 0.065]);
    assert.deepEqual(FORMAT_RULES, { centreTolerance: 0.01, faceClear: 0.02, claimGap: 0.02, maxSide: 0.12 });
  });
  it("O118's bands: nothing above 0.62 H's fade from the bottom, 20 % at 0.62 H, the top band gone at 0.30 H", () => {
    const [top, bottom] = FORMAT_BANDS.bands as [(typeof FORMAT_BANDS.bands)[number], (typeof FORMAT_BANDS.bands)[number]];
    for (const H of [1350, 1080]) {
      assert.ok(Math.abs(bandAlphaAt(bottom, Math.round(0.62 * H), H) - 0.2) < 0.01);
      assert.equal(bandAlphaAt(top, Math.round(0.3 * H) + 1, H), 0);
      assert.equal(bandAlphaAt(bottom, Math.round(0.5 * H), H), 0);
    }
  });
});

describe("O119: when the photo runs out", () => {
  it("below the chin: the format is skipped with the exact line", () => {
    const face = { eyeX: 1000, eyeY: 1200, headTopY: 1000, chinY: 1400 };
    const plan = planFormatPhoto({ width: 2000, height: 1500 }, face, "4:5", 1);
    assert.equal(plan.skip, "Face too low for 4:5: the photo ends 100 px below the chin");
  });
  it("at a side: extended by up to 0.12 W, then the off-centre line", () => {
    const face = { eyeX: 300, eyeY: 1200, headTopY: 1000, chinY: 1400 };
    const plan = planFormatPhoto({ width: 2000, height: 3000 }, face, "4:5", 0.6);
    assert.equal(plan.need.left, Math.ceil(540 - 300 * plan.scale));
    const max = Math.round(FORMAT_RULES.maxSide * 1080);
    const extended = frameLeft(plan, Math.round(2000 * plan.scale), { top: 0, left: Math.min(plan.need.left, max), right: 0 }, face.eyeX);
    const bare = frameLeft(plan, Math.round(2000 * plan.scale), { top: 0, left: 0, right: 0 }, face.eyeX);
    assert.equal(bare.side, "left");
    assert.ok(Math.abs(extended.off) < Math.abs(bare.off));
    if (plan.need.left <= max) assert.equal(extended.side, null);
  });
  it("a claim that can't keep 0.02 H under the info steps down, then holds at O23's floor", () => {
    const claim: CardClaimPlan = { kind: "two-line", lines: [], k: 1, blockTop: 1559 - 140, bottom: 1559, dropped: [] };
    assert.equal((claimTransform(claim, "4:5", 1100) as { stepped: number }).stepped, 1);
    const stepped = claimTransform(claim, "4:5", 1110);
    if ("held" in stepped) return assert.fail(stepped.held);
    assert.ok(stepped.stepped < 1);
    assert.ok(Math.abs(1274 - 140 * stepped.t.k - (1110 + 0.02 * 1350)) < 1e-6);
    assert.deepEqual(claimTransform(claim, "4:5", 1200), { held: CARD_CLAIM.tooLong });
  });
});

describe("the no-text check counts drawn text pixels, not boxes", () => {
  it("ink inside the rectangle counts; a box that only touches its empty corner doesn't", async () => {
    const png = await sharp({ create: { width: 100, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 50, height: 40, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer(), left: 50, top: 0 }])
      .png()
      .toBuffer();
    const p: Piece = { png, width: 100, height: 40, capPx: 40, label: "line" };
    const at = { left: 0, top: 0, width: 100, height: 40, label: "line", scale: 1, short: false, stepped: false, belowFloor: false };
    assert.equal((await inkInRect([p], [at], { left: 0, top: 0, width: 40, height: 40 })).count, 0);
    assert.equal((await inkInRect([p], [at], { left: 60, top: 10, width: 10, height: 10 })).count, 100);
  });
});

describe("the fixture card, rendered (AF-A, AF-B)", () => {
  it("each format is made, the eyes within 0.01 W of centre and in band, no text in the grown face box, the claim 0.02 H under the info", async () => {
    const res = await renderClaimCard(await fixtureCardInput());
    assert.ok(res.placed && res.master, res.held ?? "not placed");
    for (const format of ["4:5", "1:1"] as const) {
      const f = res.formats[format]!;
      assert.equal(f.made, true, f.skipped ?? "");
      const H = format === "4:5" ? 1350 : 1080;
      const band = FORMAT_SLOTS[format].face;
      assert.ok(Math.abs(f.eyeX - 0.5) <= FORMAT_RULES.centreTolerance, `${format} eyes ${f.eyeX} W`);
      assert.ok(f.plan.eyes >= band.eyesMin && f.plan.eyes <= band.eyesMax && f.plan.headTop >= band.headTopMin && f.plan.chin <= band.chinMax);
      // The zone is the face box grown by 0.02 H; the composer refuses a format with any text pixel in it.
      assert.ok(f.faceZone!.top <= f.plan.headTop * H - 0.02 * H + 1e-6 && f.faceZone!.top + f.faceZone!.height >= f.plan.chin * H + 0.02 * H - 1e-6);
      const infoBottom = Math.max(...f.placements.filter((p) => p.label.startsWith("info")).map((p) => p.top + p.height));
      assert.ok(f.claimRect!.top >= infoBottom + 0.02 * H - 1, `${format}: claim ${f.claimRect!.top} vs info ${infoBottom}`);
      const meta = await sharp(f.png!).metadata();
      assert.deepEqual([meta.width, meta.height], [1080, H]);
      // The fixture's pieces are fixed ink boxes (framing-fixture.ts), so this margin is the same on every platform;
      // it was 2.6 px on macOS and under 0 on Linux while the stand-ins took their size from the text engine.
      const name = f.placements.find((p) => p.label === "name")!;
      assert.ok(f.faceZone!.top - (name.top + name.height) >= 0.02 * H, `${format}: name ends ${name.top + name.height}, zone starts ${f.faceZone!.top}`);
      assert.equal(f.skipped, null);
    }
  });
});

describe(`the 9:16 is pixel-identical to ${PARENT}'s`, () => {
  const parentDir = join(process.cwd(), ".scratch", `parent-${PARENT}`);
  const parent = async (path: string) => {
    if (!existsSync(join(parentDir, path))) {
      mkdirSync(parentDir, { recursive: true });
      const tar = execFileSync("git", ["archive", PARENT, "lib", "src"], { maxBuffer: 1 << 30 });
      execFileSync("tar", ["-x", "-C", parentDir], { input: tar });
    }
    return import(pathToFileURL(join(parentDir, path)).href);
  };
  const pixels = async (png: Buffer) => sharp(png).ensureAlpha().raw().toBuffer();

  it("renderClaimCard (the roll-call card)", async () => {
    const input = await fixtureCardInput();
    const old = await (await parent("lib/creative-lab/artist-card-claim.ts")).renderClaimCard(input);
    const now = await renderClaimCard(input);
    assert.ok(old.master && now.master);
    assert.ok((await pixels(old.master)).equals(await pixels(now.master!)));
  });
  it("renderCard (no claim)", async () => {
    const input = await fixtureCardInput();
    const card = { photo: input.photo, face: input.face, eyes: input.eyes, subjects: 1, name: input.name, info: input.info, lockup: input.lockup, gradientShadow: input.bands ?? undefined };
    const old = await (await parent("lib/creative-lab/artist-card.ts")).renderCard(card);
    const now = await renderCard(card);
    assert.ok((await pixels(old.master)).equals(await pixels(now.master)));
    for (const format of ["4:5", "1:1"] as const) assert.equal(now.formats[format]?.made, true, `${format}: ${now.formats[format]?.skipped ?? "missing"}`);
  });
});
