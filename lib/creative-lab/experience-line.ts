/**
 * The experience line (overlay templates issue 11, O77): what the night is,
 * not what's on sale. One line per event and ground, kept beside the claims.
 *
 * Typed: whoever runs the event types it, and it is kept verbatim (the
 * display is upper case, the kit's case, O23). The writer's word bans below
 * never apply to a typed line: Matas's "SOUTHAMPTON'S BIGGEST HOUSE PARTY"
 * saves as typed.
 *
 * Suggested: "Suggest" asks the Lab writer for three in the promoter's voice,
 * from the event's facts only (city, venue, the night's name, the sound when
 * the facts record one, the lineup). A suggestion never carries a number, a
 * ranking or superlative, or a sale or scarcity word; one that does is
 * dropped, never edited. The model is injected, so tests never call it.
 *
 * Limits: two lines and 40 characters at most, no emoji. A typed break is
 * kept. A line that can't be saved reads "Too long for two lines — shorten
 * the experience line". The Lab never shortens or re-words it.
 *
 * Approval: ✓'d like a claim; until then a draft is stamped
 * "DRAFT · experience line not approved" (O36).
 */

export const EXPERIENCE = { maxChars: 40, maxLines: 2, suggestions: 3, maxTries: 3 } as const;

export const EXPERIENCE_LINES = {
  tooLong: "Too long for two lines — shorten the experience line",
  needOne: "Add an experience line or a claim",
  stamp: "DRAFT · experience line not approved",
  /** Invented (issue 11 names no words for these). */
  emoji: "No emoji in the experience line",
  empty: "Type an experience line",
  bothStamp: "DRAFT · experience line and claim not approved",
} as const;

const EMOJI = /\p{Extended_Pictographic}/u;

