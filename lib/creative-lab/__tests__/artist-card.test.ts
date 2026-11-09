import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MASTER,
  RECT_45,
  SLOTS,
  cardFileName,
  cardFolderKey,
  checkCard,
  pieceScale,
  placeCentred,
  placeDetails,
  planPhotoCrop,
  type Piece,
} from "../artist-card.ts";

const frame = MASTER;

function piece(label: string, width: number, height: number, capPx = height): Piece {
  return { label, width, height, capPx, png: Buffer.alloc(0) };
}

describe("planPhotoCrop", () => {
  it("covers the frame and lands the face centre on the target when the photo allows", () => {
    // 4000×6000 portrait, face 300 px tall around (2000, 2600).
    const plan = planPhotoCrop({ width: 4000, height: 6000 }, { x: 1850, y: 2450, width: 300, height: 300 }, frame);
    assert.ok(plan.scale >= Math.max(1080 / 4000, 1920 / 6000));
    assert.equal(plan.clamped.y, false);
    assert.ok(Math.abs(plan.face.top + plan.face.height / 2 - ((0.4391 + 0.7536) / 2) * 1920) < 1);
    assert.ok(Math.abs(plan.face.left + plan.face.width / 2 - 540) < 1);
    assert.ok(Math.abs(plan.face.height - 0.13 * 1920) < 1);
    assert.equal(plan.upscaled, false);
  });

  it("zooms in so a face high in the photo still reaches the face band", () => {
    // 2:3 portrait, face centred 35 % down: at cover the face would sit at 0.35 H.
    const plan = planPhotoCrop({ width: 4000, height: 6000 }, { x: 1800, y: 1900, width: 400, height: 400 }, frame);
    assert.ok(plan.top >= 0);
    assert.equal(plan.clamped.y, false);
    assert.ok(Math.abs(plan.face.top + plan.face.height / 2 - ((0.4391 + 0.7536) / 2) * 1920) < 1);
    assert.ok(plan.face.height <= (0.7536 - 0.4391) * 1920 + 1);
  });

  it("stops zooming at a face as tall as the band, and reports the clamp", () => {
    const plan = planPhotoCrop({ width: 1080, height: 1920 }, { x: 440, y: 100, width: 200, height: 200 }, frame);
    assert.ok(plan.top >= 0);
    assert.ok(Math.abs(plan.face.height - (0.7536 - 0.4391) * 1920) < 1);
    assert.equal(plan.clamped.y, true);
  });

  it("without a face: cover, centred", () => {
    const plan = planPhotoCrop({ width: 3000, height: 2000 }, null, frame);
    assert.equal(plan.scale, 1920 / 2000);
    assert.equal(plan.top, 0);
    assert.equal(Math.round(plan.left), Math.round((3000 * plan.scale - 1080) / 2));
  });
});

describe("pieceScale", () => {
  it("scales to the slot cap", () => {
    const fit = pieceScale({ width: 400, capPx: 250 }, SLOTS.name, frame);
    assert.ok(Math.abs(fit.scale - (0.1146 * 1920) / 250) < 1e-9);
    assert.equal(fit.stepped, false);
    assert.equal(fit.short, false);
  });

  it("steps down to the max width", () => {
    const fit = pieceScale({ width: 1500, capPx: 250 }, SLOTS.name, frame);
    assert.equal(fit.scale, 864 / 1500);
    assert.equal(fit.stepped, true);
    assert.equal(fit.belowFloor, false);
  });

  it("flags a piece that needs enlarging and keeps it at 1:1", () => {
    const fit = pieceScale({ width: 300, capPx: 100 }, SLOTS.name, frame);
    assert.equal(fit.scale, 1);
    assert.equal(fit.short, true);
  });

  it("flags stepping under the floor", () => {
    const fit = pieceScale({ width: 4000, capPx: 250 }, SLOTS.name, frame);
    assert.equal(fit.belowFloor, true);
  });
});

describe("placement and check", () => {
  it("centres a piece on its slot", () => {
    const p = placeCentred(piece("name", 800, 200), 1, SLOTS.name.centreY * 1920, frame, { short: false, stepped: false, belowFloor: false });
    assert.equal(p.left, 140);
    assert.equal(p.top, Math.round(0.232 * 1920 - 100));
  });

  it("stacks the details around the slot centre", () => {
    const lines = [piece("a", 300, 60), piece("b", 340, 60), piece("c", 200, 60)];
    const placed = placeDetails(lines, frame);
    assert.equal(placed.length, 3);
    const top = placed[0]!.top;
    const bottom = placed[2]!.top + placed[2]!.height;
    assert.ok(Math.abs((top + bottom) / 2 - 0.371 * 1920) <= 1);
    assert.ok(placed.every((p) => p.width <= 0.328 * 1080 + 1));
  });

  it("reports a covered face and pieces outside the 4:5", () => {
    const face = { left: 450, top: 900, width: 180, height: 220 };
    const ok = checkCard(face, [{ label: "name", left: 140, top: 350, width: 800, height: 200, scale: 1, short: false, stepped: false, belowFloor: false }]);
    assert.deepEqual(ok, { faceInFaceBand: true, faceInside45: true, faceCovered: [], outside45: [], tooCloseToEdge: [] });
    const bad = checkCard(face, [
      { label: "logo", left: 400, top: 1000, width: 200, height: 60, scale: 1, short: false, stepped: false, belowFloor: false },
      { label: "name", left: 20, top: RECT_45.top - 10, width: 1040, height: 200, scale: 1, short: false, stepped: false, belowFloor: false },
    ]);
    assert.deepEqual(bad.faceCovered, ["logo"]);
    assert.deepEqual(bad.outside45, ["name"]);
    assert.deepEqual(bad.tooCloseToEdge, ["name"]);
  });
});

describe("routing and names", () => {
  const helpers = { cycleKeyFor: () => "03/3/wc/2026-11-09", showWeekMonday: (d: string | null) => (d ? "2026-12-21" : null) };
  it("on sale → the cycle's Content; presale → Presale live; show week → 4 Show week", () => {
    assert.equal(cardFolderKey({ stage: "on-sale", today: "2026-11-09", eventDate: "2026-12-27", ...helpers }), "03/3/wc/2026-11-09/content");
    assert.equal(cardFolderKey({ stage: "presale", today: "2026-11-09", eventDate: "2026-12-27", ...helpers }), "03/2/presale-live");
    assert.equal(cardFolderKey({ stage: "on-sale", today: "2026-12-22", eventDate: "2026-12-27", ...helpers }), "03/4");
  });

  it("file name", () => {
    assert.equal(
      cardFileName({ eventCode: "P26-BDAY", artistSlug: "enzo-siragusa", pick: 1, stage: "on-sale", format: "9x16" }),
      "P26-BDAY_enzo-siragusa_artist-card-1_on-sale_9x16.png",
    );
  });
});
