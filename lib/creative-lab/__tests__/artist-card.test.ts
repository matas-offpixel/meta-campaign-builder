import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MASTER,
  MAX_EXTEND_TOP,
  SAFE,
  SLOTS,
  cardFileName,
  cardFolderKey,
  checkLayout,
  judgePhoto,
  layoutText,
  lowContrastShare,
  measureHeadTop,
  pieceScale,
  planFaceCrop,
  relativeLuminance,
  textBoxRect,
  type CropPlan,
  type Piece,
} from "../artist-card.ts";

function piece(label: string, width: number, height: number, capPx = height): Piece {
  return { label, width, height, capPx, png: Buffer.alloc(0) };
}

/** The P26-BDAY STATIC pieces' ink sizes. */
const LOCKUP = piece("lockup", 1851, 558);
const ENZO = piece("ENZO SIRAGUSA", 2071, 476);
const LUKE = piece("LUKE DEAN", 1388, 469);
const INFO = [piece("CIRCUIT > SOUTHAMPTON", 1201, 183), piece("SUNDAY 27TH DECEMBER", 1206, 182), piece("1PM > 9:30PM", 602, 180)];

describe("slot table (fix round 1)", () => {
  it("SAFE is the 4:5 band with 76 px insets, 361–1559 (0.812 H)", () => {
    assert.deepEqual(SAFE, { top: 361, bottom: 1559 });
    assert.equal(Math.round(0.812 * 1920), SAFE.bottom);
  });

  it("lockup 0.28 W at y 361; name 28 px under it at cap 220; info 36 px under the name, cap 60, pitch 83", () => {
    const layout = layoutText({ lockup: LOCKUP, name: LUKE, info: INFO });
    assert.equal(layout.lockup!.width, 302);
    assert.equal(layout.lockup!.top, 361);
    assert.equal(layout.lockup!.left, Math.round((1080 - 302) / 2));
    assert.equal(layout.name.top, layout.lockup!.top + layout.lockup!.height + 28);
    assert.equal(layout.name.height, 220);
    assert.equal(layout.name.stepped, false);
    const firstCapTop = layout.name.top + layout.name.height + 36;
    // Each info line sits on its cap line: the tallest cap is 60 px, the pitch 83.
    const baselines = layout.info.map((p) => p.top + p.height);
    assert.ok(Math.abs(baselines[0]! - (firstCapTop + 0.031 * 1920)) <= 1);
    assert.ok(Math.abs(baselines[1]! - baselines[0]! - 0.043 * 1920) <= 1);
    assert.ok(Math.abs(baselines[2]! - baselines[1]! - 0.043 * 1920) <= 1);
    const check = checkLayout(layout);
    assert.equal(check.insideSafe, true);
    assert.equal(check.insideTextBox, true);
    assert.ok(layout.block.top + layout.block.height <= 0.512 * 1920);
  });

  it("a long name steps down to 0.80 W and stays above the floor", () => {
    const layout = layoutText({ lockup: LOCKUP, name: ENZO, info: INFO });
    assert.equal(layout.name.width, 864);
    assert.equal(layout.name.stepped, true);
    assert.equal(layout.name.belowFloor, false);
  });

  it("pieceScale never enlarges and flags the floor", () => {
    assert.deepEqual(pieceScale({ width: 300, capPx: 100 }, SLOTS.name), { scale: 1, short: true, stepped: false, belowFloor: false });
    assert.equal(pieceScale({ width: 4000, capPx: 250 }, SLOTS.name).belowFloor, true);
  });
});

describe("planFaceCrop", () => {
  it("puts the head, eyes and chin in their bands as large as they allow", () => {
    // 4000×6000 portrait, head top 2800, eyes 3200, chin 3600: plenty of photo above.
    const plan = planFaceCrop({ width: 4000, height: 6000 }, { eyeX: 2000, eyeY: 3200, headTopY: 2800, chinY: 3600 });
    assert.ok(plan.headTop >= 0.53 - 1e-3);
    assert.ok(plan.eyes >= 0.58 - 1e-3 && plan.eyes <= 0.64 + 1e-3);
    assert.ok(plan.chin <= 0.76 + 1e-3);
    assert.ok(plan.scale <= 1);
    assert.equal(plan.extendTop, 0);
    assert.equal(plan.clamped.y, false);
    // Largest: one of the two bands is met exactly.
    assert.ok(Math.abs(plan.headTop - 0.53) < 2e-3 || Math.abs(plan.chin - 0.76) < 2e-3);
  });

  it("never upscales: a small photo stays at 1.0× even when the bands would allow more", () => {
    const plan = planFaceCrop({ width: 1080, height: 1920 }, { eyeX: 540, eyeY: 1180, headTopY: 1120, chinY: 1240 });
    assert.equal(plan.scale, 1);
  });

  it("a face too high stays too high without an extension, and drops into the band with one", () => {
    const photo = { width: 5486, height: 3657 };
    const face = { eyeX: 3000, eyeY: 1300, headTopY: 880, chinY: 1700 };
    const stuck = planFaceCrop(photo, face);
    assert.ok(stuck.eyes < 0.58);
    assert.equal(stuck.extendTop, 0);
    const extended = planFaceCrop(photo, face, MASTER, { maxExtendTop: MAX_EXTEND_TOP });
    assert.ok(extended.extendTop > 0 && extended.extendTop <= MAX_EXTEND_TOP);
    assert.ok(extended.eyes >= 0.58 - 1e-3 && extended.eyes <= 0.64 + 1e-3);
  });
});

