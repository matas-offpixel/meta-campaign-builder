/**
 * PSD kit: read a delivered artwork's open file with ag-psd (pure JS, no
 * Photoshop) and turn it into a layer manifest, a flattened preview and one
 * PNG per visible layer, from the pixels the PSD itself carries.
 *
 * A text layer's pixels are Photoshop's own rendering of the text (the layer
 * channel data saved with the file), without its layer effects. Effects are
 * listed in the manifest so whoever places the piece can add them once.
 *
 * A smart object's own pixels are its placed rendering. When the smart object
 * embeds its source document (a PSD or PSB in linkedFiles), that document is
 * read too and its layers are listed under the smart object, so the pieces
 * inside it (a logo, a script title, an info block) can be exported one by one.
 *
 * Stack order in the manifest is Photoshop's: top first. No database, no
 * Storage, no Drive here; scripts/psd-kit.mts does the I/O.
 */

import type { Layer, LayerEffectShadow, LayerEffectsInfo, PixelData, Psd, ReadOptions, TextStyle } from "ag-psd";

// ─── Types ──────────────────────────────────────────────────────────────────

export type LayerKind = "text" | "pixel" | "group" | "smart_object" | "adjustment" | "fill" | "empty";

export type Bounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export type ShadowSummary = {
  kind: "drop_shadow" | "inner_shadow";
  enabled: boolean;
  opacity: number | null;
  angle: number | null;
  distance_px: number | null;
  size_px: number | null;
  color: string | null;
  blend_mode: string | null;
};

export type EffectsSummary = {
  disabled: boolean;
  shadows: ShadowSummary[];
  stroke: { size_px: number | null; color: string | null; position: string | null; opacity: number | null }[];
  /** Any other effect present, by name (outerGlow, bevel, gradientOverlay, …). */
  other: string[];
};

export type TextRun = { text: string; font: string | null; size_pt: number | null; size_px: number | null; tracking: number | null; color: string | null };

export type TextSummary = {
  content: string;
  lines: string[];
  fonts: string[];
  /** The text's own point size, before the layer transform. */
  size_pt: number | null;
  /** size_pt × the transform's vertical scale: the size in canvas pixels. */
  size_px: number | null;
  tracking: number | null;
  leading: number | null;
  runs: TextRun[];
};

export type SmartObjectSummary = {
  linked_file_id: string | null;
  linked_file_name: string | null;
  linked_file_type: string | null;
  embedded: boolean;
  /** The placed document's own size, when known. */
  width: number | null;
  height: number | null;
  /** The embedded document's layers, top first, when it could be read. */
  layers: KitLayer[];
  read_error: string | null;
};

export type KitLayer = {
  /** Stable within the file: index path from the top, e.g. "2" or "3/0", "3>1" inside a smart object. */
  ref: string;
  name: string;
  /** Group names from the top of the stack down to this layer's parent. */
  path: string[];
  kind: LayerKind;
  bounds: Bounds | null;
  /** The layer's own eye. */
  visible: boolean;
  /** Visible and every parent group visible. */
  shown: boolean;
  opacity: number;
  blend_mode: string;
  clipping: boolean;
  effects: EffectsSummary | null;
  text: TextSummary | null;
  smart_object: SmartObjectSummary | null;
  /** The PSD carries pixels for this layer (non-empty alpha). */
  has_pixels: boolean;
  /** Ink box of those pixels in canvas coordinates (tighter than bounds when the layer has transparent margins). */
  ink: Bounds | null;
};

export type KitManifest = {
  psd: string;
  width: number;
  height: number;
  ppi: number | null;
  bits_per_channel: number | null;
  color_mode: string | null;
  has_composite: boolean;
  layers: KitLayer[];
  /** Every font any text layer names, nested ones included. */
  fonts: string[];
};

// ─── Reading ────────────────────────────────────────────────────────────────

export const READ_OPTIONS: ReadOptions = { useImageData: true, skipThumbnail: true };

