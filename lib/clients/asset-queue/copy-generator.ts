/**
 * copy-generator.ts
 *
 * Calls Claude Haiku 4.5 to generate ad copy for a single asset queue row.
 * Falls back to copy_templates from client_asset_sheet_config if the API is
 * unavailable or returns malformed JSON.
 *
 * The prompt is deliberately scoped to non-confidential fields only:
 * asset name, funnel stage, venue, event name. Revenue, budgets, and other
 * client-confidential data are never sent to the model.
 *
 * Return shape is always GeneratedCopy — never throws on Anthropic failure.
 */

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-haiku-4-5";

export interface CopyInput {
  assetName: string;
  /** "Graphic" | "Video" from column D of the sheet */
  mediaType: string;
  funnel: string;          // TOFU | MOFU | BOFU
  location: string;
  eventName: string;
  eventCode: string;
  /** Ground-truth venue name from events table — never invent alternatives. */
  venueName?: string | null;
  /** Ground-truth city from events table — never invent alternatives. */
  venueCity?: string | null;
}

export interface GeneratedCopy {
  primaryText: string;
  headline: string;
  ctaValue: string;
  /** true when the result came from fallback templates, not AI */
  fromFallback: boolean;
}

export interface CopyFallbackTemplates {
  TOFU?: string;
  MOFU?: string;
  BOFU?: string;
  [key: string]: string | undefined;
}

export interface CtaDefaults {
  TOFU?: string;
  MOFU?: string;
  BOFU?: string;
  [key: string]: string | undefined;
}

export type AssetCopyScope = "venue-wide" | "fixture-specific";

const VENUE_WIDE_KEYWORDS = [
  "tickets",
  "ticket",
  "sale",
  "loading bar",
  "general",
  "selling fast",
  "running out",
  "general admission",
  "all matches",
  "all games",
  "loading",
];

const FIXTURE_KEYWORDS = [/\bvs?\b/i, /\bversus\b/i];

/**
 * Infer whether ad copy should reference the whole venue or a single fixture.
 */
export function detectAssetScope(assetName: string): AssetCopyScope {
  const name = assetName.toLowerCase().trim();
  if (!name) return "fixture-specific";

  const hasVenueWide = VENUE_WIDE_KEYWORDS.some((kw) => name.includes(kw));
  const hasFixture = FIXTURE_KEYWORDS.some((re) => re.test(name));

  if (hasVenueWide && !hasFixture) return "venue-wide";
  return "fixture-specific";
}

const GROUND_TRUTH_RULES = `GROUND TRUTH RULES (mandatory):
- Use ONLY venue names, cities, fixtures, opponents, and teams explicitly listed in the user message.
- NEVER invent or assume venue names, stadiums, addresses, or nicknames (e.g. do not guess "Easter Road" or similar).
- NEVER invent fixtures, opponents, matchups, or national teams unless they appear verbatim in the asset name or event name fields.
- If no specific venue name is provided, refer only to the city or sheet location — do not name a venue.
- Do not use real-world football knowledge beyond the provided fields.`;

const SYSTEM_PROMPT = `You generate Facebook ad copy for 4theFans, a football fan event marketing agency.
Return ONLY valid JSON with exactly these keys: primary_text (string, max 100 chars), headline (string, max 30 chars).
No markdown, no explanation, no extra keys. UK English. Energetic and direct tone.

${GROUND_TRUTH_RULES}`;

const VENUE_WIDE_SYSTEM_PROMPT = `${SYSTEM_PROMPT}
The asset promotes the VENUE across multiple matches — do NOT mention a specific fixture, opponent, or single game.`;

function groundTruthVenueLabel(input: CopyInput): string {
  return input.venueName || input.venueCity || input.location || input.eventName;
}

