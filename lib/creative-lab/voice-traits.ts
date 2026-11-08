/**
 * Voice traits. Pure: captions in, the sheet's counts out. No I/O.
 *
 * A sign-off is the same last line on 3 or more posts. Name-only lines and
 * "& more" are the lineup, not sentences. Hashtags are stripped before the
 * sentence count so a trailing tag is not a one-word sentence.
 */

export const VOICE_SAMPLE_CAP = 30;
export const VOICE_FLOOR = 8;

export type VoiceSample = {
  caption: string;
  postedAt?: string | null;
  likes?: number | null;
  comments?: number | null;
  permalink?: string | null;
};

export type VoiceTraits = {
  sampleN: number;
  length: { medianChars: number; medianSentences: number; count: number; of: number };
  sentences: { medianWords: number; min: number; max: number; count: number; of: number };
  caseHabit: { habit: "sentence" | "lower" | "caps"; count: number; of: number };
  emoji: { set: string[]; perPost: number; position: "lead" | "inline" | "trail"; count: number; of: number };
  signOffs: { line: string; count: number }[];
  venue: { form: string; count: number; of: number }[];
  lineup: { separator: "own lines" | "slash" | "b2b" | "comma" | "none"; ampMore: boolean; slash: boolean; count: number; of: number };
  punctuation: { exclamation: number; question: number; emDash: number; ellipsis: number; of: number };
  hashtags: { posts: number; median: number; position: "trailing" | "inline" | "none"; of: number };
  mentions: { posts: number; of: number };
  lines: { median: number; of: number };
};

export type TraitRow = {
  label: string;
  value: string;
  evidence: string;
  /** Bar width, 0–100. */
  bar: number;
  off?: boolean;
};

const EMOJI_G = /\p{Extended_Pictographic}/gu;
const HASHTAG = /#[\p{L}\p{N}_]+/u;
const HASHTAG_G = /#[\p{L}\p{N}_]+/gu;
const MENTION = /(?<![\p{L}\p{N}_])@[\p{L}\p{N}_.]+/u;
const NAME_LINE = /^[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)+$/u;

export function traitsReady(sampleN: number): boolean {
  return sampleN >= VOICE_FLOOR;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function linesOf(caption: string): string[] {
  return caption.split(/\n/).map((line) => line.trim()).filter(Boolean);
}

function isLineupLine(line: string): boolean {
  return line === "& more" || NAME_LINE.test(line);
}

function wordsOf(sentence: string): string[] {
  return sentence
    .replace(EMOJI_G, " ")
    .replace(HASHTAG_G, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}@]+|[^\p{L}\p{N}@]+$/gu, ""))
    .filter(Boolean);
}

