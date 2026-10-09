/**
 * Turn a model reply into suggestions that stay inside the channel limits
 * and only say what the page or the event row already says.
 *
 * The model is `claude-haiku-4-5`, the same one
 * `lib/clients/asset-queue/copy-generator.ts` sets as `MODEL`. It is named
 * here so Suggest does not import that module (it builds an Anthropic
 * client at load). The key is `ANTHROPIC_API_KEY`.
 */

import { type CopyEventFacts, factCorpus, unsupportedFact } from "./copy-facts.ts";
import { COPY_LIMITS, fitLimit, fitTikTok } from "./copy-limits.ts";
import { derivedNote, type DerivedGoogleKeyword } from "./derive/google.ts";
import type { ScrapedPage } from "./copy-scrape.ts";

export const MML_COPY_MODEL = "claude-haiku-4-5";

export interface CopySuggestions {
  metaPrimary: string[];
  metaHeadlines: string[];
  metaDescriptions: string[];
  tiktok: string[];
  googleHeadlines: string[];
  googleDescriptions: string[];
}

export interface DroppedSuggestion {
  text: string;
  reason: string;
}

export interface BuiltSuggestions {
  suggestions: CopySuggestions;
  dropped: DroppedSuggestion[];
  /** `dropped N: unsupported fact`, empty when nothing was dropped. */
  droppedLine: string;
}

const EMPTY: CopySuggestions = {
  metaPrimary: [],
  metaHeadlines: [],
  metaDescriptions: [],
  tiktok: [],
  googleHeadlines: [],
  googleDescriptions: [],
};

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseModelCopy(raw: string): CopySuggestions | null {
  try {
    const cleaned = raw.trim().replace(/^```json?\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      metaPrimary: strings(parsed.metaPrimary),
      metaHeadlines: strings(parsed.metaHeadlines),
      metaDescriptions: strings(parsed.metaDescriptions),
      tiktok: strings(parsed.tiktok),
      googleHeadlines: strings(parsed.googleHeadlines),
      googleDescriptions: strings(parsed.googleDescriptions),
    };
  } catch {
    return null;
  }
}

function keep(
  lines: readonly string[],
  fit: (line: string) => string | null,
  corpus: string,
  limit: number,
  dropped: DroppedSuggestion[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (out.length >= limit) break;
    const fitted = fit(line);
    if (!fitted) {
      if (line.trim()) dropped.push({ text: line.trim(), reason: "over the channel limit" });
      continue;
    }
    const reason = unsupportedFact(fitted, corpus);
    if (reason) {
      dropped.push({ text: fitted, reason });
      continue;
    }
    const key = fitted.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fitted);
  }
  return out;
}

export function buildSuggestions(raw: string, corpus: string): BuiltSuggestions {
  const parsed = parseModelCopy(raw) ?? EMPTY;
  const dropped: DroppedSuggestion[] = [];
  const suggestions: CopySuggestions = {
    metaPrimary: keep(parsed.metaPrimary, (line) => fitLimit(line, 2000), corpus, COPY_LIMITS.metaPrimaryMax, dropped),
    metaHeadlines: keep(parsed.metaHeadlines, (line) => fitLimit(line, COPY_LIMITS.metaHeadline), corpus, 5, dropped),
    metaDescriptions: keep(
      parsed.metaDescriptions,
      (line) => fitLimit(line, COPY_LIMITS.metaDescription),
      corpus,
      5,
      dropped,
    ),
    tiktok: keep(parsed.tiktok, fitTikTok, corpus, 5, dropped),
    googleHeadlines: keep(
      parsed.googleHeadlines,
      (line) => fitLimit(line, COPY_LIMITS.googleHeadline),
      corpus,
      COPY_LIMITS.googleHeadlineMax,
      dropped,
    ),
    googleDescriptions: keep(
      parsed.googleDescriptions,
      (line) => fitLimit(line, COPY_LIMITS.googleDescription),
      corpus,
      COPY_LIMITS.googleDescriptionMax,
      dropped,
    ),
  };
  const factDrops = dropped.filter((row) => row.reason !== "over the channel limit");
  const reasons = [...new Set(factDrops.map((row) => row.reason))];
  const droppedLine =
    factDrops.length === 0
      ? ""
      : `dropped ${factDrops.length}: unsupported fact${reasons.length ? ` — ${reasons.join("; ")}` : ""}`;
  return { suggestions, dropped, droppedLine };
}

/** Keywords are the event name, artist and venue. Nothing else is added. */
export function keywordsFromEvent(event: Pick<CopyEventFacts, "name" | "artist" | "venue">): DerivedGoogleKeyword[] {
  const seen = new Set<string>();
  const out: DerivedGoogleKeyword[] = [];
  for (const [field, value] of [
    ["event name", event.name],
    ["artist", event.artist],
    ["venue", event.venue],
  ] as const) {
    const keyword = value.replace(/\s+/g, " ").trim().toLowerCase();
    if (!keyword || seen.has(keyword) || keyword.length > 80) continue;
    seen.add(keyword);
    out.push({
      keyword,
      match_type: "PHRASE",
      notes: derivedNote(field),
      provenance: field,
    });
  }
  return out;
}

export function suggestPrompt(event: CopyEventFacts, page: ScrapedPage | null, fetchError: string | null): string {
  const corpus = factCorpus(page?.text ?? "", event);
  return [
    "Write ad copy using only the facts below. Do not add a price, a date, a capacity, a venue, an artist, or a claim such as sold out or last tickets unless that fact is written below.",
    "Reply with JSON only:",
    '{"metaPrimary":[],"metaHeadlines":[],"metaDescriptions":[],"tiktok":[],"googleHeadlines":[],"googleDescriptions":[]}',
    "metaPrimary: 3 to 5 short captions. metaHeadlines at most 40 characters. metaDescriptions at most 30. tiktok 1 to 100 characters. googleHeadlines up to 15, each at most 30. googleDescriptions up to 4, each at most 90.",
    fetchError ? `The page could not be fetched: ${fetchError}. Use the event row only.` : "",
    "Facts:",
    corpus,
  ]
    .filter(Boolean)
    .join("\n");
}
