/**
 * T2 standalone message, rendered locally (overlay-templates issue 1 O1, O4,
 * O6, O8, O12; issue 3 O19 amended, O23 case, O24 fonts, O25 bands). A sharp
 * still, not a Remotion composition: kit fonts may not render on Lambda until
 * Matas confirms each licence (O24; kit-font.ts SERVER_RENDER_ALLOWLIST is
 * empty), so this path only ever reads the face in place from FONTS_DIR.
 *
 * Layers, bottom to top: the ground (the kit's paint), the arrangement's panel
 * (always, on a panel kit: O30), O25's bands (O29), the type and the lockup under one O6 shadow, and the
 * draft watermark. Formats: the 9:16 master, the 4:5 as a pure crop of it
 * (y 285–1635), and the 1:1 as the 4:5 arrangement at 0.8× with the ground
 * re-covered at the sides (O1).
 *
 * The claim slot is the panel's ink box less O26's insets; every step, drop,
 * the meter and the claim-box test measure against it, and no claim line is
 * drawn past it in any format.
 *
 * Every number the card is judged by is returned: the step reached and each
 * line's width against the slot, the claim-box and corner contrast with the
 * bands on, the red line's ink-box test and whether it fell back to white, and
 * the bands' alpha sampled at O25's stops in each format.
 */

import type { Sharp } from "sharp";

import { KIT_SHADOW, MASTER, RECT_45, lowContrastShare, textOverlay, type Piece, type Placement, type Rect, type Size } from "./artist-card.ts";
import { redInkBox, redLineVerdict, watermarkLayer } from "./artist-card-claim.ts";
import { CARD_CLAIM } from "./claim-slot.ts";
import { requireFont, type FontEntry } from "./kit-font.ts";
import { PUZZLE_FLOATING_T2, type T2Kit } from "./overlay-kits.ts";
import { renderGradientShadow, type GradientShadow } from "./overlay-gradient.ts";
import { claimSlot, paperRect, planDetails, planLineup, planLogo, planT2Claim, slotRect, slotWidth, type CornerLine, type MeasureLine, type T2Layout, type T2Plan, type T2Slot } from "./t2-message.ts";

async function sharpLib(): Promise<Sharp> {
  const m = await import("sharp");
  return ((m as unknown as { default: Sharp }).default ?? (m as unknown as Sharp)) as unknown as Sharp;
}
type SharpFn = typeof import("sharp");
const sharpFn = async (): Promise<SharpFn> => (await sharpLib()) as unknown as SharpFn;

// ─── Setting type in the kit face ───────────────────────────────────────────

export type SetLine = { png: Buffer; width: number; height: number; capTopRow: number };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * One line of runs in the kit face, read in place: trimmed to its ink left and
 * right, full line height kept, with the row its cap top falls on (from an "H"
 * set the same way). Tracking in thousandths of an em.
 */
