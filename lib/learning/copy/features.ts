/**
 * The shape of a copy line, as labels from fixed lists.
 *
 * copy_performance scores a line's words; no line yet runs in two shows,
 * so nothing is proven. The shape recurs: a question opener, a sign-up
 * call, a final-tickets claim, a lineup list, a short line. Each feature
 * takes one value from its list, never free text, so a value can be
 * counted across shows the way a template key is.
 *
 * Detection reads the raw text (casing, punctuation, emoji, length) and
 * the normalised key normalise.ts produced for the same line (its
 * placeholders say name-first, has a date, has a price, has a list).
 */

import { normaliseCopy, type CopyDictionaries } from "./normalise.ts";

export const COPY_FEATURE_VALUES = {
  opener: ["question", "statement", "imperative", "name_first", "number_first"],
  cta_kind: ["sign_up", "book_now", "tag_a_mate", "link_in_bio", "none"],
  scarcity_kind: ["final_x", "pct_sold", "price_rise", "countdown", "sold_out_rollcall", "none"],
  length_band: ["le_60", "61_120", "121_200", "gt_200"],
  emoji_count_band: ["0", "1_2", "3_plus"],
  has_lineup_list: ["yes", "no"],
  has_date: ["yes", "no"],
  has_price: ["yes", "no"],
  line_count_band: ["1", "2_3", "4_plus"],
} as const;

export type CopyFeature = keyof typeof COPY_FEATURE_VALUES;
export type CopyFeatureValue<F extends CopyFeature = CopyFeature> = (typeof COPY_FEATURE_VALUES)[F][number];
export type CopyFeatures = { [F in CopyFeature]: CopyFeatureValue<F> };

export const COPY_FEATURES = Object.keys(COPY_FEATURE_VALUES) as CopyFeature[];

export function isCopyFeature(value: string): value is CopyFeature {
  return Object.prototype.hasOwnProperty.call(COPY_FEATURE_VALUES, value);
}

/** The scoring key for one feature value: `cta_kind=sign_up`. */
export function featureKey(feature: CopyFeature, value: string): string {
  return `${feature}=${value}`;
}

export function parseFeatureKey(key: string): { feature: CopyFeature; value: string } | null {
  const at = key.indexOf("=");
  if (at <= 0) return null;
  const feature = key.slice(0, at);
  const value = key.slice(at + 1);
  if (!isCopyFeature(feature) || !(COPY_FEATURE_VALUES[feature] as readonly string[]).includes(value)) return null;
  return { feature, value };
}