function sentencesOf(caption: string, signOff: string | null): string[] {
  const kept = linesOf(caption).filter((line) => line !== signOff && !isLineupLine(line) && !HASHTAG.test(line.trim()));
  return kept
    .join(" ")
    .replace(HASHTAG_G, " ")
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function caseOf(caption: string): "sentence" | "lower" | "caps" {
  const letters = caption.replace(/[^\p{L}]/gu, "");
  if (!letters) return "sentence";
  if (letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return "caps";
  if (letters === letters.toLowerCase()) return "lower";
  return "sentence";
}

function emojiPosition(caption: string): "lead" | "inline" | "trail" | null {
  const marks: ("lead" | "inline" | "trail")[] = [];
  for (const line of caption.split(/\n/)) {
    const found = [...line.matchAll(EMOJI_G)];
    if (!found.length) continue;
    for (const hit of found) {
      const at = hit.index ?? 0;
      const before = line.slice(0, at).trim();
      const after = line.slice(at + hit[0].length).trim();
      if (!before) marks.push("lead");
      else if (!after) marks.push("trail");
      else marks.push("inline");
    }
  }
  if (!marks.length) return null;
  const tally = { lead: 0, inline: 0, trail: 0 };
  for (const mark of marks) tally[mark] += 1;
  return (Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "trail") as "lead" | "inline" | "trail";
}

function hashtagPosition(caption: string): "trailing" | "inline" | null {
  const tags = caption.match(HASHTAG_G);
  if (!tags?.length) return null;
  const stripped = caption.replace(/(?:\s*#[\p{L}\p{N}_]+)+\s*$/u, "");
  return HASHTAG.test(stripped) ? "inline" : "trailing";
}

export function signOffLines(samples: readonly { caption: string }[]): { line: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const last = linesOf(sample.caption).at(-1);
    if (!last) continue;
    counts.set(last, (counts.get(last) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([line, count]) => ({ line, count }))
    .sort((a, b) => b.count - a.count || a.line.localeCompare(b.line));
}

function venueHits(caption: string, names: readonly string[]): string | null {
  const ordered = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  const lower = caption.toLowerCase();
  for (const name of ordered) {
    const needle = name.toLowerCase();
    const at = lower.indexOf(needle);
    if (at < 0) continue;
    const before = at === 0 || !/[\p{L}\p{N}]/u.test(lower[at - 1] ?? "");
    const after = at + needle.length >= lower.length || !/[\p{L}\p{N}]/u.test(lower[at + needle.length] ?? "");
    if (before && after) return name;
  }
  return null;
}

function lineupOf(caption: string): { hit: boolean; slash: boolean; ampMore: boolean; separator: VoiceTraits["lineup"]["separator"] } {
  const lines = linesOf(caption);
  const names = lines.filter((line) => NAME_LINE.test(line));
  const slash = lines.some((line) => line.includes("/"));
  const b2b = /\bb2b\b/i.test(caption);
  const ampMore = lines.some((line) => line === "& more") || /\s&\s+more\b/i.test(caption);
  const comma = lines.some((line) => /,\s*[A-Z]/.test(line) && !slash);
  let separator: VoiceTraits["lineup"]["separator"] = "none";
  if (names.length >= 2) separator = "own lines";
  else if (slash) separator = "slash";
  else if (b2b) separator = "b2b";
  else if (comma) separator = "comma";
  return { hit: names.length >= 2 || slash || b2b, slash, ampMore, separator };
}

const EMOJI_ORDER = ["🖤", "🔥", "👀", "✨", "🎟️"];

function emojiSet(captions: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const caption of captions) {
    for (const hit of caption.match(EMOJI_G) ?? []) counts.set(hit, (counts.get(hit) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || EMOJI_ORDER.indexOf(a[0]) - EMOJI_ORDER.indexOf(b[0]) || a[0].localeCompare(b[0]))
    .map(([mark]) => mark);
}

export function extractTraits(samples: readonly VoiceSample[], venueNames: readonly string[] = []): VoiceTraits {
  const captions = samples.map((sample) => sample.caption).filter((caption) => caption.trim().length > 0);
  const of = captions.length;
  const signOffs = signOffLines(captions.map((caption) => ({ caption })));
  const signOff = signOffs[0]?.line ?? null;
  const sentenceCounts: number[] = [];
  const wordCounts: number[] = [];
  const charCounts: number[] = [];
  const lineCounts: number[] = [];
  const cases = { sentence: 0, lower: 0, caps: 0 };
  let emojiPosts = 0;
  const emojiPerPost: number[] = [];
  const positions = { lead: 0, inline: 0, trail: 0 };
  let hashtagPosts = 0;
  const hashtagCounts: number[] = [];
  const hashtagPositions = { trailing: 0, inline: 0 };
  let mentionPosts = 0;
  let exclamation = 0;
  let question = 0;
  let emDash = 0;
  let ellipsis = 0;
  const venues = new Map<string, number>(venueNames.filter(Boolean).map((name) => [name, 0]));
  let lineupPosts = 0;
  let slash = false;
  let ampMore = false;
  const separators = new Map<VoiceTraits["lineup"]["separator"], number>();

  for (const caption of captions) {
    charCounts.push([...caption].length);
    lineCounts.push(linesOf(caption).length);
    const sentences = sentencesOf(caption, signOff);
    sentenceCounts.push(sentences.length);
    for (const sentence of sentences) {
      const words = wordsOf(sentence);
      if (words.length) wordCounts.push(words.length);
    }
    cases[caseOf(caption)] += 1;
    const emoji = caption.match(EMOJI_G) ?? [];
    if (emoji.length) {
      emojiPosts += 1;
      emojiPerPost.push(emoji.length);
      const position = emojiPosition(caption);
      if (position) positions[position] += 1;
    }
    const tags = caption.match(HASHTAG_G) ?? [];
    if (tags.length) {
      hashtagPosts += 1;
      hashtagCounts.push(tags.length);
      const position = hashtagPosition(caption);
      if (position) hashtagPositions[position] += 1;
    }
    if (MENTION.test(caption)) mentionPosts += 1;
    if (caption.includes("!")) exclamation += 1;
    if (caption.includes("?")) question += 1;
    if (caption.includes("—")) emDash += 1;
    if (caption.includes("…") || caption.includes("...")) ellipsis += 1;
    const venue = venueHits(caption, venueNames);
    if (venue) venues.set(venue, (venues.get(venue) ?? 0) + 1);
    const lineup = lineupOf(caption);
    if (lineup.hit) {
      lineupPosts += 1;
      separators.set(lineup.separator, (separators.get(lineup.separator) ?? 0) + 1);
    }
    if (lineup.slash) slash = true;
    if (lineup.ampMore) ampMore = true;
  }

  const habit = (Object.entries(cases).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "sentence") as VoiceTraits["caseHabit"]["habit"];
  const position = (Object.entries(positions).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "trail") as VoiceTraits["emoji"]["position"];
  const tagPosition = hashtagPosts === 0
    ? "none" as const
    : hashtagPositions.inline > 0
      ? "inline" as const
      : "trailing" as const;
  const separator = ([...separators.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none");
  const perPost = emojiPerPost.length ? median(emojiPerPost) : 0;

  return {
    sampleN: of,
    length: { medianChars: Math.round(median(charCounts)), medianSentences: median(sentenceCounts), count: of, of },
    sentences: {
      medianWords: Math.round(median(wordCounts)),
      min: wordCounts.length ? Math.min(...wordCounts) : 0,
      max: wordCounts.length ? Math.max(...wordCounts) : 0,
      count: of,
      of,
    },
    caseHabit: { habit, count: cases[habit], of },
    emoji: { set: emojiSet(captions), perPost, position: emojiPosts ? position : "trail", count: emojiPosts, of },
    signOffs,
    venue: [...venues.entries()]
      .map(([form, count]) => ({ form, count, of }))
      .sort((a, b) => b.count - a.count || a.form.localeCompare(b.form)),
    lineup: { separator, ampMore, slash, count: lineupPosts, of },
    punctuation: { exclamation, question, emDash, ellipsis, of },
    hashtags: { posts: hashtagPosts, median: hashtagCounts.length ? median(hashtagCounts) : 0, position: tagPosition, of },
    mentions: { posts: mentionPosts, of },
    lines: { median: median(lineCounts), of },
  };
}

function aboutChars(medianChars: number): string {
  const rounded = Math.round(medianChars / 10) * 10;
  return String(rounded);
}

function sentenceBand(medianSentences: number): string {
  if (medianSentences >= 2 && medianSentences <= 3) return "2–3 sentences";
  const rounded = Math.round(medianSentences);
  return rounded === 1 ? "1 sentence" : `${rounded} sentences`;
}

export function traitRows(traits: VoiceTraits, width: "wide" | "narrow" = "wide"): TraitRow[] {
  const of = traits.sampleN;
  const bar = (count: number) => (of ? Math.round((count / of) * 100) : 0);
  const signOff = traits.signOffs[0];
  const venue = traits.venue.find((row) => row.count > 0) ?? traits.venue[0];
  const absentVenue = traits.venue.find((row) => row.form !== venue?.form && row.count === 0);
  const venueNever = absentVenue ? ` · never "${absentVenue.form}"` : "";
  const lengthWide = `${sentenceBand(traits.length.medianSentences)} · about ${aboutChars(traits.length.medianChars)} characters`;
  const lengthNarrow = `${sentenceBand(traits.length.medianSentences)} · ~${aboutChars(traits.length.medianChars)} chars`;
  const emojiWhere = traits.emoji.position === "trail"
    ? "at the end of a line"
    : traits.emoji.position === "lead"
      ? "at the start of a line"
      : "mid line";
  const one = traits.emoji.perPost === 1 ? "one per post, " : "";
  const lineupValue = traits.lineup.separator === "own lines"
    ? `names on their own lines · ${traits.lineup.slash ? 'with "/"' : 'no "/"'}${traits.lineup.ampMore ? ' · "& more" when long' : ""}`
    : traits.lineup.separator === "none"
      ? "no lineup habit"
      : traits.lineup.separator;
  const rows: TraitRow[] = [
    {
      label: "Length",
      value: width === "narrow" ? lengthNarrow : `${lengthWide}`,
      evidence: "median",
      bar: 70,
    },
    {
      label: "Sentences",
      value: width === "narrow"
        ? `short · ${traits.sentences.medianWords} words`
        : `short · ${traits.sentences.medianWords} words (${traits.sentences.min}–${traits.sentences.max})`,
      evidence: "median",
      bar: 55,
    },
  ];
  if (width === "wide") {
    rows.push({
      label: "Case",
      value: traits.caseHabit.habit === "sentence"
        ? "sentence case · never all caps"
        : traits.caseHabit.habit === "caps"
          ? "all caps"
          : "lower case",
      evidence: `${traits.caseHabit.count} of ${of}`,
      bar: bar(traits.caseHabit.count),
    });
  }
  rows.push({
    label: "Emoji",
    value: width === "narrow"
      ? `${traits.emoji.set.slice(0, 3).join(" ")} · end of line`
      : `${traits.emoji.set.slice(0, 3).join(" ")} · ${one}${emojiWhere}`,
    evidence: `${traits.emoji.count} of ${of}`,
    bar: bar(traits.emoji.count),
  });
  rows.push({
    label: "Sign-off",
    value: signOff ? `"${signOff.line}"` : "None",
    evidence: signOff ? `${signOff.count} of ${of}` : `0 of ${of}`,
    bar: signOff ? bar(signOff.count) : 0,
  });
  rows.push({
    label: "Venue",
    value: venue ? `"${venue.form}"${width === "narrow" ? "" : venueNever}` : "No venue name",
    evidence: venue ? `${venue.count} of ${of}` : `0 of ${of}`,
    bar: venue ? bar(venue.count) : 0,
  });
  rows.push({
    label: "Lineup",
    value: width === "narrow" ? (traits.lineup.separator === "own lines" ? 'own lines · no "/"' : lineupValue) : lineupValue,
    evidence: `${traits.lineup.count} of ${of}`,
    bar: bar(traits.lineup.count),
  });
  if (width === "wide") {
    rows.push({
      label: "Punctuation",
      value: traits.punctuation.emDash === 0
        ? "full stops, few exclamations · no em dash"
        : `exclamation in ${traits.punctuation.exclamation} · em dash in ${traits.punctuation.emDash}`,
      evidence: `${traits.punctuation.exclamation} of ${of} !`,
      bar: bar(traits.punctuation.exclamation),
    });
  }
  rows.push({
    label: "Hashtags",
    value: width === "narrow"
      ? `${traits.hashtags.position === "trailing" ? "trailing" : traits.hashtags.position}`
      : `${traits.hashtags.posts} of ${of} · ${traits.hashtags.position === "trailing" ? "trailing block" : traits.hashtags.position}`,
    evidence: `${traits.hashtags.posts} of ${of}`,
    bar: bar(traits.hashtags.posts),
    off: true,
  });
  if (width === "wide") {
    rows.push({
      label: "Mentions",
      value: `@ the artists in ${traits.mentions.posts} of ${of}`,
      evidence: `${traits.mentions.posts} of ${of}`,
      bar: bar(traits.mentions.posts),
      off: true,
    });
  }
  return rows;
}

export function describeTraits(traits: VoiceTraits): string[] {
  return traitRows(traits, "wide").map((row) => `${row.label}: ${row.value} (${row.evidence}).`);
}

export function voicePromptBlock(args: {
  handle: string;
  pageKind: "promoter" | "artist";
  samples: readonly { caption: string }[];
  traits: VoiceTraits | null;
  hashtagsEnabled: boolean;
  shape?: string | null;
}): string | null {
  if (!traitsReady(args.samples.length) || !args.traits) return null;
  const traits = describeTraits(args.traits);
  const exemplars = args.samples.slice(0, VOICE_SAMPLE_CAP).map((sample, index) => `${index + 1}. ${sample.caption.replaceAll("\n", " / ")}`);
  const hashtags = args.hashtagsEnabled
    ? "Hashtags may close the primary text only, in this page's habit. Do not put one on the overlay."
    : "The page uses hashtags and @mentions; do not write either.";
  return [
    `VOICE — @${args.handle} (${args.pageKind}). These are the page's own recent posts. Write in this voice.`,
    "Use them for tone only: never reuse a sentence or six consecutive words from any of them.",
    args.shape ? args.shape : "",
    `Traits (of ${args.traits.sampleN} posts):`,
    ...traits.map((line) => `- ${line}`),
    hashtags,
    "Emoji and a sign-off go in the primary text only. The overlay has no emoji, no hashtag, and no full caps.",
    args.traits.signOffs[0]
      ? `A recurring sign-off, "${args.traits.signOffs[0].line}" (${args.traits.signOffs[0].count} of ${args.traits.sampleN}), may close the primary text as written.`
      : "",
    "Exemplars, newest first:",
    ...exemplars,
    "Facts still come only from the tokens. Never type a date, a venue, a price or a lineup from an exemplar.",
  ].filter(Boolean).join("\n");
}

/** Append the voice block. A null block leaves the prompt byte for byte. */
export function appendVoice(prompt: string, block: string | null): string {
  if (!block) return prompt;
  return `${prompt}\n\n${block}`;
}

export function wordRun(text: string): string[] {
  return text
    .toLowerCase()
    .replace(EMOJI_G, " ")
    .replace(HASHTAG_G, " ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function hasSixWordRun(candidate: string, sample: string): boolean {
  const left = wordRun(candidate);
  const right = wordRun(sample);
  if (left.length < 6 || right.length < 6) return false;
  const windows = new Set<string>();
  for (let i = 0; i <= right.length - 6; i += 1) windows.add(right.slice(i, i + 6).join(" "));
  for (let i = 0; i <= left.length - 6; i += 1) {
    if (windows.has(left.slice(i, i + 6).join(" "))) return true;
  }
  return false;
}

export function copiesVoice(overlay: string, primary: string, samples: readonly string[], signOff: string | null): boolean {
  const trimmed = primary.trimEnd();
  const primaryBody = signOff && trimmed.endsWith(signOff) ? trimmed.slice(0, -signOff.length) : primary;
  for (const sample of samples) {
    if (hasSixWordRun(overlay, sample)) return true;
    if (hasSixWordRun(primaryBody, sample)) return true;
  }
  return false;
}

export function hasHashtag(text: string): boolean {
  return HASHTAG.test(text);
}

export function shapeLine(feature: { feature: string; value: string } | null, style: string): string {
  if (!feature) return `Shape: the ${style.replaceAll("_", " ")} seed examples.`;
  return `Shape: ${feature.feature.replaceAll("_", " ")} is ${feature.value.replaceAll("_", " ")}.`;
}

export function fallbackSentence(reason: "empty" | "floor" | "unread"): string {
  if (reason === "unread") return "The page could not be read. The writer used the house voice: the style's seed examples.";
  if (reason === "floor") return "Fewer than 8 posts. The writer used the house voice: the style's seed examples.";
  return "No posts read yet. The writer used the house voice: the style's seed examples.";
}

export function voiceChipLabel(args: { handle: string | null; sampleN: number; error: string | null }): string {
  if (args.error && args.sampleN < VOICE_FLOOR) return args.error;
  if (args.sampleN >= VOICE_FLOOR && args.handle) return `Sounds like @${args.handle} · ${args.sampleN} posts`;
  if (args.sampleN > 0) return `Not enough posts yet · ${args.sampleN} of ${VOICE_FLOOR}`;
  return "No posts read yet — Read posts";
}
