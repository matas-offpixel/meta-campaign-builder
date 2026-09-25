/**
 * One rule for the creative name an uploaded file gets.
 *
 * The plan canvas and both wizards call this. A second sanitiser would
 * name the same file differently on each path — the bug this exists to close.
 *
 * Separators are left as the operator wrote them. `CamelPhat_Ironworks_9x16`
 * stays that way; they named the file, and a name they recognise beats one
 * we prettified.
 *
 * Limits: Meta ad `name` is 400 characters; TikTok `ad_name` is 512. The cap
 * is one below the lower of those. Variation suffixes (` · v10`) are reserved
 * inside the cap so they are not sliced off the creative name. TikTok's cover
 * upload (`coverFileName`) slices the sanitised creative name to 80 and only
 * then appends #975's uniqueness stamp, so a long stem cannot eat that stamp.
 */

import type { AdCreativeDraft } from "./types.ts";

/** Meta Marketing API ad `name`. */
export const META_AD_NAME_LIMIT = 400;

/** TikTok Marketing API `ad_name`. */
export const TIKTOK_AD_NAME_LIMIT = 512;

/** Strictly below the lower of the two ad-name limits. */
export const CREATIVE_NAME_MAX_LENGTH =
  Math.min(META_AD_NAME_LIMIT, TIKTOK_AD_NAME_LIMIT) - 1;

/** Longest variation marker the upload fan-out emits (` · v10`). */
export const CREATIVE_VARIATION_SUFFIX_RESERVE = " · v10".length;

export const TIKTOK_CREATIVE_DEFAULT_NAME = "TikTok creative";

/** Generated Meta names. An operator-typed name does not match. */
const GENERATED_META_CREATIVE_NAME = /^Ad \d+$/;

export function isExplicitTikTokBaseName(baseName: string): boolean {
  const trimmed = baseName.trim();
  return trimmed.length > 0 && trimmed !== TIKTOK_CREATIVE_DEFAULT_NAME;
}

export function isGeneratedMetaCreativeName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length === 0 || GENERATED_META_CREATIVE_NAME.test(trimmed);
}

/**
 * Cap `name`, leaving `reserveSuffix` characters free at the end so a marker
 * appended afterwards still fits under {@link CREATIVE_NAME_MAX_LENGTH}.
 */
export function capCreativeName(name: string, reserveSuffix = 0): string {
  const room = CREATIVE_NAME_MAX_LENGTH - reserveSuffix;
  const trimmed = name.trim();
  if (room <= 0) return "";
  if (trimmed.length <= room) return trimmed;
  return trimmed.slice(0, room).trimEnd();
}

/**
 * Strip one extension and cap. Empty stems (a file named `.mp4`) return
 * `fallback` unchanged — callers pass the name that path already used.
 */
export function creativeNameFromFilename(filename: string, fallback: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").trim();
  const capped = capCreativeName(stem);
  return capped || fallback;
}

/**
 * A Meta ad's name is its creative's name, the same in every ad set it runs
 * in. Reporting groups ads by name (`groupCreativesByName`); a per-ad-set
 * suffix splits one creative into one row per ad set. The ad id tells them
 * apart, and Meta allows duplicate ad names.
 */
export function metaAdName(creativeName: string): string {
  return capCreativeName(creativeName) || "Ad";
}

export function withCreativeVariationSuffix(base: string, variation: number): string {
  const suffix = ` · v${variation}`;
  return `${capCreativeName(base, suffix.length)}${suffix}`;
}

/**
 * First uploaded filename on a creative.
 *
 * Walks `assetVariations` in array order, then each variation's `assets` in
 * slot order. Slot order is `getAspectRatioSlots`: 4:5, then 9:16, then 1:1.
 * A dual creative bound in one pass is therefore named from the 4:5 file when
 * that slot has a `fileName`, and from the 9:16 file when the feed slot is
 * empty. A later upload does not rename a creative that already left the
 * generated default — see {@link nameMetaCreativeFromAssets}.
 */
export function firstAssetFileName(creative: AdCreativeDraft): string | null {
  for (const variation of creative.assetVariations ?? []) {
    for (const asset of variation.assets ?? []) {
      const fileName = asset.fileName?.trim();
      if (fileName) return fileName;
    }
  }
  return null;
}

/**
 * Name a creative from its first `fileName` only while the name is still the
 * generated default (`""` or `Ad N`). Operator-typed names, and names already
 * taken from an earlier file, are returned unchanged. Assets with no
 * `fileName` leave the current name in place.
 */
export function nameMetaCreativeFromAssets(creative: AdCreativeDraft): AdCreativeDraft {
  if (!isGeneratedMetaCreativeName(creative.name)) return creative;
  const fileName = firstAssetFileName(creative);
  if (!fileName) return creative;
  const next = creativeNameFromFilename(fileName, creative.name);
  if (next === creative.name) return creative;
  return { ...creative, name: next };
}
