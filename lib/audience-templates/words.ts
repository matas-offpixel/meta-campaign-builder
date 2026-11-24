/**
 * Audience templates (R6): the words. Design record
 * docs/design-record/2026-11-24-campaign-creator-replicate.html, RC5 and
 * frame RC-E.
 *
 * TEMPLATE_WORDS is copied from the record's word list
 * (words-rc-2026-11-24.tsv, kept as the test fixture next to the tests).
 * Never write a string there that isn't in that list:
 * lib/audience-templates/__tests__/words.test.ts fails on any difference.
 *
 * TEMPLATE_FRAME_WORDS are the item lines frame RC-E draws that the word
 * list doesn't carry (the item titles and sub-lines, and the tab name
 * "Audiences" beside the new tab). The same test checks each one, filled
 * with the frame's own values, appears in the record.
 *
 * Pure. No `@/` imports, so node --test can load it.
 */

import { fillWords, type WordFill } from "../replicate/words.ts";

export const TEMPLATE_WORDS = {
  "templates.tab": "Audience templates",
  "templates.beta": "BETA",
  "templates.names": "House & disco · House & garage · Techno · Commercial house",
  "templates.for": "For {families} shows: {shows}",
  "templates.confirmed": "confirmed by {name} {date}",
  "templates.account": "in {account}",
  "templates.unconfirmed": "Not confirmed yet",
  "templates.unconfirmed.line": "Matas confirms a template before it’s used.",
  "templates.groups": "Customer lists · Retargeting pools · Artist page engagers · Interests",
  "templates.reused": "Reused",
  "templates.create": "Will be created",
  "templates.footer": "{n} reused · {m} will be created in {account}",
  "templates.writes_off": "Creating audiences is switched off, so these {m} wait.",
  "templates.add_page": "Add page to this group",
  "templates.changed": "{n} change since this template was saved / {n} changes since this template was saved",
  "templates.save": "Save to template",
} as const;

export type TemplateWordKey = keyof typeof TEMPLATE_WORDS;

/** Frame RC-E's own lines. Braces are the values the frame fills in. */
export const TEMPLATE_FRAME_WORDS = {
  /** The existing tab, beside the new one (RC-E's tab row). */
  "frame.tab.audiences": "Audiences",
  "frame.list.line": "Customer list · role: {role}, {family}",
  "frame.pool.page_views": "Page views",
  "frame.pool.signups": "Signups",
  "frame.pool.video_viewers": "Video viewers",
  "frame.pool.pixel.line": "{pixel} pixel · {days} days",
  "frame.pool.video.line": "{threshold}% watched · {days} days",
  "frame.page.line": "Facebook + Instagram · {days} days",
  "frame.interests.line": "{n} interests",
  /** Between the header's parts, the frame's own separator. */
  "frame.sep": " · ",
} as const;

export type TemplateFrameWordKey = keyof typeof TEMPLATE_FRAME_WORDS;

export function tw(key: TemplateWordKey, fill?: WordFill): string {
  return fill ? fillWords(TEMPLATE_WORDS[key], fill) : TEMPLATE_WORDS[key];
}

export function fw(key: TemplateFrameWordKey, fill?: WordFill): string {
  return fill ? fillWords(TEMPLATE_FRAME_WORDS[key], fill) : TEMPLATE_FRAME_WORDS[key];
}

/** One part of an "A · B · C" row, by its position. */
export function part(key: "templates.names" | "templates.groups", index: number): string {
  const parts = TEMPLATE_WORDS[key].split(" · ");
  const hit = parts[index];
  if (hit == null) throw new Error(`${key} has no part ${index}`);
  return hit;
}

/** The four template names, in the record's order. */
export const TEMPLATE_NAMES = TEMPLATE_WORDS["templates.names"].split(" · ") as [string, string, string, string];

/** The four item groups, in the record's order. */
export const GROUP_LABEL = {
  customer_list: part("templates.groups", 0),
  retargeting_pool: part("templates.groups", 1),
  page_engagers: part("templates.groups", 2),
  interest: part("templates.groups", 3),
} as const;

/** "{n} change…" or "{n} changes…": the record's two forms, picked by n. */
export function changedLine(n: number): string {
  const [one, many] = TEMPLATE_WORDS["templates.changed"].split(" / ");
  return fillWords(n === 1 ? one! : many!, { n });
}

/**
 * The footer (RC5): "{n} reused · {m} will be created in {account}", and
 * with audience writes off and something to create, the second sentence.
 * The frame joins them with ". ".
 */
export function footerLine(reused: number, toCreate: number, account: string, writesEnabled: boolean): string {
  const first = tw("templates.footer", { n: reused, m: toCreate, account });
  if (writesEnabled || toCreate === 0) return first;
  return `${first}. ${tw("templates.writes_off", { m: toCreate })}`;
}
