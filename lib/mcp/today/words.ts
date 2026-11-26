/**
 * lib/mcp/today/words.ts — Today's words for Claude's Meta changes.
 *
 * Every string here is a row of design's list
 * (scratch/mcp/words-mcp-today-2026-11-25.tsv; the copy in
 * lib/mcp/__tests__/fixtures), word for word: FC1's log rows and Undo
 * (2026-11-25-mcp-full-control), Step 0's actions and change lines, and the
 * 32 rows record 2026-11-26-mcp-m3b-today (MB1–MB4) adds.
 * lib/mcp/__tests__/today-words.test.ts pins every key against the list.
 *
 * The only composed strings are TODAY_COMPOSED's, each made of ruled rows
 * (listed for design in the PR body): an Undo's refusal reason is the
 * logged refusal's own words after "Refused · " or "Failed · ".
 *
 * Relative imports only (node:test).
 */

export const TODAY_META_WORDS = {
  // FC1 / TD: the section, the row, the outcome.
  "today.mcp.title": "Claude’s changes",
  "today.mcp.count.changes": "{n} today",
  "today.mcp.count.changes.one": "1 today",
  "today.mcp.count.scheduled": "{n} scheduled",
  "today.mcp.count.scheduled.one": "1 scheduled",
  "today.mcp.row.title": "{action} · {code}",
  "today.mcp.row.approved_in_claude": "Approved in Claude · {date, time}",
  "today.mcp.row.asked": "What Claude asked",
  "today.mcp.row.asked.q": "Asked: “{asked}”",
  "today.mcp.row.asked.a": "Answer: “{answer}”",
  "today.mcp.row.done": "Done · {result}",
  "today.mcp.row.failed": "Failed · {result}",
  "today.mcp.row.failed.none": "Failed · Meta didn’t take it, so nothing changed",
  // The show's spend ceiling (ruled 27 Nov with #1397): its line and its no-ceiling line.
  "today.mcp.ceiling": "{code}: £{x} of £{c} committed",
  "today.mcp.ceiling.none": "{code}: no spend ceiling, so Claude can’t start or raise spend",
  "today.mcp.row.refused": "Refused · it would take {code} to £{x} committed, over its £{c} ceiling",
  "today.mcp.row.refused.none": "Refused · {code} has no spend ceiling, and this starts or raises spend",
  "today.mcp.row.refused.no_approval": "Refused · no approval given",
  "today.mcp.row.refused.switch": "Refused · this is switched off in Off/Pixel, so nothing was sent",
  "today.mcp.row.refused.checks": "Refused · {n} launch checks to fix",
  "today.mcp.row.refused.checks.one": "Refused · 1 launch check to fix",
  "today.mcp.result": "{n} {things} changed · {ids}",
  "today.mcp.result.one": "1 {thing} changed · {id}",
  "today.mcp.result.partial": "{n} of {m} {things} changed · {ids}",
  "today.mcp.result.created": "{n} {things} created · {ids}",
  "today.mcp.result.created.one": "1 {thing} created · {id}",
  "today.mcp.result.added": "{n} {things} added · {ids}",
  "today.mcp.result.added.one": "1 {thing} added · {id}",
  "today.mcp.result.launched": "{n} {things} launched · {ids}",
  "today.mcp.result.launched.one": "1 {thing} launched · {id}",
  "today.mcp.thing.campaign": "campaign",
  "today.mcp.thing.campaign.many": "campaigns",
  "today.mcp.thing.adset": "ad set",
  "today.mcp.thing.adset.many": "ad sets",
  "today.mcp.thing.ad": "ad",
  "today.mcp.thing.ad.many": "ads",
  "today.mcp.thing.test": "test",
  "today.mcp.thing.test.many": "tests",
  "today.mcp.count.ads": "{n} ads",
  "today.mcp.count.ads.one": "1 ad",
  "today.mcp.count.adsets": "{n} ad sets",
  "today.mcp.count.adsets.one": "1 ad set",
  // Step 0 and MB1: titles.
  "today.mcp.action.launch_draft": "Launch draft",
  "today.mcp.action.add_creatives": "Add creatives",
  "today.mcp.action.add_audiences": "Add audiences",
  "today.mcp.action.pause_ad": "Pause ad",
  "today.mcp.action.pause_adset": "Pause ad set",
  "today.mcp.action.pause_campaign": "Pause campaign",
  "today.mcp.action.resume_ad": "Resume ad",
  "today.mcp.action.resume_adset": "Resume ad set",
  "today.mcp.action.resume_campaign": "Resume campaign",
  "today.mcp.action.move_budget": "Move budget",
  "today.mcp.action.set_budget": "Change budget",
  "today.mcp.action.rename": "Rename",
  "today.mcp.action.split_test": "Start an A/B test",
  // Step 0 and MB1: change lines.
  "today.mcp.change.launch.paused": "{draft}: draft → paused",
  "today.mcp.change.launch.live": "{draft}: draft → live",
  "today.mcp.change.add_creatives": "{stage}: {ads} into {adsets}",
  "today.mcp.change.add_audiences": "{stage}: {audiences} into {adsets}",
  "today.mcp.change.pause": "{name}: live → paused",
  "today.mcp.change.resume": "{name}: paused → live",
  "today.mcp.change.move_budget": "£{x} a day: {from} → {to}",
  "today.mcp.change.budget": "{name}: £{x} → £{y} {per}",
  "today.mcp.change.budget.to": "{name}: to £{y} {per}",
  "today.mcp.per.day": "a day",
  "today.mcp.per.lifetime": "lifetime",
  "today.mcp.change.rename": "“{before}” → “{after}”",
  "today.mcp.change.split_test": "{a} vs {b} · 50/50 · {start} – {end}",
  // FC1 and MB1: Undo.
  "today.mcp.undo": "Undo",
  "today.mcp.undo.resume": "Undo resumes it.",
  "today.mcp.undo.pause": "Undo pauses it.",
  "today.mcp.undo.budget": "Undo puts it back to £{x} a day.",
  "today.mcp.undo.budget.lifetime": "Undo puts it back to £{x} lifetime.",
  "today.mcp.undo.move": "Undo moves £{x} a day back to {from}.",
  "today.mcp.undo.rename": "Undo puts the old name back.",
  "today.mcp.undo.delete": "Undo deletes the {n} paused {things} Claude made.",
  "today.mcp.undo.delete.one": "Undo deletes the paused {thing} Claude made.",
  "today.mcp.undo.confirm": "Delete the {n} paused {things} Claude made? This can’t be undone.",
  "today.mcp.undo.confirm.one": "Delete the paused {thing} Claude made? This can’t be undone.",
  "today.mcp.undo.confirm.button": "Delete",
  "today.mcp.undo.cancel": "Cancel",
  "today.mcp.undo.done": "Undone by {name} · {date, time}",
  "today.mcp.undo.off": "Changed since, so Undo is off.",
  "today.mcp.undo.live": "It’s live, so Undo can’t delete it. Pause it in the campaign tree.",
  "today.mcp.undo.refused": "Undo refused · {reason}",
  "today.mcp.undo.test": "A test can’t be undone here. End it in Ads Manager.",
  // MB2: scheduled budget changes.
  "today.mcp.row.scheduled": "Scheduled for {date, time}",
  "today.mcp.row.scheduled.note": "It runs only if nothing has changed by then.",
  "today.mcp.cancel": "Cancel",
  "today.mcp.row.cancelled": "Cancelled by {name} · {date, time}",
  "today.mcp.row.cancelled.claude": "Cancelled in Claude · {date, time}",
  "today.mcp.row.ran": "Ran as scheduled · {date, time}",
  "today.mcp.row.skipped": "Skipped · {reason}",
  "today.mcp.skip.budget_changed": "the budget changed after it was scheduled",
  "today.mcp.skip.paused": "it was paused after it was scheduled",
  "today.mcp.skip.ended": "it ended or was deleted after it was scheduled",
  "today.mcp.skip.ceiling": "by then it would have taken the show over its spend ceiling, or the show had no ceiling",
  "today.mcp.skip.switch": "budget changes were switched off in Off/Pixel",
  "today.mcp.skip.unread": "Meta couldn’t be read when it was due",
} as const;

