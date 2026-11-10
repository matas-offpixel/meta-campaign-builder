import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { EMPTY_CLAIM, judgePhoto, layoutText, NO_EXTENSION, type CropPlan, type Piece } from "../artist-card.ts";
import { planHeadlinerCard } from "../artist-card-lab.ts";
import { REESHY_NO_PHOTO } from "../artist-card-gate-copy.ts";
import { identifyRoles, KIT_CORAL, liveTextAccount, type KitLayer, type KitManifest, type RoleFacts } from "../psd-kit.ts";

const placed: CropPlan = {
  scale: 0.5,
  left: 0,
  top: 0,
  headTop: 0.54,
  eyes: 0.61,
  chin: 0.74,
  clamped: { x: false, y: false },
  extend: NO_EXTENSION,
  faceWidthPx: 278,
};

function piece(label: string, width: number, height: number): Piece {
  return { label, width, height, capPx: height, png: Buffer.alloc(0) };
}

describe("claim slot", () => {
  it("stays empty unless a later ruling fills it", () => {
    const layout = layoutText({
      lockup: piece("lockup", 1851, 558),
      name: piece("LUKE DEAN", 1388, 469),
      info: [piece("CIRCUIT > SOUTHAMPTON", 1201, 183)],
    });
    assert.deepEqual(layout.claim, EMPTY_CLAIM);
    assert.equal(layout.lockup?.width, 302);
  });
});

describe("variant A only", () => {
  it("keeps a passing photo and the extension line, and never a cut-out", () => {
    const card = planHeadlinerCard(
      [
        { name: "Enzo 2", rules: judgePhoto({ contrastShare: 0.18, subjects: 1, plan: placed }) },
        { name: "Enzo 46", rules: judgePhoto({ contrastShare: 0, subjects: 1, plan: placed, eyes: { ok: false, why: "a pure profile" } }) },
        {
          name: "Enzo 1",
          rules: judgePhoto({ contrastShare: 0.002, subjects: 1, plan: { ...placed, headTop: 0.53, eyes: 0.64, chin: 0.745, faceWidthPx: 268 } }),
          extension: { top: 540, left: 0, right: 0 },
        },
      ],
      "enzosiragusa",
    );
    assert.deepEqual(card, {
      kind: "A",
      photoName: "Enzo 1",
      approvalLine: "photo extended top by 540 px",
      claim: { text: null },
    });
  });

  it("refuses Enzo 2, Reeshy 2 and Enzo 46 on the rule each fails", () => {
    const refused = [
      ["Enzo 2", judgePhoto({ contrastShare: 0.18, subjects: 1, plan: placed })],
      ["Reeshy 2", judgePhoto({ contrastShare: 0, subjects: 1, plan: { ...placed, scale: 1.3, faceWidthPx: 239 } })],
      ["Enzo 46", judgePhoto({ contrastShare: 0, subjects: 1, plan: placed, eyes: { ok: false, why: "a pure profile" } })],
    ] as const;
    const card = planHeadlinerCard(
      refused.map(([name, rules]) => ({ name, rules })),
      "reeshy",
    );
    assert.equal(card.kind, "no-photo");
    if (card.kind !== "no-photo") return;
    assert.deepEqual(card.reasons, [
      "Enzo 2 — 18.0 % of the text box below 3:1 (max 10 %)",
      "Reeshy 2 — 1.300× source",
      "Enzo 46 — not measurable: a pure profile",
    ]);
    assert.equal(card.instagramLine, "PLACEHOLDER: a passing photo can come from @reeshy on Instagram.");
  });

  it("an extension that fails colour test (b) stays off the card", () => {
    const card = planHeadlinerCard(
      [
        { name: "Reeshy 2", rules: judgePhoto({ contrastShare: 0, subjects: 1, plan: { ...placed, scale: 1.3, faceWidthPx: 239 } }) },
        {
          name: "17 37 02",
          rules: judgePhoto({ contrastShare: 0.04, subjects: 1, plan: { ...placed, faceWidthPx: 239 } }),
          extensionFailure: "drift across the strip 19.98 (max 3)",
        },
      ],
      "reeshy",
    );
    assert.deepEqual(card, REESHY_NO_PHOTO);
  });

  it("AC1, AC2 and AC3 pass on the recorded figures", () => {
    const ac1 = judgePhoto({ contrastShare: 0.007, subjects: 1, plan: { ...placed, headTop: 0.53, eyes: 0.64, chin: 0.745, faceWidthPx: 278 } });
    const ac2 = judgePhoto({ contrastShare: 0.043, subjects: 1, plan: { ...placed, headTop: 0.54, eyes: 0.64, chin: 0.735, faceWidthPx: 239 } });
    const ac3 = judgePhoto({ contrastShare: 0.002, subjects: 1, plan: { ...placed, headTop: 0.53, eyes: 0.64, chin: 0.745, faceWidthPx: 268 } });
    for (const rules of [ac1, ac2, ac3]) assert.ok(rules.every((rule) => rule.pass));
    assert.match(ac1.find((rule) => rule.rule === "face")!.detail, /face box 278 px/);
    assert.match(ac2.find((rule) => rule.rule === "contrast")!.detail, /4\.3 %/);
    assert.match(ac3.find((rule) => rule.rule === "contrast")!.detail, /0\.2 %/);
  });
  it("does not mention a matte or a cut-out", () => {
    const src = readFileSync(new URL("../artist-card-lab.ts", import.meta.url), "utf8");
    assert.equal(src.includes("artist-card-cutout"), false);
    assert.equal(src.includes("Waiting on the cut-out"), false);
    assert.equal(src.includes("plain ground"), false);
  });
});

