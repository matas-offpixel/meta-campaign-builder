/**
 * The kit's faces on the font path (O11 (b), H8), read where Matas installs
 * them: the fonts that came with a client's open files, in ~/Library/Fonts
 * (FONTS_DIR overrides it for local scripts).
 *
 * The folder is indexed by each font's own name table (PostScript name,
 * family, style), read with the small sfnt parser below, so a PSD's font name
 * (BootzyCondensedTM-Regular) resolves to the file that really is that face.
 *
 *   - Not in the index → the card is held: "Claim held — {font} not installed".
 *   - A trial font (the file name or any name record says "Trial") → held:
 *     "{font} is a trial font — not for client work".
 *   - Never another face in its place.
 *   - Font files are read where they are installed and never copied,
 *     committed or uploaded (repo, Storage, Drive, Lambda).
 *   - A face the client provided renders everywhere, locally, on Lambda and
 *     on CI (overlay templates issue 7, O49); there is no server-render hold.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function fontsDir(env: Record<string, string | undefined> = process.env): string {
  return env.FONTS_DIR?.trim() || join(homedir(), "Library", "Fonts");
}

export type FontFace = {
  postscriptName: string | null;
  family: string | null;
  style: string | null;
  fullName: string | null;
  unitsPerEm: number | null;
  capHeight: number | null;
};

export type FontEntry = FontFace & { file: string; path: string; trial: boolean };

const NAME_IDS = { family: 1, style: 2, fullName: 4, postscriptName: 6, typoFamily: 16, typoStyle: 17 } as const;

function readFace(bytes: Uint8Array, base: number): FontFace & { names: string[] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const empty = { postscriptName: null, family: null, style: null, fullName: null, unitsPerEm: null, capHeight: null, names: [] };
  if (base + 12 > bytes.length) return empty;
  const tag = dv.getUint32(base);
  // 0x00010000 TrueType, 'OTTO' CFF, 'true' old Apple TrueType.
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return empty;
  const numTables = dv.getUint16(base + 4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i += 1) {
    const rec = base + 12 + i * 16;
    if (rec + 16 > bytes.length) break;
    tables.set(String.fromCharCode(bytes[rec]!, bytes[rec + 1]!, bytes[rec + 2]!, bytes[rec + 3]!), dv.getUint32(rec + 8));
  }
  const head = tables.get("head");
  const unitsPerEm = head != null && head + 20 <= bytes.length ? dv.getUint16(head + 18) : null;
  const os2 = tables.get("OS/2");
  const capHeight = os2 != null && os2 + 90 <= bytes.length && dv.getUint16(os2) >= 2 ? dv.getInt16(os2 + 88) : null;
  const found = new Map<number, string>();
  const all: string[] = [];
  const nameT = tables.get("name");
  if (nameT != null && nameT + 6 <= bytes.length) {
    const count = dv.getUint16(nameT + 2);
    const strings = nameT + dv.getUint16(nameT + 4);
    for (let i = 0; i < count; i += 1) {
      const r = nameT + 6 + i * 12;
      if (r + 12 > bytes.length) break;
      const platform = dv.getUint16(r);
      const nameId = dv.getUint16(r + 6);
      const length = dv.getUint16(r + 8);
      const offset = strings + dv.getUint16(r + 10);
      if (offset + length > bytes.length) continue;
      let s = "";
      if (platform === 3 || platform === 0) for (let j = 0; j + 1 < length; j += 2) s += String.fromCharCode(dv.getUint16(offset + j));
      else if (platform === 1) s = String.fromCharCode(...bytes.subarray(offset, offset + length));
      else continue;
      all.push(s);
      // Prefer the Windows / Unicode record; keep the first one met.
      if (!found.has(nameId) || platform === 3) found.set(nameId, s);
    }
  }
  return {
    postscriptName: found.get(NAME_IDS.postscriptName) ?? null,
    family: found.get(NAME_IDS.typoFamily) ?? found.get(NAME_IDS.family) ?? null,
    style: found.get(NAME_IDS.typoStyle) ?? found.get(NAME_IDS.style) ?? null,
    fullName: found.get(NAME_IDS.fullName) ?? null,
    unitsPerEm,
    capHeight,
    names: all,
  };
}

/** Every face in a font file (one, or each member of a .ttc collection), with whether any record says "Trial". */
export function readFontFaces(bytes: Uint8Array): (FontFace & { trialName: boolean })[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bases: number[] = [];
  if (bytes.length >= 12 && dv.getUint32(0) === 0x74746366) {
    // 'ttcf'
    const n = dv.getUint32(8);
    for (let i = 0; i < n && 12 + i * 4 + 4 <= bytes.length; i += 1) bases.push(dv.getUint32(12 + i * 4));
  } else bases.push(0);
  return bases
    .map((b) => readFace(bytes, b))
    .filter((f) => f.postscriptName != null || f.family != null)
    .map(({ names, ...face }) => ({ ...face, trialName: names.some((s) => /trial/i.test(s)) }));
}