function buildGroundTruthBlock(input: CopyInput): string {
  const lines = [
    `Asset name: ${input.assetName}`,
    `Asset type: ${input.mediaType || "Unknown"}`,
    `Funnel stage: ${input.funnel}`,
    `Sheet location: ${input.location || "(not provided)"}`,
    `Event name: ${input.eventName || "(not provided)"}`,
    `Event code: ${input.eventCode || "(not provided)"}`,
    `Venue name (use exactly if provided): ${input.venueName || "(not provided)"}`,
    `Venue city (use exactly if provided): ${input.venueCity || "(not provided)"}`,
  ];
  return lines.join("\n");
}

function buildUserPrompt(input: CopyInput, scope: AssetCopyScope): string {
  const venue = groundTruthVenueLabel(input);

  if (scope === "venue-wide") {
    return `${buildGroundTruthBlock(input)}

This asset promotes ticket availability across ALL games at the venue (not one specific match).
Write venue-level copy about ${venue} using ONLY the ground-truth fields above — no invented venues, cities, fixtures, or opponents.`;
  }

  return `${buildGroundTruthBlock(input)}

Generate ad copy for this asset using ONLY the ground-truth fields above.
Only mention a fixture or opponent if it appears verbatim in the asset name or event name.`;
}

function parseCopyResponse(raw: string): { primary_text: string; headline: string } | null {
  try {
    const cleaned = raw.trim().replace(/^```json?\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.primary_text === "string" && typeof parsed.headline === "string") {
      return {
        primary_text: parsed.primary_text.slice(0, 100),
        headline: parsed.headline.slice(0, 30),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function fallbackCopy(
  input: CopyInput,
  templates: CopyFallbackTemplates,
  ctaDefaults: CtaDefaults,
  scope: AssetCopyScope,
): GeneratedCopy {
  const venue = groundTruthVenueLabel(input);
  const template =
    scope === "venue-wide"
      ? templates[input.funnel] ??
        `Final tickets running low across all games at ${venue}. Don't miss your chance!`
      : templates[input.funnel] ?? `Check out ${input.eventName || venue}!`;
  return {
    primaryText: template.slice(0, 100),
    headline: (scope === "venue-wide" ? venue : (input.eventName || venue)).slice(0, 30),
    ctaValue: ctaDefaults[input.funnel] ?? "LEARN_MORE",
    fromFallback: true,
  };
}

/** Exposed for unit tests — returns the prompt bundle sent to Anthropic. */
export function buildCopyPromptBundle(
  input: CopyInput,
  scope: AssetCopyScope = detectAssetScope(input.assetName),
): { system: string; user: string } {
  return {
    system: scope === "venue-wide" ? VENUE_WIDE_SYSTEM_PROMPT : SYSTEM_PROMPT,
    user: buildUserPrompt(input, scope),
  };
}

/**
 * Generates ad copy for a single asset row.
 * Never throws — returns a fromFallback=true result on any Anthropic error.
 */
export async function generateCopy(
  input: CopyInput,
  fallbackTemplates: CopyFallbackTemplates,
  ctaDefaults: CtaDefaults,
): Promise<GeneratedCopy> {
  const ctaValue = ctaDefaults[input.funnel] ?? "LEARN_MORE";
  const scope = detectAssetScope(input.assetName);

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: scope === "venue-wide" ? VENUE_WIDE_SYSTEM_PROMPT : SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input, scope) }],
    });

    const rawText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const parsed = parseCopyResponse(rawText);
    if (!parsed) {
      console.error("[copy-generator] malformed Anthropic response, falling back", {
        funnel: input.funnel,
        eventCode: input.eventCode,
      });
      return fallbackCopy(input, fallbackTemplates, ctaDefaults, scope);
    }

    return {
      primaryText: parsed.primary_text,
      headline: parsed.headline,
      ctaValue,
      fromFallback: false,
    };
  } catch (err) {
    console.error("[copy-generator] Anthropic API error, falling back", {
      funnel: input.funnel,
      eventCode: input.eventCode,
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackCopy(input, fallbackTemplates, ctaDefaults, scope);
  }
}
