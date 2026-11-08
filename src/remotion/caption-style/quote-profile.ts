/**
 * Quote overlay (Q2). A second profile. v1.json and the caption hash
 * are not inputs here.
 */

import { canonicalProfileJson, hashProfile } from "./profile.ts";
import quoteJson from "./quote-v1.json" with { type: "json" };

export type QuoteWeight = 700 | 400;

export type QuoteProfile = {
  id: string;
  fontFamily: string;
  fontWeight: QuoteWeight;
  altFontWeight: QuoteWeight;
  fontWidth: number;
  fill: string;
  stroke: null;
  shadow: false;
  capPctOfHeight: number;
  fontSizePctOfHeight: number;
  pitchPctOfHeight: number;
  horizontalCenterPctOfWidth: number;
  horizontalCenterMin: number;
  horizontalCenterMax: number;
  verticalCenterPctOfSourceHeight: number;
  verticalCenterInFourFive: number;
  wrapPctOfWidth: number;
  maxLines: number;
  emoji: "inline";
  quoteMarks: false;
  attribution: false;
  motion: "static";
  measurement: string;
};

export const quoteProfile = quoteJson as QuoteProfile;

let cachedVersion: Promise<string> | null = null;

/** sha256 of quote-v1.json. Independent of the caption style_version. */
export function quoteStyleVersion(): Promise<string> {
  cachedVersion ??= hashProfile(quoteProfile);
  return cachedVersion;
}

export function quoteCanonical(): string {
  return canonicalProfileJson(quoteProfile);
}
