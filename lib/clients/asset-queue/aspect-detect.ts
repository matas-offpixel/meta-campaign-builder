import type { AssetRatio } from "@/lib/types";

export type StandardAspect = AssetRatio;
export type DetectedAspect = StandardAspect | "other";

const TOLERANCE = 0.05;

const RATIO_TARGETS: { aspect: StandardAspect; value: number }[] = [
  { aspect: "1:1", value: 1 },
  { aspect: "4:5", value: 4 / 5 },
  { aspect: "9:16", value: 9 / 16 },
];

export function snapRatio(width: number, height: number): DetectedAspect {
  if (width <= 0 || height <= 0) return "other";
  const ratio = width / height;
  for (const { aspect, value } of RATIO_TARGETS) {
    if (Math.abs(ratio - value) / value <= TOLERANCE) {
      return aspect;
    }
  }
  return "other";
}

/**
 * Infer aspect ratio from filename hints (1080x1350, 4:5, vertical, etc.).
 */
export function parseAspectFromFilename(filename: string): StandardAspect | null {
  const name = filename.toLowerCase();

  const pixelMatch = name.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/);
  if (pixelMatch) {
    const w = Number(pixelMatch[1]);
    const h = Number(pixelMatch[2]);
    const snapped = snapRatio(w, h);
    return snapped === "other" ? null : snapped;
  }

  if (/\b9\s*:\s*16\b/.test(name)) return "9:16";
  if (/\b4\s*:\s*5\b/.test(name)) return "4:5";
  if (/\b1\s*:\s*1\b/.test(name)) return "1:1";

  // Compact tokens without colons (e.g. Hendry4x5.png, Hendry9x16.png)
  if (/(?:^|[^0-9])9x16(?:[^0-9]|$)/.test(name)) return "9:16";
  if (/(?:^|[^0-9])4x5(?:[^0-9]|$)/.test(name)) return "4:5";

  if (/\b(vert|vertical|story|stories|reel|reels)\b/.test(name)) return "9:16";
  if (/\b(feed|post)\b/.test(name)) return "4:5";

  return null;
}

export function mergeAspectHints(
  fromFilename: StandardAspect | null,
  fromProbe: DetectedAspect,
): DetectedAspect {
  if (fromFilename) return fromFilename;
  return fromProbe;
}