const EMOJI = /[\p{Extended_Pictographic}]/gu;
/** Space, emoji, quotes and symbols before the first word. A placeholder brace is kept so "{artist} joins" still reads name-first. */
const LEADING_NOISE = /^(?:\s|[\p{Extended_Pictographic}\u{FE0F}\u{200D}]|(?!\{)[\p{P}\p{S}])+/u;

/** First words that give an order: "Join us", "Sign up", "Grab tickets". */
const IMPERATIVES = new Set([
  "join", "sign", "grab", "get", "catch", "secure", "book", "tag", "save", "come", "celebrate", "lock", "watch", "follow", "share", "click", "register", "buy", "don't", "dont", "make", "be", "bring", "expect", "prepare", "mark", "head", "step", "dance", "move", "hurry", "act", "claim", "snap", "swipe", "tap", "hit", "let", "let's", "lets", "keep", "stay", "take", "experience", "discover", "enter", "win", "find", "meet", "listen", "hear", "feel", "add", "set", "pre-register", "preregister", "rsvp", "reserve", "redeem", "unlock", "treat", "gather", "round", "ready",
]);

const NAME_SLOT = /^\{(?:artist|event|promoter|venue|city)\}/i;
const NUMBER_SLOT = /^\{(?:date|price|time|final_tickets|percent_sold|years)\}/i;

function firstSentence(text: string): string {
  const cleaned = text.replace(LEADING_NOISE, "");
  const match = cleaned.match(/^[^.!?\n]*[.!?]?/u);
  return (match?.[0] ?? cleaned).trim();
}

function firstWord(sentence: string): string {
  return (sentence.match(/[\p{L}'’-]+/u)?.[0] ?? "").toLowerCase().replace(/’/g, "'");
}

export function openerOf(text: string, normalisedKey: string): CopyFeatureValue<"opener"> {
  const sentence = firstSentence(text);
  if (sentence.endsWith("?")) return "question";
  const key = normalisedKey.replace(LEADING_NOISE, "");
  if (NAME_SLOT.test(key)) return "name_first";
  if (NUMBER_SLOT.test(key) || /^\d/.test(sentence)) return "number_first";
  if (IMPERATIVES.has(firstWord(sentence))) return "imperative";
  return "statement";
}

const TAG_A_MATE = /\btag (?:a|your|the|some|\d+|two|three|four|five|that|who)\b|\btag a mate\b|\bwho (?:are you|you) bringing\b|\bbring(?:ing)? (?:a|your) (?:mate|mates|friend|friends|crew)\b/i;
const LINK_IN_BIO = /\blink in (?:our |the |my )?bio\b|\bbio link\b|\blink in bio\b|\bvia (?:the |our )?bio\b/i;
const SIGN_UP = /\bsign[- ]?ups?\b|\bregister\b|\bpre-?register\b|\b(?:presale|pre-sale|priority|first|early|exclusive) access\b|\bsign up\b|\bjoin the (?:list|waitlist|waiting list)\b|\bregistration\b/i;
const BOOK_NOW =
  /\btickets? (?:on sale|available|live|now live|out now|here|below|on general sale)\b|\bon sale now\b|\bbook now\b|\bget (?:your |yours |a )?tickets?\b|\bgrab (?:your |yours |a )?tickets?\b|\bbuy (?:your |a )?tickets?\b|\bsecure (?:your|a|yours)\b|\bfinal tickets\b|\bremaining tickets\b|\blast tickets\b|\btickets? (?:via|at|from|through)\b|\bbook (?:your|a|yours)\b|\blink below\b|\bgeneral sale\b|\btickets? (?:go|went|are) (?:live|on sale)\b|\btickets? selling\b|\bcop (?:a|your) tickets?\b/i;

export function ctaKindOf(text: string): CopyFeatureValue<"cta_kind"> {
  if (TAG_A_MATE.test(text)) return "tag_a_mate";
  if (LINK_IN_BIO.test(text)) return "link_in_bio";
  if (SIGN_UP.test(text)) return "sign_up";
  if (BOOK_NOW.test(text)) return "book_now";
  return "none";
}

const SOLD_OUT = /\bsold[- ]out\b/gi;
const ROLLCALL = /\b\d+ (?:shows? |nights? |dates? |events? )?sold[- ]out\b|\bsold[- ]out (?:already|shows|nights|twice|three times|again)\b|\b(?:last|first|previous) \d+ (?:shows|nights|dates|events) sold[- ]out\b|\bsold[- ]out (?:show|night|edition)s\b/i;
const PCT_SOLD = /\d[\d.]*\s?% sold\b/i;
const FINAL_X =
  /\b(?:final|last) \d[\d,]* (?:tickets|places|spots)\b|\bfinal (?:few|release|tickets|chance|call|batch)\b|\blast (?:few|chance|tickets|remaining|call|batch|release)\b|\b(?:tickets?|spots|places) (?:running low|moving fast|selling fast|almost gone|nearly gone|about to sell out|are going fast|going fast|flying)\b|\balmost sold[- ]out\b|\bnearly sold[- ]out\b|\bselling (?:out )?fast\b|\blimited (?:tickets|places|spots|availability)\b|\bremaining tickets\b|\b(?:few|handful of) (?:tickets|places|spots) (?:left|remain)\b|\btickets remain\b|\bwill sell out\b|\bexpected to sell out\b|\bset to sell out\b|\bless than \d+ (?:tickets|left)\b|\bunder \d+ (?:tickets|left)\b/i;
const PRICE_RISE =
  /\bprice (?:rise|increase|goes up|going up|move|moves|jump|rises|increases)\b|\bprices (?:rise|go up|going up|increase)\b|\bbefore (?:the )?price\b|\bearly bird (?:ends|closes|tickets|price|prices)\b|\bnext (?:release|tier|price)\b|\btier \d\b|\b(?:second|third|fourth|final) release\b|\bcheapest tickets\b|\bgo(?:es)? up (?:at|on|tomorrow|tonight|at midnight|this)\b|\bprice(?:s)? (?:go|going) up\b|\b(?:release|tier) (?:sold|sells) out\b|\bbefore prices\b/i;
const COUNTDOWN =
  /\b(?:this|next) (?:friday|saturday|sunday|monday|tuesday|wednesday|thursday|weekend|week)\b|\btonight\b|\btomorrow\b|\b\d+ (?:days?|hours?|weeks?|sleeps?) (?:to go|left|away|until|till|out)\b|\bends? (?:tonight|tomorrow|at midnight|soon|today)\b|\bclos(?:es|ing) (?:tonight|tomorrow|soon|today|at midnight)\b|\bhours left\b|\bcountdown\b|\bdays? away\b|\bone week\b|\blast (?:day|night|hours|24 hours|48 hours)\b|\btoday only\b|\b(?:this|the) weekend\b|\bmidnight\b/i;

export function scarcityKindOf(text: string): CopyFeatureValue<"scarcity_kind"> {
  const soldOut = text.match(SOLD_OUT)?.length ?? 0;
  if (soldOut >= 2 || ROLLCALL.test(text)) return "sold_out_rollcall";
  if (PCT_SOLD.test(text)) return "pct_sold";
  if (FINAL_X.test(text)) return "final_x";
  if (PRICE_RISE.test(text)) return "price_rise";
  if (COUNTDOWN.test(text)) return "countdown";
  return "none";
}

export function lengthBandOf(text: string): CopyFeatureValue<"length_band"> {
  const length = text.trim().length;
  if (length <= 60) return "le_60";
  if (length <= 120) return "61_120";
  if (length <= 200) return "121_200";
  return "gt_200";
}

export function emojiCount(text: string): number {
  return text.match(EMOJI)?.length ?? 0;
}

export function emojiCountBandOf(text: string): CopyFeatureValue<"emoji_count_band"> {
  const count = emojiCount(text);
  if (count === 0) return "0";
  if (count <= 2) return "1_2";
  return "3_plus";
}

export function lineCountBandOf(text: string): CopyFeatureValue<"line_count_band"> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  if (lines <= 1) return "1";
  if (lines <= 3) return "2_3";
  return "4_plus";
}

const NAME_ITEM = "[\\p{Lu}][\\p{L}\\p{N}'’.&-]*(?: [\\p{Lu}][\\p{L}\\p{N}'’.&-]*)*";
/** Three or more comma-separated capitalised items: "Dan Shake, Horse Meat Disco, MiNNA, Theon Bower and more". */
const CAPITALISED_LIST = new RegExp(`${NAME_ITEM}(?:,\\s*${NAME_ITEM}){2,}`, "u");

export function hasLineupList(text: string, normalisedKey: string): boolean {
  const slots = normalisedKey.match(/\{artist\}/g)?.length ?? 0;
  if (slots >= 2) return true;
  return CAPITALISED_LIST.test(text);
}

/** Features of one line. `normalisedKey` is normalise.ts's key for the same text (placeholders kept). */
export function copyFeatures(text: string, normalisedKey: string): CopyFeatures {
  return {
    opener: openerOf(text, normalisedKey),
    cta_kind: ctaKindOf(text),
    scarcity_kind: scarcityKindOf(text),
    length_band: lengthBandOf(text),
    emoji_count_band: emojiCountBandOf(text),
    has_lineup_list: hasLineupList(text, normalisedKey) ? "yes" : "no",
    has_date: /\{date\}/.test(normalisedKey) ? "yes" : "no",
    has_price: /\{price\}/.test(normalisedKey) ? "yes" : "no",
    line_count_band: lineCountBandOf(text),
  };
}

/** Features of a raw line against an event's dictionaries. Null for an empty line. */
export function featuresOf(text: string, dict: CopyDictionaries): CopyFeatures | null {
  const normalised = normaliseCopy(text, dict);
  if (!normalised) return null;
  return copyFeatures(text, normalised.key);
}

export function featureKeysOf(features: CopyFeatures): string[] {
  return COPY_FEATURES.map((feature) => featureKey(feature, features[feature]));
}