export type TodayMetaKey = keyof typeof TODAY_META_WORDS;

/** One row, its placeholders filled ("{date, time}" included). */
export function tw(key: TodayMetaKey, values: Record<string, string | number> = {}): string {
  return TODAY_META_WORDS[key].replace(/\{([a-z_, ]+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

export type Thing = "campaign" | "adset" | "ad" | "test";

/** {thing} and {things}: the today.mcp.thing.* rows. */
export function things(t: Thing): [string, string] {
  if (t === "campaign") return [tw("today.mcp.thing.campaign"), tw("today.mcp.thing.campaign.many")];
  if (t === "adset") return [tw("today.mcp.thing.adset"), tw("today.mcp.thing.adset.many")];
  if (t === "ad") return [tw("today.mcp.thing.ad"), tw("today.mcp.thing.ad.many")];
  return [tw("today.mcp.thing.test"), tw("today.mcp.thing.test.many")];
}

type ResultVerb = "changed" | "created" | "added" | "launched";
const RESULT_KEYS: Record<ResultVerb, [TodayMetaKey, TodayMetaKey]> = {
  changed: ["today.mcp.result.one", "today.mcp.result"],
  created: ["today.mcp.result.created.one", "today.mcp.result.created"],
  added: ["today.mcp.result.added.one", "today.mcp.result.added"],
  launched: ["today.mcp.result.launched.one", "today.mcp.result.launched"],
};

/** TD's counts-only result: "1 ad set changed · {id}", "2 ad sets changed · a, b" (never "1 ad sets"). */
export function result(verb: ResultVerb, t: Thing, ids: readonly string[]): string {
  const [one, many] = RESULT_KEYS[verb];
  const [thing, plural] = things(t);
  return ids.length === 1 ? tw(one, { thing, id: ids[0]! }) : tw(many, { n: ids.length, things: plural, ids: ids.join(", ") });
}

/** "{n} today" / "1 today". */
export const countToday = (n: number) => (n === 1 ? tw("today.mcp.count.changes.one") : tw("today.mcp.count.changes", { n }));
/** "{n} scheduled" / "1 scheduled". */
export const countScheduled = (n: number) => (n === 1 ? tw("today.mcp.count.scheduled.one") : tw("today.mcp.count.scheduled", { n }));
/** "{n} ads" / "1 ad". */
export const countAds = (n: number) => (n === 1 ? tw("today.mcp.count.ads.one") : tw("today.mcp.count.ads", { n }));
/** "{n} ad sets" / "1 ad set". */
export const countAdSets = (n: number) => (n === 1 ? tw("today.mcp.count.adsets.one") : tw("today.mcp.count.adsets", { n }));

export const money = (n: number) => n.toFixed(2);

/**
 * PENDING DESIGN, composed from ruled rows: an Undo's refusal reason is the
 * logged refusal's own short reason ("Undo refused · {reason}", e.g.
 * "Undo refused · P26-BDAY has no spend ceiling, and this starts or raises spend").
 */
export const TODAY_COMPOSED = [
  { key: "today.mcp.undo.refused · {reason}", where: "Today, Undo refused: {reason} is the refusal row after “Refused · ” or “Failed · ”", candidate: "Undo refused · {code} has no spend ceiling, and this starts or raises spend" },
] as const;

/** {reason} for "Undo refused · {reason}": a refused or failed row's words after its "Refused · " / "Failed · ". */
export function reasonOf(row: string): string {
  return row.replace(/^(Refused|Failed) · /, "");
}