const FACTS: RoleFacts = { headliners: ["Enzo Siragusa", "Luke Dean", "Reeshy"], venue: "Circuit", city: "Southampton" };

function layer(partial: Pick<KitLayer, "ref" | "name" | "kind"> & Partial<KitLayer>): KitLayer {
  return {
    path: [],
    bounds: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
    visible: true,
    shown: true,
    opacity: 1,
    blend_mode: "normal",
    clipping: false,
    effects: null,
    text: null,
    smart_object: null,
    has_pixels: true,
    ink: null,
    ...partial,
  };
}

function auditManifest(file: string): KitManifest {
  const text = layer({
    ref: "2",
    name: "PART 1 ENZO SIRAGUSA LUKE DEAN REESHY",
    kind: "text",
    text: {
      content: "PART 1\nENZO SIRAGUSA\nLUKE DEAN\nCIRCUIT > SOUTHAMPTON\nSUNDAY 27TH DECEMBER\n1PM > 9:30PM",
      lines: ["PART 1", "ENZO SIRAGUSA", "LUKE DEAN", "CIRCUIT > SOUTHAMPTON", "SUNDAY 27TH DECEMBER", "1PM > 9:30PM"],
      fonts: ["BootzyCondensedTM-Regular"],
      size_pt: 644,
      size_px: 220,
      tracking: 5,
      leading: null,
      runs: [
        { text: "PART 1", font: "BootzyCondensedTM-Regular", size_pt: 371.67, size_px: null, tracking: 5, color: KIT_CORAL },
        { text: "ENZO SIRAGUSA", font: "BootzyCondensedTM-Regular", size_pt: 644.22, size_px: null, tracking: 5, color: "#ffffff" },
        { text: "&", font: "BootzyCondensedTM-Regular", size_pt: 644.22, size_px: null, tracking: 5, color: KIT_CORAL },
        { text: ">", font: "BootzyCondensedTM-Regular", size_pt: 247.78, size_px: null, tracking: 5, color: KIT_CORAL },
      ],
    },
  });
  return {
    psd: file,
    width: 1000,
    height: 1000,
    ppi: 300,
    bits_per_channel: 8,
    color_mode: "RGB",
    has_composite: true,
    fonts: ["BootzyCondensedTM-Regular"],
    layers: [
      layer({ ref: "0", name: "PAD1 PUZZLE", kind: "pixel" }),
      text,
      layer({ ref: "3", name: "4th bday poster NEW", kind: "smart_object", smart_object: { linked_file_id: null, linked_file_name: null, linked_file_type: null, embedded: true, width: null, height: null, layers: [], read_error: null } }),
      layer({ ref: "4", name: "Background", kind: "pixel", bounds: { left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 } }),
    ],
  };
}

describe("H13 live text", () => {
  for (const file of ["PUZZLE BIRTHDAY 1 STATIC.psd", "STORY.psd"]) {
    it(`${file}: one text layer, names and info, three coral runs, no effects, one panel, one lockup`, () => {
      const manifest = auditManifest(file);
      assert.deepEqual(liveTextAccount(manifest.layers, FACTS), {
        textLayers: 1,
        runs: ["names", "info"],
        coralRuns: ["PART 1", "&", ">"],
        effects: "no effects",
      });
      const roles = identifyRoles(manifest, FACTS).map((hit) => `${hit.role} ${hit.ref}`);
      assert.ok(roles.includes("headliner_names 2"));
      assert.ok(roles.includes("info 2"));
      assert.ok(roles.includes("logo 0"));
      assert.ok(roles.includes("panel 3"));
      assert.equal(roles.filter((role) => role.startsWith("logo")).length, 1);
      assert.equal(roles.filter((role) => role.startsWith("panel")).length, 1);
    });
  }
});
