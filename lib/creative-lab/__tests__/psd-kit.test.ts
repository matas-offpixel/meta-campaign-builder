import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Layer, PixelData, Psd } from "ag-psd";

import {
  buildManifest,
  colorHex,
  identifyRoles,
  inkBands,
  kitPrefix,
  kitSlug,
  layerAt,
  layerFileName,
  splitTextLines,
  summarizeEffects,
  transformScaleY,
  walkLayers,
} from "../psd-kit.ts";

/** RGBA pixels with ink (alpha 255) on the given rows, columns from..to. */
function pixels(width: number, height: number, inked: { rows: [number, number]; cols: [number, number] }[]): PixelData {
  const data = new Uint8Array(width * height * 4);
  for (const { rows, cols } of inked) {
    for (let y = rows[0]; y < rows[1]; y += 1) {
      for (let x = cols[0]; x < cols[1]; x += 1) {
        const i = (y * width + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

/** A small stand-in for the Puzzle Birthday story PSD (children bottom first, as ag-psd reads them). */
function fixturePsd(): Psd {
  const names: Layer = {
    name: "PART 1 ENZO SIRAGUSA LUKE DEAN REESHY",
    left: 10,
    top: 20,
    right: 90,
    bottom: 80,
    text: {
      text: "PART 1\rENZO SIRAGUSA\rLUKE DEAN\r& REESHY",
      transform: [0.5, 0, 0, 0.5, 0, 0],
      style: { font: { name: "BootzyCondensedTM-Regular" }, fontSize: 112.61, tracking: 0, fillColor: { r: 255, g: 255, b: 255 } },
      styleRuns: [
        { length: 7, style: { fillColor: { r: 254, g: 50, b: 50 } } },
        { length: 24, style: {} },
        { length: 8, style: {} },
      ],
    },
    effects: { dropShadow: [{ enabled: true, opacity: 0.25, angle: 90, distance: { units: "Pixels", value: 8 }, size: { units: "Pixels", value: 10 }, color: { r: 0, g: 0, b: 0 } }] },
    imageData: pixels(80, 60, [
      { rows: [0, 8], cols: [20, 60] },
      { rows: [14, 24], cols: [0, 80] },
      { rows: [30, 40], cols: [10, 70] },
      { rows: [46, 56], cols: [15, 65] },
    ]),
  };
  const poster: Layer = {
    name: "4th bday poster NEW",
    left: 5,
    top: 5,
    right: 95,
    bottom: 95,
    placedLayer: { id: "so-1", type: "raster", transform: [5, 5, 95, 5, 95, 95, 5, 95], width: 90, height: 90 },
    imageData: pixels(90, 90, [{ rows: [0, 90], cols: [0, 90] }]),
  };
  const hidden: Layer = { name: "uzzle-december-lineup-1080.jpg", hidden: true, left: 0, top: 0, right: 100, bottom: 100, imageData: pixels(100, 100, [{ rows: [0, 100], cols: [0, 100] }]) };
  const background: Layer = { name: "Background", left: 0, top: 0, right: 100, bottom: 100, imageData: pixels(100, 100, [{ rows: [0, 100], cols: [0, 100] }]) };
  const group: Layer = { name: "Group 1", children: [{ name: "inner", left: 0, top: 0, right: 2, bottom: 2, imageData: pixels(2, 2, [{ rows: [0, 2], cols: [0, 2] }]) }] };
  return {
    width: 100,
    height: 100,
    children: [background, poster, names, hidden, group],
    linkedFiles: [{ id: "so-1", name: "4th bday poster NEW.psb", type: "8BPB", data: new Uint8Array([1, 2, 3]) }],
  };
}

describe("walkLayers", () => {
  it("lists the top of the stack first, groups before their children", () => {
    const walked = walkLayers(fixturePsd().children);
    assert.deepEqual(
      walked.map((w) => `${w.ref} ${w.layer.name}`),
      ["0 Group 1", "0/0 inner", "1 uzzle-december-lineup-1080.jpg", "2 PART 1 ENZO SIRAGUSA LUKE DEAN REESHY", "3 4th bday poster NEW", "4 Background"],
    );
  });

  it("layerAt resolves a ref back to the same layer", () => {
    const psd = fixturePsd();
    assert.equal(layerAt(psd, "2")?.name, "PART 1 ENZO SIRAGUSA LUKE DEAN REESHY");
    assert.equal(layerAt(psd, "0/0")?.name, "inner");
    assert.equal(layerAt(psd, "9"), null);
  });
});

describe("buildManifest", () => {
  it("reads kind, visibility, text, fonts and effects", () => {
    const manifest = buildManifest(fixturePsd(), "PUZZLE BIRTHDAY 1 STORY.psd");
    const byName = new Map(manifest.layers.map((l) => [l.name, l]));
    const names = byName.get("PART 1 ENZO SIRAGUSA LUKE DEAN REESHY")!;
    assert.equal(names.kind, "text");
    assert.deepEqual(names.text?.lines, ["PART 1", "ENZO SIRAGUSA", "LUKE DEAN", "& REESHY"]);
    assert.deepEqual(names.text?.fonts, ["BootzyCondensedTM-Regular"]);
    assert.equal(names.text?.size_pt, 112.61);
    assert.equal(names.text?.size_px, 56.31);
    assert.equal(names.text?.runs[0]?.color, "#fe3232");
    assert.equal(names.effects?.shadows[0]?.distance_px, 8);
    assert.equal(names.has_pixels, true);
    assert.deepEqual(names.ink, { left: 10, top: 20, right: 90, bottom: 76, width: 80, height: 56 });
    assert.equal(byName.get("4th bday poster NEW")?.kind, "smart_object");
    assert.equal(byName.get("4th bday poster NEW")?.smart_object?.embedded, true);
    assert.equal(byName.get("uzzle-december-lineup-1080.jpg")?.shown, false);
    assert.equal(byName.get("Group 1")?.kind, "group");
    assert.deepEqual(manifest.fonts, ["BootzyCondensedTM-Regular"]);
  });

  it("lists an embedded smart object's own layers under it, with nested refs", () => {
    const inner: Psd = {
      width: 90,
      height: 90,
      children: [
        { name: "panel", left: 0, top: 0, right: 90, bottom: 90, imageData: pixels(90, 90, [{ rows: [0, 90], cols: [0, 90] }]) },
        { name: "PUZZLE logo", left: 20, top: 10, right: 70, bottom: 20, imageData: pixels(50, 10, [{ rows: [0, 10], cols: [0, 50] }]) },
        { name: "info", left: 20, top: 70, right: 70, bottom: 80, text: { text: "SUN 27 DEC\rCIRCUIT & ENGINE ROOMS\rSOUTHAMPTON" } },
      ],
    };
    const manifest = buildManifest(fixturePsd(), "x.psd", { readNested: () => inner });
    const poster = manifest.layers.find((l) => l.name === "4th bday poster NEW")!;
    assert.deepEqual(
      poster.smart_object?.layers.map((l) => `${l.ref} ${l.name}`),
      ["3>0 info", "3>1 PUZZLE logo", "3>2 panel"],
    );
    const roles = identifyRoles(manifest, { headliners: ["Enzo Siragusa", "Luke Dean", "Reeshy"], venue: "Circuit & Engine Rooms", city: "Southampton" });
    assert.deepEqual(
      roles.map((r) => `${r.role} ${r.ref}`),
      ["headliner_names 2", "info 3>0", "logo 3>1", "background 4"],
    );
  });

  it("records a nested read failure instead of throwing", () => {
    const manifest = buildManifest(fixturePsd(), "x.psd", {
      readNested: () => {
        throw new Error("unsupported");
      },
    });
    assert.equal(manifest.layers.find((l) => l.kind === "smart_object")?.smart_object?.read_error, "unsupported");
  });
});

describe("inkBands / splitTextLines", () => {
  it("finds one band per line, each with its own width", () => {
    const bands = inkBands(fixturePsd().children![2]!.imageData!);
    assert.deepEqual(bands, [
      { top: 0, bottom: 8, left: 20, right: 60 },
      { top: 14, bottom: 24, left: 0, right: 80 },
      { top: 30, bottom: 40, left: 10, right: 70 },
      { top: 46, bottom: 56, left: 15, right: 65 },
    ]);
  });

  it("bridges a small gap inside a line", () => {
    const px = pixels(10, 30, [
      { rows: [0, 4], cols: [0, 10] },
      { rows: [5, 9], cols: [0, 10] },
      { rows: [20, 25], cols: [0, 10] },
    ]);
    assert.deepEqual(inkBands(px, { gap: 2 }).map((b) => [b.top, b.bottom]), [[0, 9], [20, 25]]);
  });

  it("pairs lines with bands only when the counts match", () => {
    const px = fixturePsd().children![2]!.imageData!;
    assert.equal(splitTextLines(px, ["PART 1", "ENZO SIRAGUSA", "LUKE DEAN", "& REESHY"])?.[1]?.line, "ENZO SIRAGUSA");
    assert.equal(splitTextLines(px, ["PART 1", "ENZO SIRAGUSA"]), null);
  });
});

describe("helpers", () => {
  it("colour, effects, transform", () => {
    assert.equal(colorHex({ r: 254, g: 50, b: 50 }), "#fe3232");
    assert.equal(colorHex({ fr: 1, fg: 0, fb: 0.5 }), "#ff0080");
    assert.equal(colorHex(null), null);
    assert.equal(summarizeEffects({}), null);
    assert.deepEqual(summarizeEffects({ outerGlow: { enabled: true } })?.other, ["outerGlow"]);
    assert.equal(transformScaleY([2, 0, 0, 3, 10, 10]), 3);
    assert.equal(transformScaleY(undefined), 1);
  });

  it("names", () => {
    assert.equal(kitSlug("PUZZLE BIRTHDAY 1 STORY.psd"), "puzzle-birthday-1-story");
    assert.equal(kitPrefix("ev1", "PUZZLE BIRTHDAY 1 STATIC.psd"), "kits/ev1/puzzle-birthday-1-static/");
    assert.equal(layerFileName({ ref: "3>1", name: "PUZZLE logo" }), "layers/03_01-puzzle-logo.png");
    assert.equal(layerFileName({ ref: "2", name: "PART 1 ENZO SIRAGUSA & BENJI" }), "layers/02-part-1-enzo-siragusa-benji.png");
  });
});