describe("measureHeadTop", () => {
  it("finds where the backdrop takes over above the brows", () => {
    // 100×200 RGB: grey backdrop, a dark head from row 80 to 160 in columns 30–70.
    const w = 100;
    const h = 200;
    const rgb = new Uint8Array(w * h * 3).fill(120);
    for (let y = 80; y < 160; y += 1) for (let x = 30; x < 70; x += 1) rgb.fill(20, (y * w + x) * 3, (y * w + x) * 3 + 3);
    assert.equal(measureHeadTop(rgb, w, h, 3, { eyeX: 50, browY: 110, chinY: 160, box: { width: 40 } }), 80);
  });

  it("refuses a measurement outside 0.25–1.0 × (chin − brow)", () => {
    const rgb = new Uint8Array(100 * 200 * 3).fill(120);
    assert.equal(measureHeadTop(rgb, 100, 200, 3, { eyeX: 50, browY: 110, chinY: 160, box: { width: 40 } }), null);
  });
});

describe("photo rules", () => {
  it("contrast with white: relative luminance above 0.30 is below 3:1", () => {
    assert.ok(Math.abs(relativeLuminance(255, 255, 255) - 1) < 1e-9);
    assert.equal(relativeLuminance(0, 0, 0), 0);
    for (const v of [100, 140, 150, 160, 200]) {
      const L = relativeLuminance(v, v, v);
      assert.equal(1.05 / (L + 0.05) < 3, L > 0.3);
    }
  });

  it("lowContrastShare counts the bright pixels in a rect", () => {
    const w = 10;
    const data = new Uint8Array(w * 10 * 3);
    data.fill(255, 0, 20 * 3); // rows 0–1 white
    assert.equal(lowContrastShare(data, w, 3, { left: 0, top: 0, width: 10, height: 10 }), 0.2);
    assert.equal(lowContrastShare(data, w, 3, { left: 0, top: 2, width: 10, height: 8 }), 0);
  });

  it("the text box is 0.188–0.512 H inside the side insets", () => {
    const r = textBoxRect();
    assert.equal(r.left, 76);
    assert.equal(r.width, 1080 - 152);
    assert.ok(Math.abs(r.top - 0.188 * 1920) < 1e-9);
    assert.ok(Math.abs(r.top + r.height - 0.512 * 1920) < 1e-9);
  });

  const good: CropPlan = { scale: 0.5, left: 0, top: 0, headTop: 0.54, eyes: 0.61, chin: 0.74, clamped: { x: false, y: false }, extendTop: 0 };

  it("passes a photo inside every rule", () => {
    assert.ok(judgePhoto({ contrastShare: 0.05, subjects: 1, plan: good }).every((r) => r.pass));
  });

  it("fails each rule on its own", () => {
    const failed = (input: Parameters<typeof judgePhoto>[0]) => judgePhoto(input).filter((r) => !r.pass).map((r) => r.rule);
    assert.deepEqual(failed({ contrastShare: 0.101, subjects: 1, plan: good }), ["contrast"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 2, plan: good }), ["subject"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 1, plan: { ...good, scale: 1.2 } }), ["scale"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 1, plan: { ...good, headTop: 0.5 } }), ["face"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 1, plan: { ...good, eyes: 0.66 } }), ["face"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 1, plan: { ...good, chin: 0.78 } }), ["face"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 0, plan: null }), ["subject", "face"]);
  });
});

describe("routing and names", () => {
  const helpers = { cycleKeyFor: () => "03/3/wc/2026-11-09", showWeekMonday: (d: string | null) => (d ? "2026-12-21" : null) };
  it("on sale → the cycle's Content; presale → Presale live; show week → 4 Show week", () => {
    assert.equal(cardFolderKey({ stage: "on-sale", today: "2026-11-09", eventDate: "2026-12-27", ...helpers }), "03/3/wc/2026-11-09/content");
    assert.equal(cardFolderKey({ stage: "presale", today: "2026-11-09", eventDate: "2026-12-27", ...helpers }), "03/2/presale-live");
    assert.equal(cardFolderKey({ stage: "on-sale", today: "2026-12-22", eventDate: "2026-12-27", ...helpers }), "03/4");
  });

  it("file names carry the format and the version", () => {
    assert.equal(cardFileName({ eventCode: "P26-BDAY", artistSlug: "enzo-siragusa", pick: 1, stage: "on-sale", format: "9x16" }), "P26-BDAY_enzo-siragusa_artist-card-1_on-sale_9x16.png");
    assert.equal(cardFileName({ eventCode: "P26-BDAY", artistSlug: "luke-dean", pick: 2, stage: "on-sale", format: "1x1", version: 3 }), "P26-BDAY_luke-dean_artist-card-2_on-sale_1x1_v3.png");
  });
});
