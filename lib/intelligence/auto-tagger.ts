import type OpenAI from "openai";

import {
  CREATIVE_TAG_DIMENSIONS,
  type CreativeTagDimension,
  type MotionCreativeTagRow,
} from "../db/creative-tags.ts";

/**
 * lib/intelligence/auto-tagger.ts
 *
 * Pure OpenAI vision wrapper for Motion-replacement creative tags.
 * Callers provide the closed taxonomy and the OpenAI client; this
 * module does no filesystem or database work so cron routes and
 * validation scripts can share the exact same prompt/validation path.
 */

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
  openai: OpenAI;
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
    "Return strict JSON only, shaped as {\"tags\":[{\"dimension\":\"asset_type\",\"value_key\":\"example\",\"confidence\":0.82}]}.",
    "Confidence must be a number from 0 to 1. Omit dimensions when the image and copy do not provide enough evidence.",
    "",
    "Closed taxonomy:",
    blocks.join("\n\n"),
  ].join("\n");
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
  const completion = await deps.openai.chat.completions.create({
    model: deps.modelVersion,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: buildAutoTagSystemPrompt(deps.taxonomy),
      },
      {
        role: "user",
        content: [
          { type: "text", text: buildAutoTagUserPrompt(input) },
          {
            type: "image_url",
            image_url: { url: input.thumbnailUrl, detail: "low" },
          },
        ],
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    return { tags: [], rawTagCount: 0, hallucinatedTagCount: 0 };
  }

  return validateAutoTagResponseWithDiagnostics(
    parseJsonObject(content),
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

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
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