type AgPsd = {
  readPsd(buffer: ArrayBuffer | Uint8Array, options?: ReadOptions): Psd;
  initializeCanvas(createCanvas: (width: number, height: number) => never, createImageData: (width: number, height: number) => PixelData): void;
};

let agPsd: Promise<AgPsd> | null = null;
/**
 * ag-psd, loaded lazily so the pure helpers stay importable without it. In
 * Node there is no canvas: 8-bit RGBA layer data is still created through its
 * createImageData hook, so that hook returns a plain { width, height, data }.
 * Anything that truly needs a canvas (a JPEG thumbnail) throws; reads skip it.
 */
export async function loadAgPsd(): Promise<AgPsd> {
  agPsd ??= import("ag-psd").then((mod) => {
    const api = ((mod as unknown as { readPsd?: unknown }).readPsd ? mod : (mod as unknown as { default: AgPsd }).default) as AgPsd;
    api.initializeCanvas(
      () => {
        throw new Error("psd-kit: no canvas in Node (thumbnails are skipped)");
      },
      (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    );
    return api;
  });
  return agPsd;
}

export async function readPsdBytes(bytes: Uint8Array): Promise<Psd> {
  const { readPsd } = await loadAgPsd();
  return readPsd(bytes, READ_OPTIONS);
}

// ─── Manifest ───────────────────────────────────────────────────────────────

const COLOR_MODES = ["bitmap", "grayscale", "indexed", "rgb", "cmyk", null, null, "multichannel", "duotone", "lab"];

export function layerKind(layer: Layer): LayerKind {
  if (layer.children) return "group";
  if (layer.text) return "text";
  if (layer.placedLayer) return "smart_object";
  if (layer.adjustment) return "adjustment";
  if (layer.vectorFill) return "fill";
  return hasInk(layer.imageData) ? "pixel" : "empty";
}

export function boundsOf(layer: { left?: number; top?: number; right?: number; bottom?: number }): Bounds | null {
  if (layer.left == null || layer.top == null || layer.right == null || layer.bottom == null) return null;
  const width = layer.right - layer.left;
  const height = layer.bottom - layer.top;
  if (width <= 0 || height <= 0) return null;
  return { left: layer.left, top: layer.top, right: layer.right, bottom: layer.bottom, width, height };
}

function hasInk(pixels: PixelData | undefined): boolean {
  if (!pixels || !pixels.width || !pixels.height) return false;
  const data = pixels.data;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) return true;
  return false;
}

/** The box of pixels with alpha above `threshold`, in the pixel data's own coordinates. */
export function inkBox(pixels: PixelData, threshold = 8): { left: number; top: number; right: number; bottom: number } | null {
  const { width, height, data } = pixels;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3]! > threshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  return { left, top, right: right + 1, bottom: bottom + 1 };
}

export function colorHex(color: unknown): string | null {
  if (!color || typeof color !== "object") return null;
  const c = color as Record<string, number>;
  const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  if ("r" in c && "g" in c && "b" in c) return `#${hex(c.r!)}${hex(c.g!)}${hex(c.b!)}`;
  if ("fr" in c && "fg" in c && "fb" in c) return `#${hex(c.fr! * 255)}${hex(c.fg! * 255)}${hex(c.fb! * 255)}`;
  return null;
}

function unitPx(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "value" in value) {
    const v = (value as { value: unknown }).value;
    return typeof v === "number" ? v : null;
  }
  return null;
}

function shadow(kind: ShadowSummary["kind"], s: LayerEffectShadow): ShadowSummary {
  return {
    kind,
    enabled: s.enabled !== false,
    opacity: typeof s.opacity === "number" ? s.opacity : null,
    angle: typeof s.angle === "number" ? s.angle : null,
    distance_px: unitPx(s.distance),
    size_px: unitPx(s.size),
    color: colorHex(s.color),
    blend_mode: s.blendMode ?? null,
  };
}

