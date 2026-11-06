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
  /** em size ÷ frame width. */
  fontSizePctOfWidth: number;
  fill: string;
  stroke: string;
  strokeWidthPctOfFontSize: number;
  lineHeight: number;
  charsPerLine: number;
  maxLines: number;
  horizontalCenterPctOfWidth: number;
  /** Of the source frame. At crop focus 0.5 this is where the block sits; other foci move it with the safe rectangle. */
  verticalCenterPctOfSourceHeight: number;
  safeZone: Record<CaptionAspect, SafeInsets>;
  /** Centred 4:5 rectangle inside the 9:16 frame: x 0, y 0.1458, w 1, h 0.7083. */
  safeRect: { "9:16": SafeRect };
  measurement: string;
};

export type SafeRect = { x: number; y: number; w: number; h: number };

export const profile = profileJson as CaptionProfile;

/** The validator's wrap width. One source: v1.json. */
export const CHARS_PER_LINE = profile.charsPerLine;

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
 * Output size for a video. Always 9:16. A portrait source keeps its width.
 * A landscape source is centre-cropped to a 9:16 window at the source
 * height. Never upscales, and both sides are even for h264. The 4:5
 * rectangle is a safe area inside this frame, not a second output.
 */
export function outputSize(sourceWidth: number, sourceHeight: number, aspect: CaptionAspect): FrameSize {
  if (aspect !== "9:16") throw new Error("video renders are 9:16 only");
  const width = evenDown(sourceWidth);
  const height = evenDown(sourceHeight);
  if (width < 2 || height < 2) throw new Error(`source ${sourceWidth}x${sourceHeight} is too small to render`);
  if (sourceWidth > sourceHeight) {
    const plateWidth = evenDown(height * (9 / 16));
    if (plateWidth < 2) throw new Error(`source ${sourceWidth}x${sourceHeight} is too small to crop to 9:16`);
    return { width: plateWidth, height };
  }
  return { width, height };
}

export type CropWindow = { left: number; top: number; width: number; height: number };

/**
 * The source rectangle the 9:16 output shows. A portrait source shows the
 * whole frame. A landscape source is a centre horizontal crop at the full
 * height. `cropFocusY` moves the safe rectangle, not this window.
 */
export function cropWindow(sourceWidth: number, sourceHeight: number, output: FrameSize): CropWindow {
  if (sourceWidth <= sourceHeight) return { left: 0, top: 0, width: sourceWidth, height: sourceHeight };
  return { left: Math.max(0, (sourceWidth - output.width) / 2), top: 0, width: output.width, height: sourceHeight };
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
  /** 4:5 rectangle in output pixels. Its vertical centre is cropFocusY, clamped so the rectangle stays in the frame. */
  safeRect: { x: number; y: number; width: number; height: number };
};

export type LineBox = { left: number; top: number; width: number; height: number };

/**
 * The 4:5 safe rectangle for a 9:16 output. The profile stores the centred
 * rectangle (crop focus 0.5). Another focus slides that rectangle, and the
 * caption with it, then clamps it inside the frame.
 */
export function safeRectangle(output: FrameSize, cropFocusY: number): { x: number; y: number; width: number; height: number } {
  const spec = profile.safeRect["9:16"];
  const width = spec.w * output.width;
  const height = spec.h * output.height;
  const centredTop = spec.y * output.height;
  const focus = Math.min(1, Math.max(0, cropFocusY));
  const unclamped = centredTop + (focus - 0.5) * output.height;
  const y = Math.min(Math.max(0, unclamped), Math.max(0, output.height - height));
  return { x: spec.x * output.width, y, width, height };
}

export function captionLayout(
  sourceWidth: number,
  sourceHeight: number,
  aspect: CaptionAspect,
  cropFocusY: number,
): CaptionLayout {
  const output = outputSize(sourceWidth, sourceHeight, aspect);
  const crop = cropWindow(sourceWidth, sourceHeight, output);
  const scale = output.width / crop.width;
  const insets = profile.safeZone["9:16"];
  const safeRect = safeRectangle(output, cropFocusY);
  const centred = safeRectangle(output, 0.5);
  const sourceY = profile.verticalCenterPctOfSourceHeight * sourceHeight;
  return {
    output,
    fontPx: profile.fontSizePctOfWidth * output.width,
    strokePx: profile.strokeWidthPctOfFontSize * profile.fontSizePctOfWidth * output.width,
    centerX: profile.horizontalCenterPctOfWidth * output.width,
    centerY: (sourceY - crop.top) * scale + (safeRect.y - centred.y),
    crop,
    scale,
    safeWidth: output.width * (1 - insets.left - insets.right),
    safeRect,
  };
}

/** A measured line width fits the 9:16 safe zone. */
export function lineFits(lineWidthPx: number, layout: CaptionLayout): boolean {
  return lineWidthPx <= layout.safeWidth;
}

/** Each line's box: the measured width, and one line-height, stacked on the block centre. */
export function lineBoxes(layout: CaptionLayout, lineWidths: readonly number[]): LineBox[] {
  const lineHeight = layout.fontPx * profile.lineHeight;
  const top = layout.centerY - (lineWidths.length * lineHeight) / 2;
  return lineWidths.map((width, i) => ({
    left: layout.centerX - width / 2,
    top: top + i * lineHeight,
    width,
    height: lineHeight,
  }));
}

/** True when the box lies entirely inside the rectangle. */
export function boxInsideRect(
  rect: { x: number; y: number; width: number; height: number },
  box: LineBox,
): boolean {
  return box.left >= rect.x && box.top >= rect.y && box.left + box.width <= rect.x + rect.width && box.top + box.height <= rect.y + rect.height;
}

/** True when every measured line sits inside the 4:5 safe rectangle. */
export function captionInsideSafeRect(layout: CaptionLayout, lineWidths: readonly number[]): boolean {
  return lineBoxes(layout, lineWidths).every((box) => boxInsideRect(layout.safeRect, box));
}
