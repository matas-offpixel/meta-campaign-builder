/**
 * T2 standalone message, rendered locally (overlay-templates issue 1 O1, O4,
 * O6, O8, O12; issue 3 O19 amended, O23 case, O24 fonts, O25 bands). A sharp
 * still, not a Remotion composition: kit fonts may not render on Lambda until
 * Matas confirms each licence (O24; kit-font.ts SERVER_RENDER_ALLOWLIST is
 * empty), so this path only ever reads the face in place from FONTS_DIR.
 *
 * Layers, bottom to top: the ground (the kit's paint), the arrangement's panel
 * (optional), O25's bands, the type and the lockup under one O6 shadow, and the
 * draft watermark. Formats: the 9:16 master, the 4:5 as a pure crop of it
 * (y 285–1635), and the 1:1 as the 4:5 arrangement at 0.8× with the ground
 * re-covered at the sides (O1).
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
import { inCase, layoutClaim, planDetails, planLineup, planLogo, planT2Claim, type CornerLine, type MeasureLine, type T2Layout, type T2Plan } from "./t2-message.ts";

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

export type StopSample = { at: number; want: number; got: number };

function sampleStops(alpha: Uint8Array | Buffer, size: Size, channels: number, stops: readonly (readonly [number, number])[]): StopSample[] {
  const x = Math.round(size.width / 2);
  return stops.map(([at, want]) => {
    const y = Math.min(size.height - 1, Math.max(0, Math.floor(at * size.height)));
    return { at, want, got: Math.round((alpha[(y * size.width + x) * channels + 3]! / 255) * 1000) / 10 };
  });
}

// ─── Compose ────────────────────────────────────────────────────────────────

export type T2Input = {
  /** The kit's ground (paint), any size; covered to each format. */
  ground: Buffer;
  /** The arrangement's panel at master coordinates, or null for the bare ground. */
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
  kit?: T2Kit;
};

export type T2LineReport = { text: string; color: "red" | "white"; capPx: number; widthPx: number; maxPx: number; fits: boolean };

