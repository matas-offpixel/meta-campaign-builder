/**
 * The launch panel's "Ad set created" row: its status and detail line.
 *
 * The row label itself ("Ad set created · {Advantage+ | strict} age") is
 * built in components/steps/review-launch.tsx and is not changed here.
 * This adds the ruled step-2 line (launch.adset.age_widened, #1387): shown
 * only when the ad set went out Advantage+ WITHOUT the draft's age
 * suggestion (`ageSuggestionDropped`), so it reaches {control}–65+. Never
 * on step 1 (the suggestion went out) and never on step 3 (the ad set
 * failed; its row is the failed-ad-set line with Meta's error).
 */

import { LAUNCH_GUARD_WORDS as W } from "./words.ts";

export interface CreatedAdSetRowInput {
  note?: string;
  ageSuggestionDropped?: "objective" | "meta_refused";
  ageWidened?: { min: number; max: number; control: number };
}

/** The ruled step-2 sentence, filled; null unless step 2 went out. */
export function ageWidenedLine(row: CreatedAdSetRowInput): string | null {
  if (!row.ageSuggestionDropped || !row.ageWidened) return null;
  const v = row.ageWidened;
  return W["launch.adset.age_widened"]
    .replace("{min}", String(v.min))
    .replace("{max}", String(v.max))
    .replace("{control}", String(v.control));
}

/**
 * Status and detail for an "Ad set created" row. `withNote` keeps today's
 * split: the standard rows show the salvage note, the multi-campaign rows
 * don't. The step-2 line shows on both, and makes the row a warning.
 */
export function createdAdSetRow(
  row: CreatedAdSetRowInput,
  withNote: boolean,
): { status: "success" | "warning"; detail?: string } {
  const age = ageWidenedLine(row);
  const note = withNote ? row.note : undefined;
  const parts = [age, note].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? { status: "warning", detail: parts.join(" ") } : { status: "success" };
}