const FONT_FILE = /\.(otf|ttf|ttc|otc)$/i;

/** The folder's fonts by their own name tables. Unreadable files are skipped. Reads in place; copies nothing. */
export function indexFonts(dir: string = fontsDir(), io: { list?: (d: string) => string[]; read?: (p: string) => Uint8Array; isFile?: (p: string) => boolean } = {}): FontEntry[] {
  const list = io.list ?? ((d: string) => (existsSync(d) ? readdirSync(d) : []));
  const read = io.read ?? ((p: string) => new Uint8Array(readFileSync(p)));
  const isFile = io.isFile ?? ((p: string) => statSync(p).isFile());
  const out: FontEntry[] = [];
  for (const file of list(dir)) {
    if (!FONT_FILE.test(file)) continue;
    const path = join(dir, file);
    let faces: ReturnType<typeof readFontFaces>;
    try {
      if (!isFile(path)) continue;
      faces = readFontFaces(read(path));
    } catch {
      continue;
    }
    for (const f of faces) {
      const { trialName, ...face } = f;
      out.push({ ...face, file, path, trial: trialName || /trial/i.test(file) });
    }
  }
  return out;
}

export type FontResolution =
  | { status: "found"; entry: FontEntry }
  | { status: "missing"; message: string }
  | { status: "trial"; entry: FontEntry; message: string };

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Resolve a PSD's font name. Exact PostScript name first; then the same name
 * ignoring case and punctuation, against PostScript names and family + style
 * ("BootzyCondensedTM-Regular" = "Bootzy Condensed TM" + "Regular"). A trial
 * face that matches is refused, even when a licensed one is missing.
 */
export function resolveFont(name: string, index: readonly FontEntry[]): FontResolution {
  const want = squash(name);
  const matches = index.filter((e) => e.postscriptName === name);
  const loose = matches.length
    ? matches
    : index.filter((e) => (e.postscriptName && squash(e.postscriptName) === want) || (e.family && squash(`${e.family}${e.style ?? ""}`) === want) || (e.family && e.style && squash(`${e.family}-${e.style}`) === want));
  const licensed = loose.find((e) => !e.trial);
  if (licensed) return { status: "found", entry: licensed };
  // A trial build names itself "…Trial…" (DrukTextTrial-Heavy for DrukText-Heavy): match it with that word taken out, to say why it is held.
  const untrial = (s: string) => squash(s).replace(/trial/g, "");
  const trial = loose.find((e) => e.trial) ?? index.find((e) => e.trial && ((e.postscriptName && untrial(e.postscriptName) === untrial(name)) || (e.family && untrial(`${e.family}${e.style ?? ""}`) === untrial(name))));
  if (trial) return { status: "trial", entry: trial, message: `${name} is a trial font — not for client work` };
  return { status: "missing", message: `Claim held — ${name} not installed` };
}

export class FontHeldError extends Error {
  readonly resolution: Exclude<FontResolution, { status: "found" }>;
  constructor(message: string, resolution: Exclude<FontResolution, { status: "found" }>) {
    super(message);
    this.name = "FontHeldError";
    this.resolution = resolution;
  }
}

/** The face for a render, or a hold (missing or trial). Never another face in its place. */
export function requireFont(name: string, index: readonly FontEntry[]): FontEntry {
  const r = resolveFont(name, index);
  if (r.status !== "found") throw new FontHeldError(r.message, r);
  return r.entry;
}
