import type Anthropic from "@anthropic-ai/sdk";
import type { Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";

import {
  CREATIVE_TAG_DIMENSIONS,
  type CreativeTagDimension,
  type MotionCreativeTagRow,
} from "../db/creative-tags.ts";

/**
 * lib/intelligence/auto-tagger.ts
 *
 * Pure Anthropic vision wrapper for Motion-replacement creative tags.
 * Callers provide the closed taxonomy and the Anthropic client; this
 * module does no filesystem or database work so cron routes and
 * validation scripts can share the exact same prompt/validation path.
 */

export const AI_AUTOTAG_MODEL_VERSION = "claude-sonnet-4-6";

const AUTO_TAG_TOOL_NAME = "record_creative_tags";

export interface AutoTagInput {
  thumbnailUrl: string;
  headline: string | null;
  body: string | null;
}

export interface AutoTagResult {
  dimension: CreativeTagDimension;
  value_key: string;
  confidence: number;
}

export interface AutoTagDiagnostics {
  tags: AutoTagResult[];
  rawTagCount: number;
  hallucinatedTagCount: number;
}

export interface AutoTaggerDeps {
  taxonomy: MotionCreativeTagRow[];
  anthropic: Pick<Anthropic, "messages">;
  modelVersion: string;
}

interface RawAutoTagResponse {
  tags?: unknown;
}

export function buildAutoTagSystemPrompt(
  taxonomy: MotionCreativeTagRow[],
): string {
  const grouped = groupTaxonomyByDimension(taxonomy);
  const blocks = CREATIVE_TAG_DIMENSIONS.map((dimension) => {
    const rows = grouped.get(dimension) ?? [];
    const values = rows
      .map((row) => {
        const definition = row.description?.trim()
          ? ` — ${row.description.trim()}`
          : "";
        return `- ${row.value_key}: ${row.value_label}${definition}`;
      })
      .join("\n");
    return `${dimension}\n${values || "- no allowed values configured"}`;
  });

  return [
    "You tag Meta event-ad creatives against a closed Motion taxonomy.",
    "Use only the exact value_key strings listed below. Never invent new value_key strings.",
    `Return your answer by calling the ${AUTO_TAG_TOOL_NAME} tool exactly once.`,
    "Confidence must be a number from 0 to 1. Omit dimensions when the image and copy do not provide enough evidence.",
    "",
    "Closed taxonomy:",
    blocks.join("\n\n"),
  ].join("\n");
}

export function buildAutoTagTool(taxonomy: MotionCreativeTagRow[]): Tool {
  const grouped = groupTaxonomyByDimension(taxonomy);
  const tagVariants = CREATIVE_TAG_DIMENSIONS.map((dimension) => {
    const valueKeys = (grouped.get(dimension) ?? []).map((row) => row.value_key);
    return {
      type: "object",
      additionalProperties: false,
      required: ["dimension", "value_key", "confidence"],
      properties: {
        dimension: { type: "string", const: dimension },
        value_key: { type: "string", enum: valueKeys },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
      },
    };
  });

  return {
    name: AUTO_TAG_TOOL_NAME,
    description:
      "Record all visible creative tags using only the closed Motion taxonomy enums.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["tags"],
      properties: {
        tags: {
          type: "array",
          maxItems: CREATIVE_TAG_DIMENSIONS.length * 3,
          items: { anyOf: tagVariants },
        },
      },
    },
  };
}

export function buildAutoTagUserPrompt(input: AutoTagInput): string {
  return [
    "Tag this creative using the image and ad copy.",
    `Headline: ${input.headline?.trim() || "(none)"}`,
    `Body: ${input.body?.trim() || "(none)"}`,
  ].join("\n");
}

export async function autoTag(
  input: AutoTagInput,
  deps: AutoTaggerDeps,
): Promise<AutoTagResult[]> {
  return (await autoTagWithDiagnostics(input, deps)).tags;
}

