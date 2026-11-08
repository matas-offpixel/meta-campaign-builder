/**
 * A quote is the artist's own words. Nothing here calls a model.
 * The only cut allowed is a whole sentence, or a whole press-kit line,
 * taken from the source. The stored text is that slice, verbatim.
 */

import { validateCaption, type EventFacts } from "./caption-facts.ts";
import { quoteLinesAt } from "../../src/remotion/caption-style/quote-measure.ts";
import { quoteProfile, type QuoteWeight } from "../../src/remotion/caption-style/quote-profile.ts";

export type QuoteSource = "press_kit" | "post" | "typed";
export type QuoteMode = "caption" | "quote";

export const QUOTE_MAX_LINES = quoteProfile.maxLines;

const FACT_CODES = new Set([
  "scarcity_without_tiers",
  "remaining_unknown",
  "final_not_true",
  "count_not_true",
  "sold_out_not_true",
  "unknown_name",
  "date_not_in_facts",
  "weekday_mismatch",
  "price_not_in_facts",
  "crowd_unproven",
]);

export type CaptionGenerator = {
  angle: "lineup" | "artist_first_person" | "pov" | "scarcity";
  count: 1 | 3 | 5;
  each: boolean;
  stage: "upcoming" | "signup" | "on_sale";
};

export type ModeSwitch = {
  mode: QuoteMode;
  generator: CaptionGenerator;
  snapshot: CaptionGenerator;
};

export function leaveCaption(state: ModeSwitch): ModeSwitch {
  return { mode: "quote", generator: state.generator, snapshot: { ...state.generator } };
}

export function returnToCaption(state: ModeSwitch): ModeSwitch {
  return { mode: "caption", generator: { ...state.snapshot }, snapshot: state.snapshot };
}

/**
 * Subject and possessive for the held sentence. Reads a pronoun already
 * stored on the artist (a string, or profile_jsonb.pronouns). Otherwise
 * "they're" / "their".
 */
export function quotePronoun(value: unknown): { subject: string; possessive: string } {
  const raw = typeof value === "string"
    ? value
    : value && typeof value === "object" && typeof (value as { pronouns?: unknown }).pronouns === "string"
      ? (value as { pronouns: string }).pronouns
      : value && typeof value === "object" && typeof (value as { pronoun?: unknown }).pronoun === "string"
        ? (value as { pronoun: string }).pronoun
        : "";
  const head = raw.toLowerCase().split(/[/\s,]+/)[0] ?? "";
  if (head === "he" || head === "him") return { subject: "he's", possessive: "his" };
  if (head === "she" || head === "her") return { subject: "she's", possessive: "her" };
  return { subject: "they're", possessive: "their" };
}

export function heldQuoteSentence(artistName: string, pronouns?: unknown): string {
  const { subject, possessive } = quotePronoun(pronouns);
  return `These are ${artistName}'s own words, so they run only once ${subject} cleared for ${possessive} own channels.`;
}

/** Rendered lines at the quote's weight. The meter and the stored `lines` are this list. */
export function quoteLines(text: string, weight: QuoteWeight = 700): string[] {
  return quoteLinesAt(text, weight);
}

