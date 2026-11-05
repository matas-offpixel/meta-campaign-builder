/**
 * The one locked caption style (roadmap §2 rule 2). v1.json is the
 * measured profile; style_version is the sha256 of its canonical JSON
 * (sorted keys, no whitespace), so editing any value changes the version.
 * No Remotion imports: caption validation and the node tests load this too.
 */

import profileJson from "./v1.json" with { type: "json" };

export type CaptionAspect = "9:16" | "4:5";

export type SafeInsets = { left: number; right: number; top: number; bottom: number };

export type CaptionProfile = {
  id: string;
  fontFamily: string;
  fontWeight: number;
  /** TikTok Sans `wdth` axis. 100 is the default; the variable font does not apply CSS font-weight unless the axis is set. */
  fontWidth: number;
  /** em size ÷ frame width. 4:5 keeps the width, so the caption stays the same size against the footage. */
  fontSizePctOfWidth: number;
  fill: string;
  stroke: string;
  strokeWidthPctOfFontSize: number;
  lineHeight: number;
  charsPerLine: number;
  maxLines: number;
  horizontalCenterPctOfWidth: number;
  /** Of the source frame, so a 4:5 crop keeps the caption on the same footage. */
  verticalCenterPctOfSourceHeight: number;
  safeZone: Record<CaptionAspect, SafeInsets>;
  measurement: string;
};

export const profile = profileJson as CaptionProfile;

/** The validator's wrap width. One source: v1.json. */
export const CHARS_PER_LINE = profile.charsPerLine;

const ASPECT_RATIO: Record<CaptionAspect, number> = { "9:16": 16 / 9, "4:5": 5 / 4 };

function evenDown(n: number): number {
  return Math.floor(n / 2) * 2;
}

/** Stable JSON: sorted keys at every level, no whitespace. */
export function canonicalProfileJson(value: unknown = profile): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalProfileJson(v)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalProfileJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

let cachedVersion: Promise<string> | null = null;

/** sha256 hex of the canonical profile. Same value in Node and in the render bundle. */
export function styleVersion(): Promise<string> {
  cachedVersion ??= crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalProfileJson())).then((buf) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
  return cachedVersion;
}

export type FrameSize = { width: number; height: number };

/**
 * Output size for a source. A portrait source keeps its width: 9:16 is the
 * source, 4:5 is a same-width vertical crop. A landscape source (the raw
 * originals are wider than 9:16) is centre-cropped to a 9:16 window at the
 * source height, and 4:5 crops that window vertically. Never upscales, and
 * both sides are even for h264. Throws when a portrait source is too short
 * to crop to 4:5.
 */
export function outputSize(sourceWidth: number, sourceHeight: number, aspect: CaptionAspect): FrameSize {
  const width = evenDown(sourceWidth);
  const height = evenDown(sourceHeight);
  if (width < 2 || height < 2) throw new Error(`source ${sourceWidth}x${sourceHeight} is too small to render`);
  if (sourceWidth > sourceHeight) {
    const plateWidth = evenDown(height * (9 / 16));
    if (plateWidth < 2) throw new Error(`source ${sourceWidth}x${sourceHeight} is too small to crop to 9:16`);
    if (aspect === "9:16") return { width: plateWidth, height };
    const feedHeight = evenDown(Math.round(plateWidth * ASPECT_RATIO["4:5"]));
    if (feedHeight > height) {
      throw new Error(`source ${sourceWidth}x${sourceHeight} is not tall enough to crop to 4:5`);
    }
    return { width: plateWidth, height: feedHeight };
  }
  if (aspect === "9:16") return { width, height };
  const feedHeight = evenDown(Math.round(width * ASPECT_RATIO["4:5"]));
  if (feedHeight > sourceHeight) {
    throw new Error(`source ${sourceWidth}x${sourceHeight} is not tall enough to crop to 4:5 at ${width} wide`);
  }
  return { width, height: feedHeight };
}

export type CropWindow = { left: number; top: number; width: number; height: number };

/**
 * The source rectangle the output shows. A portrait 9:16 shows the whole
 * frame. A landscape 9:16 is a centre horizontal crop at the full height.
 * 4:5 then takes a vertical slice of that window. `cropFocusY` (0–1) is the
 * source point that lands on the output's vertical centre.
 */
export function cropWindow(
  sourceWidth: number,
  sourceHeight: number,
  output: FrameSize,
  aspect: CaptionAspect,
  cropFocusY: number,
): CropWindow {
  const landscape = sourceWidth > sourceHeight;
  const plateWidth = landscape ? output.width : sourceWidth;
  const left = landscape ? Math.max(0, (sourceWidth - plateWidth) / 2) : 0;
  if (aspect === "9:16" && !landscape) return { left: 0, top: 0, width: sourceWidth, height: sourceHeight };
  const scale = output.width / plateWidth;
  const cropHeight = output.height / scale;
  if (aspect === "9:16") return { left, top: 0, width: plateWidth, height: sourceHeight };
  const focus = Math.min(1, Math.max(0, cropFocusY));
  const top = Math.min(Math.max(0, focus * sourceHeight - cropHeight / 2), sourceHeight - cropHeight);
  return { left, top, width: plateWidth, height: cropHeight };
}

export type CaptionLayout = {
  output: FrameSize;
  fontPx: number;
  strokePx: number;
  centerX: number;
  centerY: number;
  crop: CropWindow;
  /** Output pixels of video per source pixel. 1 when the output matches the source width. */
  scale: number;
  safeWidth: number;
};

export function captionLayout(
  sourceWidth: number,
  sourceHeight: number,
  aspect: CaptionAspect,
  cropFocusY: number,
): CaptionLayout {
  const output = outputSize(sourceWidth, sourceHeight, aspect);
  const crop = cropWindow(sourceWidth, sourceHeight, output, aspect, cropFocusY);
  const scale = output.width / crop.width;
  const insets = profile.safeZone[aspect];
  const sourceY = profile.verticalCenterPctOfSourceHeight * sourceHeight;
  return {
    output,
    fontPx: profile.fontSizePctOfWidth * output.width,
    strokePx: profile.strokeWidthPctOfFontSize * profile.fontSizePctOfWidth * output.width,
    centerX: profile.horizontalCenterPctOfWidth * output.width,
    centerY: (sourceY - crop.top) * scale,
    crop,
    scale,
    safeWidth: output.width * (1 - insets.left - insets.right),
  };
}

/** A measured line width fits the aspect's safe zone. */
export function lineFits(lineWidthPx: number, layout: CaptionLayout): boolean {
  return lineWidthPx <= layout.safeWidth;
}