export function summarizeEffects(effects: LayerEffectsInfo | undefined): EffectsSummary | null {
  if (!effects) return null;
  const shadows = [
    ...(effects.dropShadow ?? []).map((s) => shadow("drop_shadow", s)),
    ...(effects.innerShadow ?? []).map((s) => shadow("inner_shadow", s)),
  ];
  const stroke = (effects.stroke ?? []).map((s) => ({
    size_px: unitPx(s.size),
    color: colorHex(s.color),
    position: s.position ?? null,
    opacity: typeof s.opacity === "number" ? s.opacity : null,
  }));
  const known = new Set(["disabled", "scale", "dropShadow", "innerShadow", "stroke"]);
  const other = Object.keys(effects).filter((key) => !known.has(key) && (effects as Record<string, unknown>)[key] != null);
  if (!shadows.length && !stroke.length && !other.length) return null;
  return { disabled: effects.disabled === true, shadows, stroke, other };
}

/** The vertical scale of a text transform [xx, xy, yx, yy, tx, ty]. */
export function transformScaleY(transform: number[] | undefined): number {
  if (!transform || transform.length < 4) return 1;
  return Math.hypot(transform[2]!, transform[3]!) || 1;
}

function styleAt(base: TextStyle | undefined, run: TextStyle | undefined): TextStyle {
  return { ...(base ?? {}), ...(run ?? {}) };
}

export function summarizeText(layer: Layer): TextSummary | null {
  const text = layer.text;
  if (!text) return null;
  const content = text.text ?? "";
  const scaleY = transformScaleY(text.transform);
  const runs: TextRun[] = [];
  let at = 0;
  for (const run of text.styleRuns ?? [{ length: content.length, style: text.style ?? {} }]) {
    const style = styleAt(text.style, run.style);
    runs.push({
      text: content.slice(at, at + run.length),
      font: style.font?.name ?? null,
      size_pt: typeof style.fontSize === "number" ? round(style.fontSize, 2) : null,
      size_px: typeof style.fontSize === "number" ? round(style.fontSize * scaleY, 2) : null,
      tracking: typeof style.tracking === "number" ? style.tracking : null,
      color: colorHex(style.fillColor),
    });
    at += run.length;
  }
  const base = styleAt(text.style, text.styleRuns?.[0]?.style);
  const sizePt = typeof base.fontSize === "number" ? base.fontSize : null;
  const fonts = [...new Set(runs.map((r) => r.font).filter((f): f is string => Boolean(f)))];
  return {
    content,
    lines: content.split(/\r\n|\r|\n|\u0003/).map((line) => line.trim()).filter(Boolean),
    fonts,
    size_pt: sizePt == null ? null : round(sizePt, 2),
    size_px: sizePt == null ? null : round(sizePt * scaleY, 2),
    tracking: typeof base.tracking === "number" ? base.tracking : null,
    leading: typeof base.leading === "number" ? base.leading : null,
    runs,
  };
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

type Walked = { layer: Layer; ref: string; path: string[]; parentShown: boolean };

/** Every layer, top of the stack first, with its index path and group path. */
export function walkLayers(children: Layer[] | undefined, prefix = "", path: string[] = [], parentShown = true): Walked[] {
  const out: Walked[] = [];
  const list = children ?? [];
  // ag-psd lists children bottom first; Photoshop shows top first.
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const layer = list[i]!;
    const ref = prefix ? `${prefix}/${list.length - 1 - i}` : String(list.length - 1 - i);
    out.push({ layer, ref, path, parentShown });
    if (layer.children) out.push(...walkLayers(layer.children, ref, [...path, layer.name ?? ""], parentShown && !layer.hidden));
  }
  return out;
}

export type NestedReader = (file: { id: string; name: string; type: string | null; data: Uint8Array }) => Psd | null;

export function buildManifest(psd: Psd, name: string, opts: { readNested?: NestedReader; refPrefix?: string } = {}): KitManifest {
  const layers = manifestLayers(psd, opts.readNested ?? null, opts.refPrefix ?? "");
  const res = psd.imageResources?.resolutionInfo;
  const fonts = new Set<string>();
  const collect = (list: KitLayer[]) => {
    for (const layer of list) {
      for (const font of layer.text?.fonts ?? []) fonts.add(font);
      if (layer.smart_object) collect(layer.smart_object.layers);
    }
  };
  collect(layers);
  return {
    psd: name,
    width: psd.width,
    height: psd.height,
    ppi: res ? res.horizontalResolution : null,
    bits_per_channel: psd.bitsPerChannel ?? null,
    color_mode: psd.colorMode == null ? null : (COLOR_MODES[psd.colorMode] ?? String(psd.colorMode)),
    has_composite: hasInk(psd.imageData),
    layers,
    fonts: [...fonts].sort(),
  };
}

