/**
 * lib/artist-library/words.ts — the artist library's words (AL6).
 *
 * Every row of the AL word list (scratch/artist-library/words-al-2026-11-25.tsv,
 * record docs/design-record/2026-11-25-artist-library.html), exactly. The test
 * compares this map with the copied fixture row by row. Nothing on a screen or in
 * get_artist's answer is written anywhere else.
 */

import { STAGE_LABEL, fillWords, type WordFill } from "../replicate/words.ts";

export const AL_WORDS = {
  "al.badge.shareable": "Shareable",
  "al.badge.client": "This client only · {client}",
  "al.badge.client.public": "This client only",
  "al.why.filmed": "Filmed by {client}",
  "al.why.footage": "Uses {client}’s footage",
  "al.why.branding": "Has {client}’s branding or artwork",
  "al.why.names": "Names {client}’s venue or brand",
  "al.why.filmed.public": "Filmed by the promoter",
  "al.why.footage.public": "Uses the promoter’s footage",
  "al.why.branding.public": "Has the promoter’s branding or artwork",
  "al.why.names.public": "Names the promoter’s venue or brand",
  "al.code.public": "A past show",
  "al.count.shows": "{n} shows",
  "al.count.shows.one": "1 show",
  "al.count.clients": "{n} clients",
  "al.count.clients.one": "1 client",
  "al.count.shareable": "{n} shareable files",
  "al.count.shareable.one": "1 shareable file",
  "al.count.signups": "{n} signups",
  "al.count.signups.one": "1 signup",
  "al.count.purchases": "{n} purchases",
  "al.count.purchases.one": "1 purchase",
  "al.count.ads": "{n} ads",
  "al.count.ads.one": "1 ad",
  "al.cost.signup": "£{x} per signup",
  "al.cost.purchase": "£{x} per purchase",
  "al.page.meta": "{shows} · {clients} · {shareable}",
  "al.page.drive": "Drive folder ↗",
  "al.page.drive.none": "No Drive folder yet: it’s made once {artist} is on an upcoming show.",
  "al.page.shows": "Shows",
  "al.page.col.show": "Show",
  "al.page.col.client": "Client",
  "al.page.col.date": "Date",
  "al.page.col.phase": "Phase",
  "al.page.col.spend": "On {artist}’s ads",
  "al.page.col.results": "Results",
  "al.page.show.next": "Coming up",
  "al.page.show.adsonly": "Not an event in Off/Pixel: found from ad names, {first month}–{last month}",
  "al.page.best": "Best for {stage}",
  "al.page.best.note": "Ranked by cost per result across every client’s shows. An ad under £{min} spent isn’t ranked.",
  "al.page.other": "Other files",
  "al.page.empty": "Nothing filed under {artist} yet.",
  "al.tile.clip": "Clip",
  "al.tile.static": "Static",
  "al.tile.render": "Render",
  "al.tile.source": "{code} · {stage}",
  "al.tile.in_round": "In this round",
  "al.page.captions": "Captions",
  "al.page.captions.approved": "In {artist}’s voice, approved",
  "al.caption.approved": "Approved by {approver}, {date} · logged by {operator}",
  "al.page.captions.copy": "Copy that worked",
  "al.caption.copy": "{stage} · {cost} over {ads} · {code}",
  "al.page.insights": "What we’ve learned",
  "al.insight.built": "Built overnight · last {date}",
  "al.insight.none": "No insights yet. They’re built overnight once one of {artist}’s ads has spent £{min} at a stage.",
  "al.insight.best": "{stage}: “{name}” did best, {cost} over {ads}.",
  "al.insight.audience": "Audience: {audience} did best for {stage}, {cost} on {code}.",
  "al.insight.flop": "Didn’t work: {what} at {stage}, {cost}, {x}× the stage’s usual.",
  "al.insight.unmeasured": "Not measured: {what} on {code}. {ticketing}’s checkout has no pixel, so it shows nothing, not a failure.",
  "al.card.title": "We’ve worked with {artist} on {n} shows",
  "al.card.title.one": "We’ve worked with {artist} on 1 show",
  "al.card.codes": "{codes}",
  "al.card.best": "Best for {stage}",
  "al.card.use": "Use in this round",
  "al.card.added": "Added {n} to this round.",
  "al.card.added.one": "Added 1 to this round.",
  "al.card.held": "{n} more from {client}’s shows stay with {client}.",
  "al.card.held.one": "1 more from {client}’s shows stays with {client}.",
  "al.card.open": "Open {artist}’s page",
  "al.card.old": "The newest of these is from {month year}, over 6 months ago. Check Instagram for anything newer.",
  "al.card.promoter_only": "Everything we hold from those shows was filmed or branded by {client}, so it stays with {client} and can’t go into this round.",
  "al.card.promoter_only.one": "Everything we hold from that show was filmed or branded by {client}, so it stays with {client} and can’t go into this round.",
  "al.card.promoter_only.insights": "What we learned there still applies.",
  "al.card.promoter_only.next": "Start from {artist}’s Instagram or press kit.",
  "al.drive.root": "00 Artist Library",
  "al.drive.artist": "{artist}",
  "al.drive.clips": "Clips",
  "al.drive.statics": "Statics",
  "al.drive.renders": "Renders",
  "al.drive.captions": "Captions",
  "al.drive.insights": "Insights",
  "al.drive.captions.doc": "{artist} · Captions",
  "al.drive.insights.doc": "{artist} · Insights",
  "al.drive.render": "{rank} · {code} · {stage} · {cost} · {file name}",
  "al.drive.captions.shareable": "Shareable",
  "al.drive.captions.client": "Only for {client}",
  "al.drive.captions.copy": "Copy that worked",
  "al.drive.captions.none": "Nothing yet.",
  "al.drive.insights.head": "What we’ve learned about {artist} · built {date}",
  "al.drive.insights.note": "Off/Pixel only. The numbers come from every client’s shows. Never name one client to another.",
  "al.mcp.summary": "{shows} for {clients}.",
  "al.mcp.summary.next": "{shows} for {clients}, and {code} coming up.",
  "al.mcp.drive": "Drive: 00 Artist Library / {artist} · {link}",
  "al.mcp.rights": "Rights for {code} ({client})",
  "al.mcp.rights.none": "No event given, so only shareable material is listed.",
  "al.mcp.listed": "Listed: shareable material, and {client}’s own.",
  "al.mcp.held": "Not listed: {n} more from {other}’s shows, which stay with {other}.",
  "al.mcp.held.one": "Not listed: 1 more from {other}’s shows, which stays with {other}.",
  "al.mcp.names": "Insight numbers can be used. Don’t name {other} or its shows in anything {client} sees.",
  "al.mcp.shows": "Shows",
  "al.mcp.show": "- {code} · {client} · {venue} · {date} · {phase} · £{s} on {artist}’s ads · {results}",
  "al.mcp.show.adsonly": "- {code} · {client} · not an event in Off/Pixel: found from ad names, {first month}–{last month} · £{s} on {artist}’s ads · {results}",
  "al.mcp.best": "Best for {stage}",
  "al.mcp.asset": "{rank}. {name} · {kind} · {code} · {cost} · {badge} · {link}",
  "al.mcp.other": "Other files",
  "al.mcp.other.row": "- {name} · {kind} · {badge} · {link}",
  "al.mcp.captions": "Approved captions",
  "al.mcp.caption": "- “{caption}” · approved by {approver}, {date} · {badge}",
  "al.mcp.copy": "Copy that worked",
  "al.mcp.copy.row": "- {stage} · “{copy}” · {cost} over {ads} · {code}",
  "al.mcp.insights": "Insights (built {date})",
  "al.mcp.insights.none": "Insights: none yet.",
  "al.mcp.fresh": "Newest material: {month year}. Look on Instagram only for what’s missing here.",
  "al.mcp.old": "Newest material: {month year}, over 6 months ago. Check Instagram for anything newer, and for what’s missing here.",
  "al.mcp.unknown": "No artist called “{name}” in Off/Pixel.",
  "al.mcp.closest": "Closest: {names}.",
} as const;

