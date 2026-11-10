/**
 * Lab artist card, variant A only. A photo that passes the gate is the card.
 * One that does not is listed with the rule it failed. There is no cut-out
 * and no waiting state: Matas paused mattes.
 *
 * The Instagram sentence is a placeholder. Design has not ruled the words.
 */

import { EMPTY_CLAIM, extensionLabel, type ClaimHook, type Extension, type RuleResult } from "./artist-card.ts";

/** Design replaces this. It points at the artist's Instagram and nothing else. */
export function instagramPhotoLine(handle: string): string {
  const who = handle.replace(/^@/, "").trim();
  return who
    ? `PLACEHOLDER: a passing photo can come from @${who} on Instagram.`
    : "PLACEHOLDER: a passing photo can come from the artist's Instagram.";
}

export type GatedPhoto = {
  name: string;
  rules: readonly RuleResult[];
  /** Set when the photo was extended and still passes. */
  extension?: Extension;
  /** Set when the extension itself failed, so the photo is not variant A. */
  extensionFailure?: string | null;
};

export type VariantACard = {
  kind: "A";
  photoName: string;
  approvalLine: string;
  claim: ClaimHook;
};

export type NoPhotoCard = {
  kind: "no-photo";
  reasons: string[];
  instagramLine: string;
};

export type LabArtistCard = VariantACard | NoPhotoCard;

function passes(photo: GatedPhoto): boolean {
  return photo.rules.length > 0 && photo.rules.every((rule) => rule.pass) && !photo.extensionFailure;
}

/** Variant A, or the gate's reasons. Never a cut-out. */
export function planHeadlinerCard(photos: readonly GatedPhoto[], handle: string): LabArtistCard {
  const passing = photos.find(passes);
  if (passing) {
    return {
      kind: "A",
      photoName: passing.name,
      approvalLine: passing.extension ? extensionLabel(passing.extension) : "",
      claim: EMPTY_CLAIM,
    };
  }
  const reasons = photos.flatMap((photo) => {
    const failed = photo.rules.filter((rule) => !rule.pass).map((rule) => `${photo.name} — ${rule.detail}`);
    if (photo.extensionFailure) failed.push(`${photo.name} — ${photo.extensionFailure}`);
    return failed;
  });
  return { kind: "no-photo", reasons, instagramLine: instagramPhotoLine(handle) };
}