function manifestLayers(psd: Psd, readNested: NestedReader | null, refPrefix: string): KitLayer[] {
  return walkLayers(psd.children).map(({ layer, ref, path, parentShown }) => {
    const kind = layerKind(layer);
    const ink = layer.imageData && layer.left != null && layer.top != null ? inkBox(layer.imageData) : null;
    const placed = layer.placedLayer;
    let smart: SmartObjectSummary | null = null;
    if (placed) {
      const linked = psd.linkedFiles?.find((file) => file.id === placed.id) ?? null;
      smart = {
        linked_file_id: placed.id ?? null,
        linked_file_name: linked?.name ?? null,
        linked_file_type: linked?.type?.trim() || null,
        embedded: Boolean(linked?.data?.length),
        width: placed.width ?? null,
        height: placed.height ?? null,
        layers: [],
        read_error: null,
      };
      if (linked?.data?.length && readNested) {
        try {
          const nested = readNested({ id: linked.id, name: linked.name, type: linked.type ?? null, data: linked.data });
          if (nested) smart.layers = manifestLayers(nested, readNested, `${refPrefix}${ref}>`);
        } catch (error) {
          smart.read_error = error instanceof Error ? error.message : String(error);
        }
      }
    }
    return {
      ref: `${refPrefix}${ref}`,
      name: layer.name ?? "",
      path,
      kind,
      bounds: boundsOf(layer),
      visible: !layer.hidden,
      shown: parentShown && !layer.hidden,
      opacity: round(typeof layer.opacity === "number" ? layer.opacity : 1, 3),
      blend_mode: layer.blendMode ?? "normal",
      clipping: layer.clipping === true,
      effects: summarizeEffects(layer.effects),
      text: summarizeText(layer),
      smart_object: smart,
      has_pixels: hasInk(layer.imageData),
      ink:
        ink && layer.left != null && layer.top != null
          ? { left: layer.left + ink.left, top: layer.top + ink.top, right: layer.left + ink.right, bottom: layer.top + ink.bottom, width: ink.right - ink.left, height: ink.bottom - ink.top }
          : null,
    };
  });
}

/** The ag-psd layer for a manifest ref ("3/0"), top-first indices. Refs inside a smart object (">") are not resolved here. */
export function layerAt(psd: Psd, ref: string): Layer | null {
  let list = psd.children ?? [];
  let found: Layer | null = null;
  for (const part of ref.split("/")) {
    const index = Number(part);
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
    found = list[list.length - 1 - index]!;
    list = found.children ?? [];
  }
  return found;
}

// ─── Pixels ─────────────────────────────────────────────────────────────────

/** 8-bit RGBA bytes for a PixelData (16-bit and float data are scaled down). */
export function rgba8(pixels: PixelData): Uint8Array {
  const { data } = pixels;
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint8Array(data.length);
  if (data instanceof Uint16Array) for (let i = 0; i < data.length; i += 1) out[i] = data[i]! >> 8;
  else for (let i = 0; i < data.length; i += 1) out[i] = Math.max(0, Math.min(255, Math.round(data[i]! * 255)));
  return out;
}

/** A PixelData cropped to a box (in its own coordinates). */
export function cropPixels(pixels: PixelData, box: { left: number; top: number; right: number; bottom: number }): PixelData {
  const src = rgba8(pixels);
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((box.top + y) * pixels.width + box.left) * 4;
    out.set(src.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, data: out };
}

export type InkBand = { top: number; bottom: number; left: number; right: number };

/**
 * Horizontal bands of ink, top to bottom: rows whose alpha passes `threshold`
 * grouped with gaps of at most `gap` empty rows bridged (so an "&" or a
 * descender doesn't split a line). Each band carries its own left / right.
 */
