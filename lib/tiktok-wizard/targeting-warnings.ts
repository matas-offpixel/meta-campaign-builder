/**
 * lib/tiktok-wizard/targeting-warnings.ts
 *
 * Names the places where TikTok's ad-group API is coarser than the wizard's
 * controls, so the operator reads the widening at selection time instead of
 * discovering it in Ads Manager. These do not change what is sent — the
 * mapping in `lib/tiktok/write/mapping.ts` is TikTok's constraint — they just
 * stop it being silent.
 */

import { resolveTikTokGenderLabel } from "./audience-display.ts";
import {
  mapTikTokAgeGroups,
  mapTikTokGender,
  TIKTOK_AGE_GROUP_RANGES,
} from "../tiktok/write/mapping.ts";
import type { TikTokAudiences } from "../types/tiktok-draft.ts";

export type TikTokGenderSelection = TikTokAudiences["genders"];

/**
 * TikTok's ad-group `gender` is GENDER_MALE | GENDER_FEMALE |
 * GENDER_UNLIMITED. The wizard offers Unknown as a first-class chip and allows
 * multi-select, so UNKNOWN alone, MALE+FEMALE, MALE+UNKNOWN, FEMALE+UNKNOWN
 * and all three all collapse to GENDER_UNLIMITED — no gender targeting at all.
 * Selecting nothing is already GENDER_UNLIMITED and needs no warning.
 */
export function tikTokGenderWideningNote(
  genders: TikTokGenderSelection,
): string | null {
  const selected = [...new Set(genders)];
  if (selected.length === 0) return null;
  const mapped = mapTikTokGender(selected);
  if (!mapped.ok || mapped.value !== "GENDER_UNLIMITED") return null;
  const labels = selected.map(resolveTikTokGenderLabel).join(" + ");
  return `${labels} ships as unlimited gender (GENDER_UNLIMITED) — TikTok's ad-group gender field is only Male, Female or Unlimited, so this ad set reaches every gender.`;
}

/**
 * TikTok targets whole `age_groups` buckets, and the top bucket is
 * AGE_55_100. An upper bound of 65 therefore ships as 18–100.
 */
export function tikTokAgeWideningNote(
  ageMin: number,
  ageMax: number,
): string | null {
  const mapped = mapTikTokAgeGroups(ageMin, ageMax);
  if (!mapped.ok) return null;
  const buckets = TIKTOK_AGE_GROUP_RANGES.filter((bucket) =>
    mapped.value.includes(bucket.id),
  );
  if (buckets.length === 0) return null;
  const effectiveMin = Math.min(...buckets.map((bucket) => bucket.min));
  const effectiveMax = Math.max(...buckets.map((bucket) => bucket.max));
  if (effectiveMin === ageMin && effectiveMax === ageMax) return null;
  return `Age ${ageMin}–${ageMax} ships as ${effectiveMin}–${effectiveMax} — TikTok only targets whole age buckets (${mapped.value.join(", ")}).`;
}

/** Every widening note for the current audience selection, in UI order. */
export function tikTokTargetingWideningNotes(
  audiences: TikTokAudiences,
): string[] {
  return [
    tikTokAgeWideningNote(audiences.ageMin, audiences.ageMax),
    tikTokGenderWideningNote(audiences.genders),
  ].filter((note): note is string => note != null);
}

/** Shown next to the campaign-wide audience pickers (issue 5 labelling). */
export const TIKTOK_CAMPAIGN_WIDE_AUDIENCE_NOTE =
  "Custom audiences and lookalikes are campaign-wide: they are applied to every ad group, not to the interest group selected above.";

/** Shown on the lookalikes picker — `saved_audience_id` is singular. */
export const TIKTOK_SAVED_AUDIENCE_SINGLE_NOTE =
  "TikTok accepts one saved audience per ad group (saved_audience_id), so select a single lookalike.";
