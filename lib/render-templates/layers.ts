/**
 * lib/render-templates/layers.ts — the montage's text, set in the client's
 * kit face, one transparent 1080 × 1920 PNG per text block (the master).
 *
 * Geometry is the spec's T1 slot table for Puzzle (measured at 1080 × 1920,
 * centred on x = 540, every slot inside the 4:5 rectangle y 285–1635):
 *   - hook and each lineup name in the name slot (cap 134, top 469);
 *   - date and venue in the details slot (cap 57, top 632, the venue one
 *     pitch below);
 *   - the close: the kit's lockup in the mark slot (top 353, a quarter of W)
 *     and the claim's lines in the CTA slots (cap 76, tops 1028 / 1128 /
 *     1228); with two or more lines the first is kit red, the rest white.
 * Every line stays within 0.80 W (864 px): its cap steps down 3 % at a time
 * until it fits, never condensed. The edge is the kit's drop shadow, never a
 * stroke: 8 px down, about 10 px blur, 45 % at 1080 wide. The 4:5 is a pure
 * centre crop of this master and the 1:1 its 4:5 arrangement at 0.8, both
 * done in the composition, so one PNG serves every ratio.
 *
 * Server only (sharp, the kit face).
 */

import { textOverlay, type Piece, type Placement } from "../creative-lab/artist-card.ts";
import { renderCardLine } from "../creative-lab/claim-slot.ts";
import type { FontEntry } from "../creative-lab/kit-font.ts";
import type { TextBlock } from "./montage-plan.ts";

export const KIT_RED_PUZZLE = "#FB312F";
export const WHITE = "#FFFFFF";
export const MASTER_SIZE = { width: 1080, height: 1920 } as const;
export const PUZZLE_SHADOW = { dy: 8 / 1080, blur: 10 / 1080, opacity: 0.45 } as const;

export const SLOTS = {
  name: { capTop: 469, cap: 134 },
  details: { capTop: 632, cap: 57, pitch: 80 },
  mark: { top: 353, width: 0.25 },
  cta: { capTop: 1028, cap: 76, pitch: 100 },
  maxWidth: 864,
  stepDown: 0.97,
} as const;

type SetLine = (text: string, color: string, capPx: number) => Promise<{ png: Buffer; width: number; height: number; capTopRow: number }>;

/** Set a line, stepping the cap down 3 % at a time until it fits 864 px. */
export async function fitLine(set: SetLine, text: string, color: string, cap: number): Promise<{ piece: Piece; capTopRow: number }> {
  let capPx = cap;
  for (let i = 0; i < 40; i += 1) {
    const line = await set(text, color, capPx);
    if (line.width <= SLOTS.maxWidth || i === 39) return { piece: { png: line.png, width: line.width, height: line.height, capPx, label: text }, capTopRow: line.capTopRow };
    capPx *= SLOTS.stepDown;
  }
  throw new Error("unreachable");
}

function placeAt(piece: Piece, capTopRow: number, capTop: number): Placement {
  return { left: (MASTER_SIZE.width - piece.width) / 2, top: capTop - capTopRow, width: piece.width, height: piece.height, label: piece.label, scale: 1, short: false, stepped: false, belowFloor: false };
}

/** One text block as its own master-size PNG. `lockup` is the kit's logo ink, for the close. */
export async function blockLayer(block: TextBlock, face: FontEntry, lockup: Piece | null, setLine?: SetLine): Promise<Buffer> {
  const set: SetLine = setLine ?? ((t, c, cap) => renderCardLine(t, c, cap, face));
  const pieces: Piece[] = [];
  const places: Placement[] = [];
  const push = async (text: string, color: string, cap: number, capTop: number) => {
    const fitted = await fitLine(set, text, color, cap);
    pieces.push(fitted.piece);
    places.push(placeAt(fitted.piece, fitted.capTopRow, capTop));
  };
  if (block.kind === "hook" || block.kind === "name") {
    await push(block.lines[0] ?? "", WHITE, SLOTS.name.cap, SLOTS.name.capTop);
  } else if (block.kind === "details") {
    for (let i = 0; i < block.lines.length; i += 1) if (block.lines[i]) await push(block.lines[i]!, WHITE, SLOTS.details.cap, SLOTS.details.capTop + i * SLOTS.details.pitch);
  } else {
    if (lockup) {
      const width = SLOTS.mark.width * MASTER_SIZE.width;
      const height = (lockup.height * width) / lockup.width;
      pieces.push(lockup);
      places.push({ left: (MASTER_SIZE.width - width) / 2, top: SLOTS.mark.top, width, height, label: "lockup", scale: width / lockup.width, short: false, stepped: false, belowFloor: false });
    }
    const lines = block.lines.slice(0, 3);
    for (let i = 0; i < lines.length; i += 1) await push(lines[i]!, lines.length > 1 && i === 0 ? KIT_RED_PUZZLE : WHITE, SLOTS.cta.cap, SLOTS.cta.capTop + i * SLOTS.cta.pitch);
  }
  return textOverlay(pieces, places, MASTER_SIZE, { k: 1, dx: 0, dy: 0 }, PUZZLE_SHADOW);
}
