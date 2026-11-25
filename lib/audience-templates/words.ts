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
  "templates.item.held": "held in {Meta account name}",
  "templates.item.signups": "Customer list · role: signups · {code} · {n} signups",
  "templates.item.signups.one": "Customer list · role: signups · {code} · 1 signup",
  "templates.item.signups.none": "Customer list · role: signups · {code}",
  "templates.item.signups.waiting": "Made on {date}",
  "templates.apply": "Add to this draft",
  "templates.apply.done": "Added {template} to {draft}: {n} audiences.",
  "templates.apply.done.one": "Added {template} to {draft}: 1 audience.",
  "templates.apply.left_out": "{m} aren’t made yet, so they’re left out.",
  "templates.apply.left_out.one": "1 isn’t made yet, so it’s left out.",
  "templates.create_button": "Create {m} audiences in {Meta account name}",
  "templates.create_button.one": "Create 1 audience in {Meta account name}",
  "templates.created": "Created {m} in {Meta account name}.",
  "templates.created.one": "Created 1 in {Meta account name}.",
  "templates.create_failed": "{n} weren’t created. Try again.",
  "templates.create_failed.one": "1 wasn’t created. Try again.",
  "templates.item.videos": "Needs videos",
  "templates.item.videos.line": "Meta needs this show’s videos, so Create leaves this out until they’re picked.",
  "templates.item.videos.pick": "Pick this show’s videos",
  "templates.item.videos.picked": "{n} videos picked from {code}",
  "templates.item.videos.picked.one": "1 video picked from {code}",
  "templates.item.videos.change": "Change videos",
  "templates.footer.videos": "{k} need videos picked",
  "templates.footer.videos.one": "1 needs videos picked",
  "templates.writes_off.one": "Creating audiences is switched off, so this one waits.",
  "templates.picker.preset": "From {template}: {threshold} watched · {days} days. Pick this show’s videos.",
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
 * After a customer list's own line, when the list is held in another account
 * than the target (templates.item.held): "held in Electric Bristol Live".
 */
export function heldLine(accountName: string): string {
  return tw("templates.item.held", { "Meta account name": accountName });
}

/** A count as SU4 writes it: thousands separators ("1,204"). */
export function count(n: number): string {
  return n.toLocaleString("en-GB");
}

/** A show's Signups list line (SU2): with its count once made, without before. */
export function signupsLine(code: string, n: number | null): string {
  if (n == null) return tw("templates.item.signups.none", { code });
  return n === 1 ? tw("templates.item.signups.one", { code }) : tw("templates.item.signups", { code, n: count(n) });
}

/** "Made on Thu 27 Nov": a show's list before the sync makes it, in place of a status. */
export function madeOnLine(date: string): string {
  return tw("templates.item.signups.waiting", { date });
}

/** After "Add to this draft": the added line, and the left-out line when some aren't made yet. */
export function addedLines(template: string, draft: string, n: number, m: number): string[] {
  const done = n === 1 ? tw("templates.apply.done.one", { template, draft }) : tw("templates.apply.done", { template, draft, n });
  if (m === 0) return [done];
  return [done, m === 1 ? tw("templates.apply.left_out.one") : tw("templates.apply.left_out", { m })];
}

/** "Create {m} audiences in {account}", one form for 1. */
export function createButtonLabel(m: number, account: string): string {
  return m === 1
    ? tw("templates.create_button.one", { "Meta account name": account })
    : tw("templates.create_button", { m, "Meta account name": account });
}

/** After Create: what was made, and what wasn't. */
export function createdLines(created: number, failed: number, account: string): string[] {
  const out: string[] = [];
  if (created > 0) {
    out.push(created === 1 ? tw("templates.created.one", { "Meta account name": account }) : tw("templates.created", { m: created, "Meta account name": account }));
  }
  if (failed > 0) out.push(failed === 1 ? tw("templates.create_failed.one") : tw("templates.create_failed", { n: failed }));
  return out;
}

/** "3 videos picked from NX26-LOCKLEAD", one form for 1. */
export function pickedLine(n: number, code: string): string {
  return n === 1 ? tw("templates.item.videos.picked.one", { code }) : tw("templates.item.videos.picked", { n, code });
}

/** The picker's header when a template item opens it: "From House & disco: 50% watched · 30 days. …". */
export function pickerPresetLine(template: string, threshold: number, days: number): string {
  return tw("templates.picker.preset", { template, threshold: `${threshold}%`, days });
}

/**
 * The footer (RC5, and the 25 Nov ruling for video-viewer items):
 * "{n} reused · {m} will be created in {account}", then " · {k} need videos
 * picked" when some wait for videos (the "will be created" part is dropped
 * when m is 0), then, with audience writes off and something to create, the
 * writes-off sentence (its one-form for 1). Joined with ". " as the frames
 * draw them.
 */
export function footerLine(reused: number, toCreate: number, account: string, writesEnabled: boolean, needVideos = 0): string {
  const full = tw("templates.footer", { n: reused, m: toCreate, account });
  const head = needVideos > 0 && toCreate === 0 ? full.split(" · ")[0]! : full;
  const videos = needVideos === 0 ? "" : `${fw("frame.sep")}${needVideos === 1 ? tw("templates.footer.videos.one") : tw("templates.footer.videos", { k: needVideos })}`;
  const first = `${head}${videos}`;
  if (writesEnabled || toCreate === 0) return first;
  return `${first}. ${toCreate === 1 ? tw("templates.writes_off.one") : tw("templates.writes_off", { m: toCreate })}`;
}
