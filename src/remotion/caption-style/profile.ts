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
  /** False until Matas signs the long-size side-by-side. Not part of the style hash. */
  longApproved: boolean;
  /** Smaller type for overlays of 73–96 characters. Four lines, 24 characters. */
  long: {
    fontSizePctOfWidth: number;
    charsPerLine: number;
    maxLines: number;
    minChars: number;
    maxChars: number;
    source: string;
  };
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

export type CaptionSize = "default" | "long";

/** Type size for one variant. Does not consult longApproved: the render path refuses an unapproved long burn. */
export function captionLimits(size: CaptionSize = "default"): {
  fontSizePctOfWidth: number;
  charsPerLine: number;
  maxLines: number;
} {
  if (size === "long") {
    return {
      fontSizePctOfWidth: profile.long.fontSizePctOfWidth,
      charsPerLine: profile.long.charsPerLine,
      maxLines: profile.long.maxLines,
    };
  }
  return {
    fontSizePctOfWidth: profile.fontSizePctOfWidth,
    charsPerLine: profile.charsPerLine,
    maxLines: profile.maxLines,
  };
}

/**
 * The hashed profile. `longApproved` is left out: signing the long size
 * off must not change style_version, or every caption already stamped
 * would stop rendering. The long size numbers stay in the hash.
 */
export function versionedProfile(value: unknown = profile): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const copy = { ...(value as Record<string, unknown>) };
    delete copy.longApproved;
    return copy;
  }
  return value;
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

/** sha256 hex of the profile with longApproved removed. */
export function hashProfile(value: unknown = profile): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalProfileJson(versionedProfile(value)))).then((buf) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
}

/** sha256 hex of the canonical profile, ignoring longApproved. Same value in Node and in the render bundle. */
export function styleVersion(): Promise<string> {
  cachedVersion ??= hashProfile(profile);
  return cachedVersion;
}

export type FrameSize = { width: number; height: number };

/** Every clip is scaled to this after the 9:16 crop. */
export const RENDER_WIDTH = 1080;
export const RENDER_HEIGHT = 1920;

/** A crop narrower than this is refused. The source is not upscaled into a sharp frame. */
export const MIN_CROP_WIDTH_PX = 540;

export const LOW_QUALITY_AFTER_CROP = "Too low quality after crop — find a sharper copy or ask the team";

const NINE_BY_SIXTEEN = 9 / 16;

function nearestEven(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** 0 is the left edge, 1 the right. Anything outside that, or not a number, is the centre. */
export function clampFocus(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export type CropWindow = { left: number; top: number; width: number; height: number };

/**
 * The source rectangle that becomes the 9:16 frame.
 * A source already 9:16 (within 2%) is untouched.
 * Wider than 9:16: the window is the full height and 9:16 wide, placed by
 * cropFocusX. Taller: the window is the full width and 9:16 tall, centred.
 * cropFocusY does not move this window.
 */
export function cropWindow(sourceWidth: number, sourceHeight: number, cropFocusX = 0.5): CropWindow {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error(`source ${sourceWidth}x${sourceHeight} is too small to render`);
  }
  const ratio = sourceWidth / sourceHeight;
  if (Math.abs(ratio - NINE_BY_SIXTEEN) / NINE_BY_SIXTEEN <= 0.02) {
    return { left: 0, top: 0, width: sourceWidth, height: sourceHeight };
  }
  if (ratio > NINE_BY_SIXTEEN) {
    const width = Math.min(sourceWidth, nearestEven(sourceHeight * NINE_BY_SIXTEEN));
    const spare = Math.max(0, sourceWidth - width);
    return { left: spare * clampFocus(cropFocusX), top: 0, width, height: sourceHeight };
  }
  const height = Math.min(sourceHeight, nearestEven(sourceWidth / NINE_BY_SIXTEEN));
  const spare = Math.max(0, sourceHeight - height);
  return { left: 0, top: spare / 2, width: sourceWidth, height };
}

/**
 * Output size for a video. Always 1080×1920. The source is cropped to 9:16
 * first, then scaled. Under 540 px wide after the crop is refused.
 */
export function outputSize(sourceWidth: number, sourceHeight: number, aspect: CaptionAspect, cropFocusX = 0.5): FrameSize {
  if (aspect !== "9:16") throw new Error("video renders are 9:16 only");
  const crop = cropWindow(sourceWidth, sourceHeight, cropFocusX);
  if (crop.width < MIN_CROP_WIDTH_PX) throw new Error(LOW_QUALITY_AFTER_CROP);
  return { width: RENDER_WIDTH, height: RENDER_HEIGHT };
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
  size: CaptionSize = "default",
  cropFocusX = 0.5,
): CaptionLayout {
  const output = outputSize(sourceWidth, sourceHeight, aspect, cropFocusX);
  const crop = cropWindow(sourceWidth, sourceHeight, cropFocusX);
  const scale = output.width / crop.width;
  const insets = profile.safeZone["9:16"];
  const safeRect = safeRectangle(output, cropFocusY);
  const centred = safeRectangle(output, 0.5);
  const sourceY = profile.verticalCenterPctOfSourceHeight * sourceHeight;
  const limits = captionLimits(size);
  const fontPx = limits.fontSizePctOfWidth * output.width;
  return {
    output,
    fontPx,
    strokePx: profile.strokeWidthPctOfFontSize * fontPx,
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

export type LineStroke = {
  color: string;
  /** Visible outside edge, from the profile. */
  widthPx: number;
  /** Centred stroke drawn behind the fill. The fill covers the inner half, so the visible edge is widthPx. */
  drawnPx: number;
};

/** One outside stroke per line, the same width, from the profile. */
export function captionLineStrokes(lineCount: number, layout: CaptionLayout): LineStroke[] {
  const widthPx = layout.strokePx;
  return Array.from({ length: lineCount }, () => ({ color: profile.stroke, widthPx, drawnPx: widthPx * 2 }));
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
