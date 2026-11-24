/**
 * Campaign tree on the event (R7): the words (design record
 * docs/design-record/2026-11-24-campaign-creator-replicate.html, RC6, frame RC-F).
 *
 * TREE_WORDS holds the record's `tree.*` rows exactly as the word list
 * (words-rc-2026-11-24.tsv) has them. The stage names (`tree.stages`) are
 * CC-1's, in lib/replicate/words.ts (STAGE_LABEL), and aren't repeated here.
 *
 * FRAME_WORDS are drawn in the record's frames (RC-A, RC-B, RC-F) with no
 * row of their own in the word list: the campaign row's status and ad set
 * count, the buttons, the picker's heading. Each one is in the record's HTML,
 * word for word; lib/campaign-tree/__tests__/words.test.ts checks both.
 */

import { fillWords, type WordFill } from "../replicate/words.ts";

export const TREE_WORDS = {
  "tree.master": "master",
  "tree.add.creatives": "+ {n} ads added",
  "tree.add.audience": "+ audience added",
  "tree.add.line": "{date} · to {n} ad sets · {who}",
  "tree.add.audience_line": "{date} · {audience} → {n} ad sets · {who}",
  "tree.add.refresh": "proposed by the on-sale refresh",
  "tree.action.creatives": "Add creatives to…",
  "tree.action.audience": "Add audience to…",
  "tree.sheet.title.creatives": "Add {n} creatives to {stage}",
  "tree.sheet.title.audience": "Add {audience} to {stage}",
  "tree.sheet.count": "{n} of {m} ad sets",
  "tree.sheet.paused": "paused",
  "tree.sheet.button": "Add to {n} ad sets in {m} campaigns",
  "tree.sheet.note": "Logged under each campaign.",
} as const;

export type TreeWordKey = keyof typeof TREE_WORDS;

/**
 * Drawn in the record's frames, not listed as rows. Keys are ours; the words
 * are the frames'. "… and {n} more" is the list's `launch.evidence.more` row.
 */
export const FRAME_WORDS = {
  /** RC-F campaign row: "live · 18 ad sets", "paused · 1 ad set". */
  live: "live",
  paused: "paused",
  adSets: "{n} ad sets",
  adSetOne: "1 ad set",
  /** RC-F sheet: the ad sets past the first three. */
  more: "… and {n} more",
  /** RC-A, RC-B buttons. */
  cancel: "Cancel",
  next: "Next",
  back: "Back",
  /** RC-A picker heading: "Upcoming · Electric". */
  upcoming: "Upcoming · {client}",
  /** RC-A campaign ⋯ menu, under Duplicate. */
  editDraft: "Edit draft",
  adsManager: "View in Ads Manager ↗",
} as const;

export type FrameWordKey = keyof typeof FRAME_WORDS;

export function treeWord(key: TreeWordKey, fill: WordFill = {}): string {
  return fillWords(TREE_WORDS[key], fill);
}

export function frameWord(key: FrameWordKey, fill: WordFill = {}): string {
  return fillWords(FRAME_WORDS[key], fill);
}

/** RC-F's campaign-row count: "18 ad sets", "1 ad set". */
export function adSetCount(n: number): string {
  return n === 1 ? FRAME_WORDS.adSetOne : frameWord("adSets", { n });
}