export type T2Result = {
  held: string | null;
  plan: T2Plan | null;
  /** The ladder state drawn. */
  drawn: number | null;
  layout: T2Layout | null;
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
  const out: T2Result = { held: null, plan: null, drawn: null, layout: null, lines: [], contrast: { claimBox: null, redLine: null, lineup: null, details: null }, redLineWhite: false, approvalLines: [], rules: [], bandStops: null, master: null, crop45: null, square: null, watermark: input.watermark };

  // O24: the kit's face or nothing.
  let face: FontEntry;
  try {
    face = requireFont(kit.face, input.fonts);
  } catch (e) {
    return { ...out, held: (e as Error).message.replace(/^Claim held — (.+) not installed$/, "Held — $1 not installed") };
  }

  // Plan with the face's own advances.
  const planned = await withMeasure(face, (m) => {
    const plan = planT2Claim({ approved: input.claim, qualifier: input.qualifier ?? null }, m, kit, frame, { exhaust: input.attempt != null });
    const idx = input.attempt ?? plan.chosen;
    const a = idx != null ? plan.attempts[idx] : plan.attempts[plan.attempts.length - 1];
    const layout = a ? layoutClaim(a.lines, a.lines.length === 2 && plan.kind === "roll-call" ? "roll-call" : "plain", a.step, m, input.qualifier ? inCase(input.qualifier, kit) : null, kit, frame) : null;
    return { plan, idx: idx ?? (plan.attempts.length ? plan.attempts.length - 1 : null), layout, lineup: planLineup(input.lineup, m, {}, kit, frame), details: planDetails(input.details, m, kit, frame) };
  });
  out.plan = planned.plan;
  out.drawn = planned.idx;
  out.layout = planned.layout;
  if (!planned.layout) return { ...out, held: planned.plan.held ?? "no claim to draw" };
  const layout = planned.layout;

  // Ground and arrangement, then the bands (O25), before any type.
  const groundMaster = await sharp(input.ground, { limitInputPixels: false }).resize(frame.width, frame.height, { fit: "cover" }).removeAlpha().png().toBuffer();
  const panelMaster = input.panel ? await sharp(input.panel.png, { limitInputPixels: false }).resize(Math.round(input.panel.width), Math.round(input.panel.height), { fit: "fill" }).png().toBuffer() : null;
  const under = panelMaster ? await sharp(groundMaster).composite([{ input: panelMaster, left: Math.round(input.panel!.left), top: Math.round(input.panel!.top) }]).png().toBuffer() : groundMaster;
  const bandRaw = input.bands ? Buffer.from(renderGradientShadow(input.bands, frame.width, frame.height)) : null;
  const bandLayer = bandRaw ? await sharp(bandRaw, { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toBuffer() : null;
  const shown = bandLayer ? await sharp(under).composite([{ input: bandLayer, left: 0, top: 0 }]).png().toBuffer() : under;
  const raw = await sharp(shown).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  // The claim: the box test, the red line's ink-box test, then each line set at its size.
  const maxPx = kit.claim.maxWidth * frame.width;
  const box: Rect = { left: CARD_CLAIM.box.left * frame.width, top: layout.blockTop, width: (CARD_CLAIM.box.right - CARD_CLAIM.box.left) * frame.width, height: layout.blockBottom - layout.blockTop };
  out.contrast.claimBox = lowContrastShare(raw.data, raw.info.width, raw.info.channels, box);
  out.rules.push({ rule: "claimContrast", pass: out.contrast.claimBox <= CARD_CLAIM.claimBoxMax, detail: `${(out.contrast.claimBox * 100).toFixed(1)} % of the claim box below 3:1, bands ${input.bands ? "on" : "off"} (max ${CARD_CLAIM.claimBoxMax * 100} %)` });
  const pieces: Piece[] = [];
  const places: Placement[] = [];
  const place = async (s0: SetLine, label: string, left0: number, capTop: number) => {
    // A forced state wider than the frame (a draft of an O8 step that doesn't fit) is cut at the frame's edges, as it would be.
    let s = s0;
    let left = left0;
    if (s.width > frame.width) {
      const cut = Math.floor((s.width - frame.width) / 2);
      s = { ...s, png: await sharp(s.png).extract({ left: cut, top: 0, width: frame.width, height: s.height }).png().toBuffer(), width: frame.width };
      left = 0;
    }
    pieces.push({ png: s.png, width: s.width, height: s.height, capPx: 0, label });
    places.push({ label, left: Math.round(left), top: Math.round(capTop - s.capTopRow), width: s.width, height: s.height, scale: 1, short: false, stepped: false, belowFloor: false });
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
    const s = await setRuns([{ text: line.text, color: colour }], line.capPx, kit.tracking.claim, face);
    out.lines.push({ text: line.text, color: colour === kit.colours.kitRed ? "red" : "white", capPx: line.capPx, widthPx: s.width, maxPx, fits: s.width <= maxPx + 0.5 });
    await place(s, line.text, (frame.width - s.width) / 2, line.capTop);
  }
  const fit = out.lines.every((l) => l.fits);
  out.rules.push({ rule: "fit", pass: fit && (input.attempt != null || planned.plan.canApprove), detail: input.attempt != null ? `${describeAttempt(planned.plan, planned.idx!, kit)}${fit ? "" : " · over the slot"}` : planned.plan.meter });

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
  const wm = input.watermark ? await watermarkLayer(input.watermark, frame, face.path, face.family ?? "Bootzy Condensed TM") : null;
  out.master = await sharp(shown).composite([{ input: overlay, left: 0, top: 0 }, ...(wm ? [{ input: wm, left: 0, top: 0 }] : [])]).png().toBuffer();
  out.crop45 = await sharp(out.master).extract({ left: 0, top: RECT_45.top, width: frame.width, height: RECT_45.bottom - RECT_45.top }).png().toBuffer();

  // 1:1 (O1): the 4:5 arrangement at 0.8×, the ground re-covered at full size.
  const side = 1080;
  const k = 0.8;
  const dx = (side - frame.width * k) / 2;
  const dy = -RECT_45.top * k;
  const groundSquare = await sharp(groundMaster).extract({ left: 0, top: Math.round(frame.height / 2 - side / 2), width: side, height: side }).png().toBuffer();
  const panelSquare = input.panel && panelMaster ? await sharp(panelMaster).resize(Math.round(input.panel.width * k), Math.round(input.panel.height * k), { fit: "fill" }).png().toBuffer() : null;
  const squareBands = bandLayer ? await sharp(bandLayer).extract({ left: 0, top: RECT_45.top, width: frame.width, height: RECT_45.bottom - RECT_45.top }).resize(side, side, { fit: "fill" }).png().toBuffer() : null;
  const squareOverlay = await textOverlay(pieces, places, { width: side, height: side }, { k, dx, dy }, KIT_SHADOW);
  const wmSquare = input.watermark ? await watermarkLayer(input.watermark, { width: side, height: side }, face.path, face.family ?? "Bootzy Condensed TM") : null;
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
  }
  out.held = planned.plan.canApprove || input.attempt != null ? null : planned.plan.held;
  return out;
}

/** "step 1 of 1 · 2 lines · dropped TICKETS" for any ladder state (fitting or not). */
export function describeAttempt(plan: T2Plan, i: number, kit: T2Kit = PUZZLE_FLOATING_T2): string {
  const a = plan.attempts[i]!;
  const n = a.lines.length;
  return `step ${a.step} of ${kit.claim.steps.length - 1} · ${n} line${n === 1 ? "" : "s"}${a.split ? " (broken)" : ""}${a.dropped.length ? ` · dropped ${a.dropped.join(", ")}` : ""}`;
}
