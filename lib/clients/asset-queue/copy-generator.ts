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

const SYSTEM_PROMPT = `You generate Facebook ad copy for 4theFans, a football fan event marketing agency.
Return ONLY valid JSON with exactly these keys: primary_text (string, max 100 chars), headline (string, max 30 chars).
No markdown, no explanation, no extra keys. UK English. Energetic and direct tone.`;

const VENUE_WIDE_SYSTEM_PROMPT = `${SYSTEM_PROMPT}
The asset promotes the VENUE across multiple matches — do NOT mention a specific fixture, opponent, or single game.`;

function buildUserPrompt(input: CopyInput, scope: AssetCopyScope): string {
  if (scope === "venue-wide") {
    const venue = input.location || input.eventName;
    return `Asset name: ${input.assetName}
Asset type: ${input.mediaType || "Unknown"}
Funnel stage: ${input.funnel}
Venue: ${venue}
Event code: ${input.eventCode}

This asset promotes ticket availability across ALL games at the venue (not one specific match).
Write venue-level copy — e.g. urgency about tickets running low at ${venue}, without naming any single fixture or opponent.`;
  }

  return `Asset name: ${input.assetName}
Asset type: ${input.mediaType || "Unknown"}
Funnel stage: ${input.funnel}
Venue/Location: ${input.location}
Event name: ${input.eventName}
Event code: ${input.eventCode}

Generate ad copy for this specific event/fixture asset.`;
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
  const venue = input.location || input.eventName;
  const template =
    scope === "venue-wide"
      ? templates[input.funnel] ??
        `Final tickets running low across all games at ${venue}. Don't miss your chance!`
      : templates[input.funnel] ?? `Check out ${input.eventName} at ${input.location}!`;
  return {
    primaryText: template.slice(0, 100),
    headline: (scope === "venue-wide" ? venue : input.eventName).slice(0, 30),
    ctaValue: ctaDefaults[input.funnel] ?? "LEARN_MORE",
    fromFallback: true,
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
