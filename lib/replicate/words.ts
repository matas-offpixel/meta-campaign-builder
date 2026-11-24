/**
 * Replicate to event: the words (design record
 * docs/design-record/2026-11-24-campaign-creator-replicate.html, RC1 · RC2).
 *
 * Copied from the record's word list (words-rc-2026-11-24.tsv, kept as the
 * test fixture next to the tests). Never write a string here that isn't in
 * that list: lib/replicate/__tests__/words.test.ts fails on any difference.
 * Braces are fill-ins; `fillWords` replaces them.
 */

export const REPLICATE_WORDS = {
  "replicate.menu": "Replicate to event…",
  "replicate.menu.sub": "Another event: account, pixel, link and copy follow it",
  "duplicate.menu": "Duplicate",
  "duplicate.menu.sub": "Same event, same settings",
  "replicate.title": "Replicate to event",
  "replicate.pick.question": "Which event is this for?",
  "replicate.pick.search": "Search events",
  "replicate.pick.source": "this campaign’s event",
  "replicate.summary.title": "Replicate {source name} to {target code}",
  "replicate.summary.changes": "Changes to match {code}",
  "replicate.change.labels": "Event · Name · Account · Pixel · Link · Dates · Copy · Audiences",
  "replicate.change.was": "(was {old})",
  "replicate.change.account": "Account: {account name}",
  "replicate.change.pixel": "Pixel …{last 4}",
  "replicate.change.link": "Link: {url} · {n} ads",
  "replicate.change.copy": "Rewritten from the {venue|artist} templates for {artist} at {venue}",
  "replicate.change.audiences": "{n} found in {account} · {m} will be created",
  "replicate.change.not_set": "{Field}: not set for {venue}, check",
  "replicate.kept.title": "Kept from the source",
  "replicate.kept.line": "Objective, {n} ad sets, budgets, placements, interests.",
  "replicate.page.question": "Ads run from {page}: keep or change",
  "replicate.page.keep": "Keep {page}",
  "replicate.page.change": "Change",
  "replicate.create": "Create draft",
  "replicate.create.note": "Nothing launches. Launch runs the checks.",
  "replicate.draft.line": "Replicated from {source name}, {date}. Launch runs the checks first.",
  // RC6's stage names, read here for the Dates row's "ends at {stage}".
  "tree.stages": "Signup · Presale · On sale · Show week",
} as const;

export type ReplicateWordKey = keyof typeof REPLICATE_WORDS;

/**
 * Value formats RC-B's frames show that the word list has no row for:
 * the Event row's "{code} · {venue}" and the Dates row's
 * "Starts {date} · ends at {stage}". Taken from the frame text exactly;
 * reported to design as a gap in the word list (CC-1, 24 Nov). The
 * event-day end ("ends {date}") isn't in any frame.
 */
export const REPLICATE_FRAME_FORMATS = {
  "replicate.value.event": "{code} · {venue}",
  "replicate.value.dates.start": "Starts {date}",
  "replicate.value.dates.end_stage": "ends at {stage}",
  "replicate.value.dates.end_date": "ends {date}",
  "replicate.value.join": " · ",
} as const;

export type ReplicateFrameKey = keyof typeof REPLICATE_FRAME_FORMATS;

export function word(key: ReplicateWordKey): string {
  return REPLICATE_WORDS[key];
}

/** Replace each `{name}` with its value. A fill-in with no value stays as written. */
export function fillWords(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{([^{}]+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

/** One label from a "A · B · C" row, by its position. */
export function listPart(key: "replicate.change.labels" | "tree.stages", index: number): string {
  const parts = REPLICATE_WORDS[key].split(" · ");
  const part = parts[index];
  if (part == null) throw new Error(`${key} has no part ${index}`);
  return part;
}

export const CHANGE_LABEL = {
  event: listPart("replicate.change.labels", 0),
  name: listPart("replicate.change.labels", 1),
  account: listPart("replicate.change.labels", 2),
  pixel: listPart("replicate.change.labels", 3),
  link: listPart("replicate.change.labels", 4),
  dates: listPart("replicate.change.labels", 5),
  copy: listPart("replicate.change.labels", 6),
  audiences: listPart("replicate.change.labels", 7),
} as const;

export const STAGE_LABEL = {
  signup: listPart("tree.stages", 0),
  presale: listPart("tree.stages", 1),
  on_sale: listPart("tree.stages", 2),
  show_week: listPart("tree.stages", 3),
} as const;