export type AlWordKey = keyof typeof AL_WORDS;

export { STAGE_LABEL };

/** One row, with its `{fill-ins}` replaced. */
export function alWord(key: AlWordKey, fill: WordFill = {}): string {
  return fillWords(AL_WORDS[key], fill);
}

/** The count rows that have a one-form (AL6). */
export type CountKind = "shows" | "clients" | "shareable" | "signups" | "purchases" | "ads";

/** "{n} shows", or the row's own "1 show". */
export function countWords(kind: CountKind, n: number): string {
  if (n === 1) return AL_WORDS[`al.count.${kind}.one` as AlWordKey];
  return alWord(`al.count.${kind}` as AlWordKey, { n: wholeNumber(n) });
}

/** £ with thousands separators, whole pounds (AL6: spend). */
export function wholeNumber(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

/** Spend as the record writes it after "£": "1,917". */
export function spendFigure(gbp: number): string {
  return wholeNumber(gbp);
}

/** Two decimals with thousands separators (AL6: cost per result). */
export function costFigure(gbp: number): string {
  return gbp.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The stages the library ranks, Signup then On sale (AL2). */
export type RankedStage = "signup" | "on_sale";
export const RANKED_STAGES: readonly RankedStage[] = ["signup", "on_sale"];

/** "£2.10 per signup" / "£6.80 per purchase". */
export function costWords(stage: RankedStage, gbp: number): string {
  return alWord(stage === "signup" ? "al.cost.signup" : "al.cost.purchase", { x: costFigure(gbp) });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The campaign creator's day forms (AL6): "Sun 27 Dec 2026", and
 * "Wed 25 Nov" within this year. `iso` is a calendar day (YYYY-MM-DD).
 * A show's date always carries its year, as AL-A and AL-E print it
 * (`withYear`); an approval or build date drops it within this year.
 */
export function dayWords(iso: string, today: string, withYear = false): string {
  const day = iso.slice(0, 10);
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  const base = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return !withYear && day.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${day.slice(0, 4)}`;
}

/** "Oct 2026" (AL6). */
export function monthWords(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** "Aug–Oct 2026", or "Nov 2025–Jan 2026" across a year; one month alone when both are the same. */
export function monthSpan(first: string, last: string): { first: string; last: string } {
  const a = monthWords(first);
  const b = monthWords(last);
  if (first.slice(0, 4) === last.slice(0, 4)) return { first: a.slice(0, 3), last: b };
  return { first: a, last: b };
}