/** The line as stored: verbatim, outer spaces trimmed, a typed break kept (one at most). */
export function storedExperienceLine(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** The lines the line was typed with (one, or two when a break was typed). */
export function typedLines(text: string): string[] {
  return storedExperienceLine(text).split("\n").filter(Boolean);
}

/** Characters counted against the 40: every character the type will draw (a typed break isn't one). */
export const experienceLength = (text: string): number => [...typedLines(text).join(" ")].length;

export type ExperienceCheck = { ok: true; text: string } | { ok: false; line: string };

/** O77's save check for a typed or suggested line, before it is fitted to a size step. */
export function checkExperienceLine(text: string): ExperienceCheck {
  const stored = storedExperienceLine(text);
  if (!stored) return { ok: false, line: EXPERIENCE_LINES.empty };
  if (EMOJI.test(stored)) return { ok: false, line: EXPERIENCE_LINES.emoji };
  if (typedLines(stored).length > EXPERIENCE.maxLines || experienceLength(stored) > EXPERIENCE.maxChars) return { ok: false, line: EXPERIENCE_LINES.tooLong };
  return { ok: true, text: stored };
}

/** The display: the kit's case (upper), the words as typed. */
export const experienceDisplay = (text: string): string => storedExperienceLine(text).toUpperCase();

// ─── The writer's bans (suggestions only) ───────────────────────────────────

/** O77: rankings and superlatives the writer never writes. The record's five, plus their obvious kin (invented). */
export const WRITER_RANKING_WORDS = [
  "biggest", "best", "only", "first", "no. 1", "no 1", "no.1", "number one", "#1",
  "greatest", "largest", "ultimate", "unrivalled", "unrivaled", "unmatched", "unbeatable", "finest", "top", "leading", "legendary", "iconic", "world-class", "most",
] as const;

/** O77: sale and scarcity words the writer never writes: those are the ladder's to claim (invented list). */
export const WRITER_SALE_WORDS = [
  "ticket", "tickets", "sale", "sold", "sell", "selling", "sells", "sellout", "sell-out", "release", "presale", "pre-sale", "early bird", "last", "final", "limited", "few", "remaining", "left", "hurry", "fast", "quick", "now", "today", "tonight only", "don't miss", "dont miss", "book", "buy", "grab", "price", "£", "$", "€", "free", "discount", "offer",
] as const;

const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu");

/** What's wrong with a suggested line under O77's bans (empty when it may be offered). Never applied to a typed line. */
export function suggestionProblems(line: string): string[] {
  const out: string[] = [];
  if (/\p{N}/u.test(line) || /\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\b/i.test(line)) out.push("number");
  for (const w of WRITER_RANKING_WORDS) if (wordRe(w).test(line)) out.push(`ranking: ${w}`);
  if (/\b\w+est\b/i.test(line) && !/\b(fest|festival|guest|guests|west|east|nest|rest|test|chest|zest|quest|crest|forest|honest|interest|request|harvest|manifest|protest|contest|earnest|modest|conquest|tempest|everest|budapest|bucharest|midwest)\b/i.test(line)) out.push("superlative");
  for (const w of WRITER_SALE_WORDS) if ((w.length === 1 ? line.includes(w) : wordRe(w).test(line))) out.push(`sale: ${w}`);
  const check = checkExperienceLine(line);
  if (!check.ok) out.push(check.line);
  return out;
}

// ─── Suggest ────────────────────────────────────────────────────────────────

/** The facts Suggest may use, and nothing else (O77). */
export type ExperienceFacts = {
  city: string | null;
  venue: string | null;
  nightName: string | null;
  /** The sound as the facts record has it; null when it doesn't (today it never does). */
  sound: string | null;
  lineup: readonly string[];
};

/** The promoter's voice: example lines from its own corpus (V-rulings). */
export type PromoterVoice = { handle: string; examples: readonly string[] };

/** The model call, injected: takes the prompt, returns candidate lines. Tests stub it; nothing here calls Anthropic. */
export type ExperienceModel = (prompt: { system: string; user: string }) => Promise<string[]>;

export function suggestPrompt(facts: ExperienceFacts, voice: PromoterVoice): { system: string; user: string } {
  const factLines = [
    facts.nightName ? `Night: ${facts.nightName}` : null,
    facts.city ? `City: ${facts.city}` : null,
    facts.venue ? `Venue: ${facts.venue}` : null,
    facts.sound ? `Sound: ${facts.sound}` : null,
    facts.lineup.length ? `Lineup: ${facts.lineup.join(", ")}` : null,
  ].filter(Boolean);
  const system = [
    `You write one-line experience lines for ${voice.handle}'s event artwork: what the night is, never what's on sale.`,
    "Use only the facts given. Write in the promoter's own voice, as in its examples.",
    `Each line is at most ${EXPERIENCE.maxChars} characters, two lines at most, no emoji.`,
    "Never write a number, a ranking or superlative (biggest, best, No. 1, only, first, or any other), or a ticket, sale or scarcity word.",
    `Return exactly ${EXPERIENCE.suggestions} lines.`,
  ].join("\n");
  const user = [`Facts:\n${factLines.join("\n")}`, voice.examples.length ? `The promoter's voice:\n${voice.examples.map((e) => `- ${e}`).join("\n")}` : null].filter(Boolean).join("\n\n");
  return { system, user };
}

export type Suggestions = { lines: string[]; dropped: { line: string; problems: string[] }[] };

/**
 * O77's "Suggest": up to three lines that pass every ban and the limits, in
 * the order the writer gave them. A line that fails is dropped (never
 * edited); the writer is asked again, at most three times in all.
 */
export async function suggestExperienceLines(facts: ExperienceFacts, voice: PromoterVoice, model: ExperienceModel): Promise<Suggestions> {
  const prompt = suggestPrompt(facts, voice);
  const lines: string[] = [];
  const dropped: Suggestions["dropped"] = [];
  for (let attempt = 0; attempt < EXPERIENCE.maxTries && lines.length < EXPERIENCE.suggestions; attempt += 1) {
    for (const raw of await model(prompt)) {
      // A list marker the model added ("1. ", "- ") is not part of the line; nothing else is ever removed.
      const line = storedExperienceLine(raw.replace(/^\s*(?:[-•*]|\d+[.)])\s+/u, ""));
      if (!line || lines.includes(line)) continue;
      const problems = suggestionProblems(line);
      if (problems.length) dropped.push({ line, problems });
      else if (lines.length < EXPERIENCE.suggestions) lines.push(line);
    }
  }
  return { lines, dropped };
}

// ─── Approval and the stamp ─────────────────────────────────────────────────

export type ApprovalState = "approved" | "held" | null;

/**
 * O77 / O36: the draft stamp for a photo-ground T2. Null when everything on
 * it is approved. The claim's own state is passed through (held claims are
 * stamped as T2's are).
 */
export function photoT2Stamp(experience: ApprovalState, claim: ApprovalState): string | null {
  const expHeld = experience === "held";
  const claimHeld = claim === "held";
  if (expHeld && claimHeld) return EXPERIENCE_LINES.bothStamp;
  if (expHeld) return EXPERIENCE_LINES.stamp;
  if (claimHeld) return "DRAFT · claim not approved";
  return null;
}