export async function setRuns(runs: readonly { text: string; color: string }[], capPx: number, tracking: number, face: FontEntry): Promise<SetLine> {
  const sharp = await sharpFn();
  const capPerEm = face.capHeight && face.unitsPerEm ? face.capHeight / face.unitsPerEm : null;
  if (!capPerEm) throw new Error(`${face.file} has no OS/2 cap height; lines can't be sized`);
  const sizePx = capPx / capPerEm;
  const spacing = Math.round((tracking / 1000) * sizePx * 1024);
  const set = (markup: string) =>
    sharp({ text: { text: markup, font: `${face.family ?? face.postscriptName} ${sizePx.toFixed(2)}`, fontfile: face.path, dpi: 72, rgba: true } })
      .raw()
      .toBuffer({ resolveWithObject: true });
  const ink = (img: { data: Buffer; info: { width: number; height: number } }) => {
    let top = -1;
    let left = img.info.width;
    let right = -1;
    for (let y = 0; y < img.info.height; y += 1) {
      for (let x = 0; x < img.info.width; x += 1) {
        if (img.data[(y * img.info.width + x) * 4 + 3]! > 8) {
          if (top < 0) top = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    return { top, left, right };
  };
  const span = (r: { text: string; color: string }) => `<span foreground="${r.color}" letter_spacing="${spacing}">${esc(r.text)}</span>`;
  const ref = ink(await set(span({ text: "H", color: "#FFFFFF" })));
  const line = await set(runs.map(span).join(""));
  const box = ink(line);
  if (box.right < 0 || ref.top < 0) throw new Error(`line "${runs.map((r) => r.text).join("")}" set no ink`);
  const width = box.right - box.left + 1;
  const png = await sharp(line.data, { raw: { width: line.info.width, height: line.info.height, channels: 4 } }).extract({ left: box.left, top: 0, width, height: line.info.height }).png().toBuffer();
  return { png, width, height: line.info.height, capTopRow: ref.top };
}

/** Reference cap for measuring: widths scale with the cap (advances and tracking are both per-em). */
export const MEASURE_REF_CAP = 200;

/**
 * Run a synchronous planner with real advance widths (H7): unknown lines are
 * set in the face at the reference cap and the planner re-run until every
 * width it asked for was measured.
 */
export async function withMeasure<T>(face: FontEntry, run: (m: MeasureLine) => T): Promise<T> {
  const cache = new Map<string, number>();
  for (let pass = 0; pass < 8; pass += 1) {
    const missing = new Map<string, { text: string; tracking: number }>();
    const m: MeasureLine = (text, capPx, tracking) => {
      const key = `${tracking}|${text}`;
      const w = cache.get(key);
      if (w != null) return (w * capPx) / MEASURE_REF_CAP;
      missing.set(key, { text, tracking });
      return text.length * 0.35 * capPx;
    };
    const out = run(m);
    if (!missing.size) return out;
    for (const [key, v] of missing) cache.set(key, (await setRuns([{ text: v.text, color: "#FFFFFF" }], MEASURE_REF_CAP, v.tracking, face)).width);
  }
  throw new Error("measuring did not settle");
}

// ─── O25 stops, sampled ─────────────────────────────────────────────────────

/** O25's opacity stops as listed in issue 3, per format (fraction of that format's height → %). */
export const O25_STOPS = {
  master: [
    [0.44, 20], [0.4404, 18], [0.4603, 10], [0.5001, 2], [0.53, 0],
    [0.64, 0], [0.6599, 2], [0.6864, 10], [0.6997, 18], [0.7, 20], [0.78, 30], [0.9, 30],
  ],
  carried: [
    [0.4147, 20], [0.4153, 18], [0.4436, 10], [0.5001, 2], [0.5427, 0],
    [0.6991, 0], [0.7274, 2], [0.7651, 10], [0.784, 18], [0.7844, 20], [0.8982, 30], [0.95, 30],
  ],
} as const;

export type StopSample = { at: number; want: number; got: number; ok: boolean; /** The value of a stop less than a pixel away, when there is one. */ pairedWith?: number[] };

/** H30: a stop is read on a 3 × 3 average and passes within ±1 point of O25. */
export const STOP_TOLERANCE = 1;

/**
 * The bands' alpha (%) at each stop: the 3 × 3 mean around the centre column
 * and the pixel row the stop falls in (H30). Two stops less than a pixel apart
 * (O25's plateau edges: 0.44 / 0.4404 and 0.6997 / 0.7 H in the 9:16, 0.784 /
 * 0.7844 in the 4:5) share one reading, which passes when it lies between
 * their two values, ±1.
 */
export function sampleStops(alpha: Uint8Array | Buffer, size: Size, channels: number, stops: readonly (readonly [number, number])[]): StopSample[] {
  const cx = Math.round(size.width / 2);
  const rowOf = (f: number) => Math.min(size.height - 1, Math.max(0, Math.floor(f * size.height)));
  return stops.map(([at, want], i) => {
    const cy = rowOf(at);
    // A neighbour stop within one pixel row: the pair's range is the target.
    const pair = stops.filter(([b], j) => j !== i && Math.abs(rowOf(b) - cy) <= 1 && Math.abs(b - at) * size.height < 1).map(([, w]) => w);
    let sum = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const y = Math.min(size.height - 1, Math.max(0, cy + dy));
        const x = Math.min(size.width - 1, Math.max(0, cx + dx));
        sum += alpha[(y * size.width + x) * channels + 3]!;
        n += 1;
      }
    }
    const got = Math.round((sum / n / 255) * 1000) / 10;
    const lo = Math.min(want, ...pair) - STOP_TOLERANCE;
    const hi = Math.max(want, ...pair) + STOP_TOLERANCE;
    return { at, want, got, ok: got >= lo && got <= hi, pairedWith: pair.length ? pair : undefined };
  });
}

// ─── Compose ────────────────────────────────────────────────────────────────

export type T2Input = {
  /** The kit's ground (paint), any size; covered to each format. */
  ground: Buffer;
  /** The arrangement's panel at master coordinates. Required on a panel kit (O30); null only on a kit without one. */
  panel: { png: Buffer; left: number; top: number; width: number; height: number } | null;
  bands: GradientShadow | null;
  /** Approved (or sample) claim words, verbatim with their line break. */
  claim: string;
  qualifier?: string | null;
  lineup: readonly string[];
  details: readonly string[];
  /** The kit's lockup, trimmed to its ink. */
  logo: { png: Buffer; width: number; height: number } | null;
  fonts: readonly FontEntry[];
  watermark: string | null;
  /** Draw this ladder state instead of the chosen one (drafts of every O8 step). */
  attempt?: number;
  /** The event's release names, which a line break never splits (O28). */
  releaseNames?: readonly string[];

  kit?: T2Kit;
};

export type T2LineReport = { text: string; color: "red" | "white"; capPx: number; widthPx: number; maxPx: number; fits: boolean; /** Drawn cut at the slot's edges (a draft of a state that doesn't fit). */ cut: boolean };

export type T2Result = {
  held: string | null;
  plan: T2Plan | null;
  /** The ladder state drawn. */
  drawn: number | null;
  layout: T2Layout | null;
  /** The O26 slot, master px. */
  slot: T2Slot | null;
  /** The panel measured on this render (the paper by median edges, and every pixel's box), to check the kit's stored paper (O32). */
  panelInk: PanelInk | null;
  /** The stored paper box matches this render's measurement within 1 px. */
  paperMatches: boolean | null;
  /** Every claim line inside the slot, per format (H27). */
  inSlot: { master: boolean; crop45: boolean; square: boolean } | null;
  lines: T2LineReport[];
  contrast: { claimBox: number | null; redLine: number | null; lineup: number | null; details: number | null };
  redLineWhite: boolean;
  approvalLines: string[];
  rules: { rule: string; pass: boolean; detail: string }[];
  bandStops: { master: StopSample[]; crop45: StopSample[]; square: StopSample[] } | null;
  master: Buffer | null;
  crop45: Buffer | null;
  square: Buffer | null;
  watermark: string | null;
};

const pad = (r: Rect, p: number): Rect => ({ left: r.left - p, top: r.top - p, width: r.width + 2 * p, height: r.height + 2 * p });
const blockRect = (lines: readonly CornerLine[]): Rect => {
  const left = Math.min(...lines.map((l) => l.left));
  const right = Math.max(...lines.map((l) => l.left + l.widthPx));
  const top = lines[0]!.capTop;
  const bottom = lines[lines.length - 1]!.capTop + lines[lines.length - 1]!.capPx;
  return { left, top, width: right - left, height: bottom - top };
};

export async function renderStandaloneMessage(input: T2Input): Promise<T2Result> {
  const sharp = await sharpFn();
  const kit = input.kit ?? PUZZLE_FLOATING_T2;
  const frame = MASTER;
  const out: T2Result = { held: null, plan: null, drawn: null, layout: null, slot: null, panelInk: null, paperMatches: null, inSlot: null, lines: [], contrast: { claimBox: null, redLine: null, lineup: null, details: null }, redLineWhite: false, approvalLines: [], rules: [], bandStops: null, master: null, crop45: null, square: null, watermark: input.watermark };

  // O24: the kit's face or nothing.
  let face: FontEntry;
  try {
    face = requireFont(kit.face, input.fonts);
  } catch (e) {
    return { ...out, held: (e as Error).message.replace(/^Claim held — (.+) not installed$/, "Held — $1 not installed") };
  }

  // O30: a panel kit's T2 always draws the panel; there is no bare-ground option.
  if (kit.panel && !input.panel) return { ...out, held: "T2 on this kit always draws its panel (O30)" };
  if (!kit.panel && input.panel) return { ...out, held: "this kit's T2 has no panel" };

  // O26: the slot from the panel's ink box at its placed size.
  const panelMaster = input.panel ? await sharp(input.panel.png, { limitInputPixels: false }).resize(Math.round(input.panel.width), Math.round(input.panel.height), { fit: "fill" }).png().toBuffer() : null;
  const panelInk = panelMaster ? await panelInkBox(panelMaster, input.panel!.left, input.panel!.top) : null;
  // O32: the slot is the kit's stored paper box; this render's measurement is reported against it.
  const paper = paperRect(kit);
  if (kit.panel && !paper) return { ...out, held: "the kit has no paper box: measure it at the kit audit (O32)" };
  const slot = claimSlot(paper, kit, frame);
  out.slot = slot;
  out.panelInk = panelInk;
  out.paperMatches = panelInk && paper ? (["left", "top", "width", "height"] as const).every((k) => Math.abs(panelInk.box[k] - paper[k]) <= 1) : null;

  // Plan with the face's own advances.
  const planned = await withMeasure(face, (m) => {
    const plan = planT2Claim({ approved: input.claim, qualifier: input.qualifier ?? null, releaseNames: input.releaseNames }, m, kit, frame, { exhaust: input.attempt != null, slot });
    const idx = input.attempt ?? plan.chosen;
    const a = idx != null ? plan.attempts[idx] : plan.attempts[plan.attempts.length - 1];
    return { plan, idx: idx ?? (plan.attempts.length ? plan.attempts.length - 1 : null), layout: a?.layout ?? null, lineup: planLineup(input.lineup, m, {}, kit, frame), details: planDetails(input.details, m, kit, frame) };
  });
  out.plan = planned.plan;
  out.drawn = planned.idx;
  out.layout = planned.layout;
  if (!planned.layout) return { ...out, held: planned.plan.held ?? "no claim to draw" };
  const layout = planned.layout;
  // O34: a state that doesn't fit is drawn (cut at the slot) only as a draft or the flagged preview.
  const fitsDrawn = planned.plan.attempts[planned.idx!]?.fits ?? false;
  if (!fitsDrawn && !input.watermark) return { ...out, held: planned.plan.held ?? "this state doesn't fit the slot; only a draft may draw it" };

  // Ground and arrangement, then the bands (O25), before any type.
  const groundMaster = await sharp(input.ground, { limitInputPixels: false }).resize(frame.width, frame.height, { fit: "cover" }).removeAlpha().png().toBuffer();
  const under = panelMaster ? await sharp(groundMaster).composite([{ input: panelMaster, left: Math.round(input.panel!.left), top: Math.round(input.panel!.top) }]).png().toBuffer() : groundMaster;
  const bandRaw = input.bands ? Buffer.from(renderGradientShadow(input.bands, frame.width, frame.height)) : null;
  const bandLayer = bandRaw ? await sharp(bandRaw, { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toBuffer() : null;
  const shown = bandLayer ? await sharp(under).composite([{ input: bandLayer, left: 0, top: 0 }]).png().toBuffer() : under;
  const raw = await sharp(shown).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  // The claim: the box test on the O26 slot, the red line's ink-box test, then each line set at its size.
  const maxPx = slotWidth(slot);
  const box: Rect = slotRect(slot);
  out.contrast.claimBox = lowContrastShare(raw.data, raw.info.width, raw.info.channels, box);
  out.rules.push({ rule: "claimContrast", pass: out.contrast.claimBox <= CARD_CLAIM.claimBoxMax, detail: `${(out.contrast.claimBox * 100).toFixed(1)} % of the claim slot (${Math.round(box.width)} × ${Math.round(box.height)} px) below 3:1, bands ${input.bands ? "on" : "off"} (max ${CARD_CLAIM.claimBoxMax * 100} %)` });
  const pieces: Piece[] = [];
  const places: Placement[] = [];
  const claimPlaces: Placement[] = [];
  const place = async (s: SetLine, label: string, left: number, capTop: number) => {
    const at: Placement = { label, left: Math.round(left), top: Math.round(capTop - s.capTopRow), width: s.width, height: s.height, scale: 1, short: false, stepped: false, belowFloor: false };
    pieces.push({ png: s.png, width: s.width, height: s.height, capPx: 0, label });
    places.push(at);
    return at;
  };
  // A draft of a state wider than the slot is cut at the slot's edges: no claim line runs past the slot (H27).
  const cutToSlot = async (s: SetLine): Promise<{ s: SetLine; left: number; cut: boolean }> => {
    const w = Math.floor(maxPx);
    if (s.width <= w) return { s, left: layout.centreX - s.width / 2, cut: false };
    const from = Math.floor((s.width - w) / 2);
    return { s: { ...s, png: await sharp(s.png).extract({ left: from, top: 0, width: w, height: s.height }).png().toBuffer(), width: w }, left: Math.ceil(slot.left), cut: true };
  };
  for (const line of layout.lines) {
    let colour = line.color === "red" ? kit.colours.kitRed : kit.colours.white;
    if (line.color === "red") {
      const v = redLineVerdict(raw.data, raw.info.width, raw.info.channels, { capTop: line.capTop, capPx: line.capPx, widthPx: Math.min(line.widthPx, frame.width) }, frame);
      out.contrast.redLine = v.share;
      out.rules.push({ rule: "redLine", pass: true, detail: `${(v.share * 100).toFixed(1)} % of the red line's ink box (${Math.round(redInkBox({ capTop: line.capTop, capPx: line.capPx, widthPx: line.widthPx }, frame).width)} × ${Math.round(line.capPx + 2 * CARD_CLAIM.redInk.padY)} px) below 2:1 against #FE3232 (max 25 %) → ${v.red ? "red" : "white"}` });
      if (!v.red) {
        colour = kit.colours.white;
        out.redLineWhite = true;
        out.approvalLines.push(CARD_CLAIM.redToWhite);
      }
    }
    const set = await setRuns([{ text: line.text, color: colour }], line.capPx, kit.tracking.claim, face);
    const c = await cutToSlot(set);
    out.lines.push({ text: line.text, color: colour === kit.colours.kitRed ? "red" : "white", capPx: line.capPx, widthPx: set.width, maxPx: Math.round(maxPx), fits: set.width <= maxPx + 0.5, cut: c.cut });
    const at = await place(c.s, line.text, c.left, line.capTop);
    claimPlaces.push({ ...at, top: Math.round(line.capTop), height: Math.round(line.capPx) });
  }
  const fit = out.lines.every((l) => l.fits);
  const a = planned.plan.attempts[planned.idx!]!;
  // The figure is the planned width from the face's own advances, the meter's number (the drawn ink can differ by a few px).
  const widest = Math.round(Math.max(...a.widths));
  const tall = !a.fitsHeight ? ` · block ${Math.round(layout.blockBottom - layout.blockTop)} of ${Math.round(slot.bottom - slot.top)} px tall` : "";
  out.rules.push({ rule: "fit", pass: fit && a.fitsHeight && (input.attempt != null || planned.plan.canApprove), detail: `${input.attempt != null || planned.plan.canApprove ? `${describeAttempt(planned.plan, planned.idx!, kit)} · ${widest} of ${Math.round(maxPx)} px` : planned.plan.meter}${fit ? "" : " · over the slot (cut)"}${tall}` });

  // Corners: lineup top-right, details bottom-left (coral ">"), logo bottom-right.
  const right = frame.width * (1 - kit.lineup.rightInset);
  for (const l of planned.lineup) {
    const s = await setRuns([{ text: l.text, color: kit.colours.white }], l.capPx, kit.tracking.lineup, face);
    l.left = right - s.width;
    l.widthPx = s.width;
    await place(s, l.text, l.left, l.capTop);
  }
  for (const l of planned.details) {
    const s = await setRuns(l.runs.map((r) => ({ text: r.text, color: r.coral ? kit.colours.coral : kit.colours.white })), l.capPx, kit.tracking.details, face);
    l.widthPx = s.width;
    await place(s, l.text, l.left, l.capTop);
  }
  if (planned.lineup.length) {
    out.contrast.lineup = lowContrastShare(raw.data, raw.info.width, raw.info.channels, pad(blockRect(planned.lineup), 12));
    out.rules.push({ rule: "lineupContrast", pass: out.contrast.lineup <= 0.1, detail: `${(out.contrast.lineup * 100).toFixed(1)} % of the lineup block below 3:1 (max 10 %)` });
  }
  if (planned.details.length) {
    out.contrast.details = lowContrastShare(raw.data, raw.info.width, raw.info.channels, pad(blockRect(planned.details), 12));
    out.rules.push({ rule: "detailsContrast", pass: out.contrast.details <= 0.1, detail: `${(out.contrast.details * 100).toFixed(1)} % of the details block below 3:1 (max 10 %)` });
  }
  if (input.logo) {
    const at = planLogo(input.logo, kit, frame);
    const png = await sharp(input.logo.png).resize(Math.round(at.width), Math.round(at.height), { fit: "fill" }).png().toBuffer();
    pieces.push({ png, width: Math.round(at.width), height: Math.round(at.height), capPx: 0, label: "lockup" });
    places.push({ label: "lockup", left: Math.round(at.left), top: Math.round(at.top), width: Math.round(at.width), height: Math.round(at.height), scale: 1, short: false, stepped: false, belowFloor: false });
  }

  // O6 once on the whole group; the watermark over everything.
  const overlay = await textOverlay(pieces, places, frame, { k: 1, dx: 0, dy: 0 }, KIT_SHADOW);
  // The draft stamp in a free corner of the 4:5 rectangle, off the claim, the corners and the lockup.
  const crop45Rect: Rect = { left: 0, top: RECT_45.top, width: frame.width, height: RECT_45.bottom - RECT_45.top };
  const wm = input.watermark ? await watermarkLayer(input.watermark, frame, face.path, face.family ?? "Bootzy Condensed TM", { avoid: places, within: crop45Rect }) : null;
  out.master = await sharp(shown).composite([{ input: overlay, left: 0, top: 0 }, ...(wm ? [{ input: wm, left: 0, top: 0 }] : [])]).png().toBuffer();
  out.crop45 = await sharp(out.master).extract({ left: 0, top: RECT_45.top, width: frame.width, height: RECT_45.bottom - RECT_45.top }).png().toBuffer();

  // 1:1 (O1): the 4:5 arrangement at 0.8×, the ground re-covered at full size.
  const side = 1080;
  const k = 0.8;
  const dx = (side - frame.width * k) / 2;
  const dy = -RECT_45.top * k;

  // H27: every claim line inside the slot in each format, with the transform each format draws with.
  const inside = (t: (v: { x: number; y: number }) => { x: number; y: number }, size: Size) => {
    const sl = { a: t({ x: slot.left, y: slot.top }), b: t({ x: slot.right, y: slot.bottom }) };
    return claimPlaces.every((p) => {
      const a = t({ x: p.left, y: p.top });
      const b = t({ x: p.left + p.width, y: p.top + p.height });
      return a.x >= sl.a.x - 1 && b.x <= sl.b.x + 1 && a.y >= sl.a.y - 1 && b.y <= sl.b.y + 1 && a.x >= 0 && b.x <= size.width && a.y >= 0 && b.y <= size.height;
    });
  };
  out.inSlot = {
    master: inside((v) => v, frame),
    crop45: inside((v) => ({ x: v.x, y: v.y - RECT_45.top }), { width: frame.width, height: RECT_45.bottom - RECT_45.top }),
    square: inside((v) => ({ x: v.x * k + dx, y: v.y * k + dy }), { width: side, height: side }),
  };
  out.rules.push({ rule: "inSlot", pass: out.inSlot.master && out.inSlot.crop45 && out.inSlot.square, detail: `claim lines inside the slot · 9:16 ${out.inSlot.master ? "✓" : "✗"} · 4:5 ${out.inSlot.crop45 ? "✓" : "✗"} · 1:1 ${out.inSlot.square ? "✓" : "✗"}` });
  const groundSquare = await sharp(groundMaster).extract({ left: 0, top: Math.round(frame.height / 2 - side / 2), width: side, height: side }).png().toBuffer();
  const panelSquare = input.panel && panelMaster ? await sharp(panelMaster).resize(Math.round(input.panel.width * k), Math.round(input.panel.height * k), { fit: "fill" }).png().toBuffer() : null;
  const squareBands = bandLayer ? await sharp(bandLayer).extract({ left: 0, top: RECT_45.top, width: frame.width, height: RECT_45.bottom - RECT_45.top }).resize(side, side, { fit: "fill" }).png().toBuffer() : null;
  const squareOverlay = await textOverlay(pieces, places, { width: side, height: side }, { k, dx, dy }, KIT_SHADOW);
  const squareAvoid = places.map((p) => ({ left: p.left * k + dx, top: p.top * k + dy, width: p.width * k, height: p.height * k }));
  const wmSquare = input.watermark ? await watermarkLayer(input.watermark, { width: side, height: side }, face.path, face.family ?? "Bootzy Condensed TM", { avoid: squareAvoid }) : null;
  out.square = await sharp(groundSquare)
    .composite([
      ...(panelSquare ? [{ input: panelSquare, left: Math.round(input.panel!.left * k + dx), top: Math.round(input.panel!.top * k + dy) }] : []),
      ...(squareBands ? [{ input: squareBands, left: 0, top: 0 }] : []),
      { input: squareOverlay, left: 0, top: 0 },
      ...(wmSquare ? [{ input: wmSquare, left: 0, top: 0 }] : []),
    ])
    .png()
    .toBuffer();

  if (bandRaw && bandLayer) {
    const c45 = await sharp(bandLayer).extract({ left: 0, top: RECT_45.top, width: frame.width, height: RECT_45.bottom - RECT_45.top }).raw().toBuffer({ resolveWithObject: true });
    const sq = await sharp(squareBands!).raw().toBuffer({ resolveWithObject: true });
    out.bandStops = {
      master: sampleStops(bandRaw, frame, 4, O25_STOPS.master),
      crop45: sampleStops(c45.data, { width: c45.info.width, height: c45.info.height }, c45.info.channels, O25_STOPS.carried),
      square: sampleStops(sq.data, { width: sq.info.width, height: sq.info.height }, sq.info.channels, O25_STOPS.carried),
    };
    const all = [...out.bandStops.master, ...out.bandStops.crop45, ...out.bandStops.square];
    const off = all.filter((x) => !x.ok);
    out.rules.push({ rule: "bandStops", pass: !off.length, detail: off.length ? `${off.length} stop(s) off by more than ±${STOP_TOLERANCE} (3 × 3 average): ${off.map((x) => `${x.at} → ${x.got} (O25 ${x.want})`).join(", ")}` : `all ${all.length} stops within ±${STOP_TOLERANCE} on 3 × 3 averages, three formats` });
  }
  out.held = planned.plan.canApprove || input.attempt != null ? null : planned.plan.held;
  return out;
}

export type PanelInk = { box: Rect; bbox: Rect };

/** H8 / O32: the kit audit's paper measurement for a panel placed at (left, top). */
export async function measurePaperBox(png: Buffer, left: number, top: number): Promise<PanelInk> {
  return panelInkBox(png, left, top);
}

/**
 * The panel at its placed size, frame px. `bbox` is its ink box as O11 and O26
 * write it: every pixel with alpha > 8. `box` is the paper: each edge is the
 * median, over the rows (left, right) or columns (top, bottom) that have ink,
 * of where the ink starts and ends, so tape strips that stick out on a few
 * rows don't count.
 */
async function panelInkBox(png: Buffer, left: number, top: number): Promise<PanelInk> {
  const sharp = await sharpFn();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const on = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3]! > 8;
  const ls: number[] = [];
  const rs: number[] = [];
  const ts: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < info.height; y += 1) {
    let a = -1;
    let b = -1;
    for (let x = 0; x < info.width; x += 1) if (on(x, y)) { if (a < 0) a = x; b = x; }
    if (a >= 0) { ls.push(a); rs.push(b); }
  }
  for (let x = 0; x < info.width; x += 1) {
    let a = -1;
    let b = -1;
    for (let y = 0; y < info.height; y += 1) if (on(x, y)) { if (a < 0) a = y; b = y; }
    if (a >= 0) { ts.push(a); bs.push(b); }
  }
  if (!ls.length) throw new Error("the panel has no ink");
  const med = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)]!;
  const L = Math.round(left);
  const T = Math.round(top);
  const box = { left: L + med(ls), top: T + med(ts), width: med(rs) - med(ls) + 1, height: med(bs) - med(ts) + 1 };
  const bbox = { left: L + Math.min(...ls), top: T + Math.min(...ts), width: Math.max(...rs) - Math.min(...ls) + 1, height: Math.max(...bs) - Math.min(...ts) + 1 };
  return { box, bbox };
}

/** "step 1 of 1 · 2 lines · dropped TICKETS" for any ladder state (fitting or not). */
export function describeAttempt(plan: T2Plan, i: number, kit: T2Kit = PUZZLE_FLOATING_T2): string {
  const a = plan.attempts[i]!;
  const n = a.lines.length;
  return `step ${a.step} of ${kit.claim.steps.length - 1} · ${n} line${n === 1 ? "" : "s"}${a.split ? " (broken)" : ""}${a.dropped.length ? ` · dropped ${a.dropped.join(", ")}` : ""}`;
}