function sentences(text: string): string[] {
  const found = text.match(/[^.!?]*[.!?]+["']?\s*|[^.!?]+$/g) ?? [];
  return found.map((part) => part).filter((part) => part.trim());
}

/** A contiguous run of the source's sentences, or the whole source. */
export function isSentenceSlice(source: string, words: string): boolean {
  if (words === source) return true;
  if (!source.includes(words)) return false;
  const parts = sentences(source);
  for (let start = 0; start < parts.length; start++) {
    let acc = "";
    for (let end = start; end < parts.length; end++) {
      acc += parts[end];
      if (acc.trim() === words.trim() && acc.trim() === words.trim()) return source.includes(words);
    }
  }
  return false;
}

export function kitLines(fileText: string): string[] {
  return fileText.split(/\r?\n/).map((line) => line.replace(/\s+$/g, "")).filter((line) => line.trim());
}

export function isKitLineSlice(fileText: string, words: string): boolean {
  const lines = kitLines(fileText);
  const picked = words.split("\n");
  if (!picked.length || picked.some((line) => !lines.includes(line))) return false;
  const first = lines.indexOf(picked[0] ?? "");
  return lines.slice(first, first + picked.length).join("\n") === picked.join("\n");
}

export const NO_CAPTION = "no caption on this post";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type ListedPost = {
  permalink: string;
  /** Instagram's caption, byte for byte. Null when the post has none. */
  caption: string | null;
  postedOn: string | null;
  offered: boolean;
  note: string | null;
};

/** The tile chip. The permalink is not part of it. */
export function postListChip(handle: string | null | undefined, postedOn: string | null): string {
  const name = (handle ?? "").replace(/^@/, "").trim();
  const who = name ? `@${name}` : "a post";
  const date = postDateLabel(postedOn);
  return date ? `${who} · ${date}` : who;
}

export function postDateLabel(iso: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!match) return "";
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (!month || !day) return "";
  return `${day} ${month}`;
}

/**
 * The artist's listed posts, newest first. A caption is kept as stored.
 * A post with no caption stays in the list, greyed. This does not fetch Instagram.
 */
export function postsForQuote(
  rows: readonly { permalink?: string | null; caption?: string | null; postedAt?: string | null }[],
): ListedPost[] {
  return rows
    .filter((row) => (row.permalink ?? "").trim())
    .map((row) => {
      const raw = typeof row.caption === "string" ? row.caption : null;
      const offered = raw != null && raw.trim().length > 0;
      return {
        permalink: (row.permalink ?? "").trim(),
        caption: offered ? raw : null,
        postedOn: (row.postedAt ?? "").slice(0, 10) || null,
        offered,
        note: offered ? null : NO_CAPTION,
      };
    })
    .sort((a, b) => (b.postedOn ?? "").localeCompare(a.postedOn ?? "") || a.permalink.localeCompare(b.permalink));
}

export function sourceChip(args: {
  source: QuoteSource;
  handle?: string | null;
  postedLabel?: string | null;
  where?: string | null;
  who?: string | null;
  when?: string | null;
  wide: boolean;
}): string {
  if (args.source === "press_kit") return "press kit";
  if (args.source === "typed") {
    const who = args.who?.trim() || "";
    const when = args.when?.trim() || "";
    const where = args.where?.trim() || "";
    return ["typed", [who, when].filter(Boolean).join(", "), where ? `"${where}"` : ""].filter(Boolean).join(" · ");
  }
  const handle = (args.handle ?? "").replace(/^@/, "").trim();
  const at = handle ? `@${handle}` : "post";
  const date = args.postedLabel?.trim() || "";
  if (!args.wide) return date ? `● ${at} · ${date}` : `● ${at}`;
  return date ? `● ${at} · post, ${date}` : `● ${at} · post`;
}

function emojiOnly(text: string): boolean {
  const bare = text.replace(/\p{Extended_Pictographic}/gu, "").replace(/\s/g, "");
  return bare.length === 0 && /\p{Extended_Pictographic}/u.test(text);
}

export type AcceptQuote =
  | { ok: true; text: string; lines: string[] }
  | { ok: false; sentence: string };

export function acceptQuote(input: {
  words: string;
  source: QuoteSource;
  sourceText?: string | null;
  weight?: QuoteWeight;
}): AcceptQuote {
  const exactPost = input.source === "post" && input.sourceText != null && input.words === input.sourceText;
  const words = exactPost ? input.words : input.words.replace(/^\s+|\s+$/g, "");
  if (!words.trim()) return { ok: false, sentence: "These words are empty." };
  if (emojiOnly(words)) return { ok: false, sentence: "A quote that is only emoji is not used." };
  const lines = quoteLines(words, input.weight === 400 ? 400 : 700);
  if (lines.length > QUOTE_MAX_LINES) {
    return { ok: false, sentence: "This is five lines. Pick a shorter passage. The words are not changed." };
  }
  const sourceText = exactPost ? input.words : (input.sourceText?.replace(/^\s+|\s+$/g, "") ?? "");
  if (!exactPost && input.source !== "typed" && sourceText) {
    const slice = input.source === "press_kit" ? isKitLineSlice(sourceText, words) : isSentenceSlice(sourceText, words);
    if (!slice) return { ok: false, sentence: "The Lab doesn't rewrite a quote." };
  }
  return { ok: true, text: words, lines };
}

export type QuoteCheck = { ok: boolean; sentence: string | null };

/**
 * Scarcity, names, dates and crowd claims use caption-facts as captions
 * do. Overlay rules that quotes are allowed to break (emoji, the 18-character
 * wrap) are not applied: Q7 keeps emoji inline, and Q3 counts lines.
 */
export function validateQuote(text: string, facts: EventFacts): QuoteCheck {
  const check = validateCaption(text, "lineup", [], facts, { version: "quote" });
  const errors = check.errors.filter((error) => FACT_CODES.has(error.code));
  return { ok: errors.length === 0, sentence: errors[0]?.detail ?? null };
}

export type QuoteInsert = {
  mode: "quote";
  style: "quote";
  text: string;
  lines: string[];
  quote_source: QuoteSource;
  quote_source_ref: string | null;
  quote_source_note: string | null;
  quote_weight: QuoteWeight;
  artist_id: string;
  generated_by: "verbatim";
  status: "proposed";
  primary_text: string;
  declared_names: string[];
  size_variant: "default";
};

export function quoteInsert(input: {
  words: string;
  source: QuoteSource;
  sourceText?: string | null;
  sourceRef?: string | null;
  sourceNote?: string | null;
  weight?: QuoteWeight;
  artistId: string;
  primaryText?: string;
}): { ok: true; row: QuoteInsert } | { ok: false; sentence: string } {
  const accepted = acceptQuote({ ...input, weight: input.weight });
  if (!accepted.ok) return accepted;
  if (input.source === "typed" && !input.sourceNote?.trim()) {
    return { ok: false, sentence: "Say where these words were said." };
  }
  const weight = input.weight === 400 ? 400 : 700;
  return {
    ok: true,
    row: {
      mode: "quote",
      style: "quote",
      text: accepted.text,
      lines: accepted.lines,
      quote_source: input.source,
      quote_source_ref: input.source === "typed" ? null : (input.sourceRef?.trim() || null),
      quote_source_note: input.source === "typed" ? (input.sourceNote?.trim() || null) : null,
      quote_weight: weight,
      artist_id: input.artistId,
      generated_by: "verbatim",
      status: "proposed",
      primary_text: input.primaryText?.trim() ?? "",
      declared_names: [],
      size_variant: "default",
    },
  };
}