export function inkBands(pixels: PixelData, opts: { threshold?: number; gap?: number } = {}): InkBand[] {
  const threshold = opts.threshold ?? 16;
  const { width, height } = pixels;
  const data = rgba8(pixels);
  const rowInk: boolean[] = new Array(height).fill(false);
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3]! > threshold) {
        rowInk[y] = true;
        break;
      }
    }
  }
  const gap = opts.gap ?? Math.max(2, Math.round(height * 0.004));
  const bands: { top: number; bottom: number }[] = [];
  let start = -1;
  let lastInk = -1;
  for (let y = 0; y < height; y += 1) {
    if (!rowInk[y]) continue;
    if (start < 0) start = y;
    else if (y - lastInk - 1 > gap) {
      bands.push({ top: start, bottom: lastInk + 1 });
      start = y;
    }
    lastInk = y;
  }
  if (start >= 0) bands.push({ top: start, bottom: lastInk + 1 });
  return bands.map((band) => {
    let left = width;
    let right = -1;
    for (let y = band.top; y < band.bottom; y += 1) {
      const row = y * width * 4;
      for (let x = 0; x < width; x += 1) {
        if (data[row + x * 4 + 3]! > threshold) {
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    return { ...band, left, right: right + 1 };
  });
}

export type LinePiece = { line: string; band: InkBand };

/**
 * A multi-line text layer's pixels split into one piece per line of its text.
 * Lines and ink bands are paired in order; when the counts differ the pairing
 * is refused (null) rather than guessed.
 */
export function splitTextLines(pixels: PixelData, lines: readonly string[]): LinePiece[] | null {
  const bands = inkBands(pixels);
  if (bands.length !== lines.length) return null;
  return lines.map((line, i) => ({ line, band: bands[i]! }));
}

// ─── Roles ──────────────────────────────────────────────────────────────────

export type KitRole = "headliner_names" | "info" | "logo" | "title" | "background" | "panel";

export type RoleFacts = { headliners: readonly string[]; venue?: string | null; city?: string | null; date?: string | null };

export type RoleHit = { role: KitRole; ref: string; name: string; why: string };

export function normalizeWords(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9&]+/g, " ")
    .trim();
}

/** What one line of a lineup text layer is: an act's name, the event info, a "PART n" heading, or other. */
export function lineRole(line: string, lineup: readonly string[], facts: Omit<RoleFacts, "headliners">): { role: "name" | "info" | "heading" | "other"; artist: string | null } {
  const words = normalizeWords(line);
  const artist = lineup.find((name) => {
    const n = normalizeWords(name);
    return Boolean(n) && (words === n || words.startsWith(`${n} `) || words.endsWith(` ${n}`));
  });
  if (artist) return { role: "name", artist };
  if (/^PART \d+$/.test(words)) return { role: "heading", artist: null };
  const venueWords = [facts.venue, facts.city].map((v) => normalizeWords(v ?? "")).filter(Boolean);
  const venueHit = venueWords.some((v) => words.includes(v) || v.split(" ").some((w) => w.length > 3 && words.split(" ").includes(w)));
  if (MONTHS.test(words) || WEEKDAYS.test(words) || venueHit || /\b\d{1,2}(:\d{2})?\s?(AM|PM)\b/.test(words)) return { role: "info", artist: null };
  return { role: "other", artist: null };
}

const MONTHS = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\b/;
const WEEKDAYS = /\b(MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT|SUN)[A-Z]*\b/;

/** Every layer in the manifest, smart-object contents included, top first. */
export function allLayers(layers: readonly KitLayer[]): KitLayer[] {
  return layers.flatMap((layer) => [layer, ...allLayers(layer.smart_object?.layers ?? [])]);
}

/**
 * Which layer is which, from the layers' own words and names. Only shown
 * layers count. A role can have several hits (a logo inside and outside a
 * smart object, say); the caller reads them in order.
 */