export async function autoTagWithDiagnostics(
  input: AutoTagInput,
  deps: AutoTaggerDeps,
): Promise<AutoTagDiagnostics> {
  const imageResponse = await fetch(input.thumbnailUrl);
  if (!imageResponse.ok) {
    return { tags: [], rawTagCount: 0, hallucinatedTagCount: 0 };
  }

  const mediaType = mediaTypeFromContentType(
    imageResponse.headers.get("content-type"),
  );
  const imageData = Buffer.from(await imageResponse.arrayBuffer()).toString(
    "base64",
  );

  const message = await deps.anthropic.messages.create({
    model: deps.modelVersion,
    max_tokens: 1024,
    temperature: 0,
    system: buildAutoTagSystemPrompt(deps.taxonomy),
    tools: [buildAutoTagTool(deps.taxonomy)],
    tool_choice: {
      type: "tool",
      name: AUTO_TAG_TOOL_NAME,
      disable_parallel_tool_use: true,
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildAutoTagUserPrompt(input) },
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageData },
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is ToolUseBlock =>
      block.type === "tool_use" && block.name === AUTO_TAG_TOOL_NAME,
  );
  if (!toolUse) {
    return { tags: [], rawTagCount: 0, hallucinatedTagCount: 0 };
  }

  return validateAutoTagResponseWithDiagnostics(
    toolUse.input,
    deps.taxonomy,
  );
}

export function validateAutoTagResponse(
  raw: unknown,
  taxonomy: MotionCreativeTagRow[],
): AutoTagResult[] {
  return validateAutoTagResponseWithDiagnostics(raw, taxonomy).tags;
}

export function validateAutoTagResponseWithDiagnostics(
  raw: unknown,
  taxonomy: MotionCreativeTagRow[],
): AutoTagDiagnostics {
  if (!isRecord(raw) || !Array.isArray((raw as RawAutoTagResponse).tags)) {
    return { tags: [], rawTagCount: 0, hallucinatedTagCount: 0 };
  }

  const allowed = new Set(
    taxonomy.map((row) => `${row.dimension}\u0000${row.value_key}`),
  );
  const out: AutoTagResult[] = [];
  const seen = new Set<string>();
  let rawTagCount = 0;
  let hallucinatedTagCount = 0;

  for (const item of (raw as RawAutoTagResponse).tags as unknown[]) {
    if (!isRecord(item)) continue;
    rawTagCount += 1;
    const dimension = item.dimension;
    const valueKey = item.value_key;
    const confidence = item.confidence;
    if (!isCreativeTagDimension(dimension)) {
      hallucinatedTagCount += 1;
      continue;
    }
    if (typeof valueKey !== "string" || !valueKey.trim()) {
      hallucinatedTagCount += 1;
      continue;
    }
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
      continue;
    }

    const key = `${dimension}\u0000${valueKey}`;
    if (!allowed.has(key)) {
      hallucinatedTagCount += 1;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      dimension,
      value_key: valueKey,
      confidence: Math.max(0, Math.min(1, confidence)),
    });
  }

  return { tags: out, rawTagCount, hallucinatedTagCount };
}

function groupTaxonomyByDimension(
  taxonomy: MotionCreativeTagRow[],
): Map<CreativeTagDimension, MotionCreativeTagRow[]> {
  const grouped = new Map<CreativeTagDimension, MotionCreativeTagRow[]>();
  for (const row of taxonomy) {
    const rows = grouped.get(row.dimension) ?? [];
    rows.push(row);
    grouped.set(row.dimension, rows);
  }
  return grouped;
}

function mediaTypeFromContentType(
  contentType: string | null,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("png")) return "image/png";
  if (normalized.includes("gif")) return "image/gif";
  if (normalized.includes("webp")) return "image/webp";
  return "image/jpeg";
}

function isCreativeTagDimension(value: unknown): value is CreativeTagDimension {
  return (
    typeof value === "string" &&
    CREATIVE_TAG_DIMENSIONS.includes(value as CreativeTagDimension)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