export function identifyRoles(manifest: KitManifest, facts: RoleFacts): RoleHit[] {
  const hits: RoleHit[] = [];
  const headliners = facts.headliners.map(normalizeWords).filter(Boolean);
  const venueWords = [facts.venue, facts.city].map((v) => normalizeWords(v ?? "")).filter(Boolean);
  const shown = allLayers(manifest.layers).filter((layer) => layer.shown);
  for (const layer of shown) {
    const words = normalizeWords(layer.text?.content ?? "");
    const name = normalizeWords(layer.name);
    if (layer.text) {
      const named = headliners.filter((h) => words.includes(h));
      if (named.length >= 2 || (headliners.length === 1 && named.length === 1)) {
        hits.push({ role: "headliner_names", ref: layer.ref, name: layer.name, why: `text names ${named.length} of ${headliners.length} headliners` });
        const infoLines = (layer.text.lines ?? []).map((line, i) => ({ i, role: lineRole(line, [], facts).role })).filter((l) => l.role === "info");
        if (infoLines.length) {
          hits.push({ role: "info", ref: layer.ref, name: layer.name, why: `lines ${infoLines.map((l) => l.i + 1).join(", ")} of the same text layer` });
        }
        continue;
      }
      if (MONTHS.test(words) || WEEKDAYS.test(words) || venueWords.some((v) => words.includes(v)) || /\b\d{1,2}(ST|ND|RD|TH)?\b.*\b(AM|PM|\d{2}:\d{2})\b/.test(words)) {
        hits.push({ role: "info", ref: layer.ref, name: layer.name, why: "text carries a date, weekday, venue or city" });
        continue;
      }
      if (/\bBIRTHDAY\b|\bBDAY\b/.test(words)) {
        hits.push({ role: "title", ref: layer.ref, name: layer.name, why: "text says birthday" });
        continue;
      }
      if (/\bPUZZLE\b/.test(words) && words.split(" ").length <= 2) {
        hits.push({ role: "logo", ref: layer.ref, name: layer.name, why: "text is the brand word alone" });
        continue;
      }
    }
    if (/\bLOGO\b|\bPUZZLE\b/.test(name)) hits.push({ role: "logo", ref: layer.ref, name: layer.name, why: "layer name" });
    else if (/\bBIRTHDAY\b|\bBDAY\b|\bSCRIPT\b|\bNEON\b|\bTITLE\b/.test(name) && !/\bPOSTER\b/.test(name)) hits.push({ role: "title", ref: layer.ref, name: layer.name, why: "layer name" });
    else if (/\bDATE\b|\bVENUE\b|\bINFO\b|\bDETAILS\b/.test(name)) hits.push({ role: "info", ref: layer.ref, name: layer.name, why: "layer name" });
  }
  const topLevel = manifest.layers.filter((layer) => layer.shown && layer.has_pixels && layer.kind !== "text");
  const bottom = topLevel.at(-1);
  if (bottom?.bounds && bottom.bounds.width >= manifest.width * 0.9 && bottom.bounds.height >= manifest.height * 0.9) {
    hits.push({ role: "background", ref: bottom.ref, name: bottom.name, why: "lowest shown layer covering the canvas" });
  }
  return hits;
}

// ─── File names ─────────────────────────────────────────────────────────────

/** "PUZZLE BIRTHDAY 1 STORY.psd" → "puzzle-birthday-1-story". */
export function kitSlug(fileName: string): string {
  return fileName
    .replace(/\.(psd|psb)$/i, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** campaign-assets prefix for one PSD of one event. */
export function kitPrefix(eventId: string, psdName: string): string {
  return `kits/${eventId}/${kitSlug(psdName)}/`;
}

/** "layers/03-part-1-enzo-siragusa.png"; refs inside a smart object keep their path ("3>1" → "03_01"). */
export function layerFileName(layer: Pick<KitLayer, "ref" | "name">): string {
  const ref = layer.ref
    .split(/[/>]/)
    .map((part) => part.padStart(2, "0"))
    .join("_");
  const slug = normalizeWords(layer.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "layer";
  return `layers/${ref}-${slug}.png`;
}
