import { createHash } from "node:crypto";

import type Anthropic from "@anthropic-ai/sdk";
import type {
  Tool,
  ToolUseBlock,
  Usage,
} from "@anthropic-ai/sdk/resources/messages";

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

/**
 * Sonnet 4.6 is the production tagger. A Haiku 4.5 swap was validated against
 * Sonnet ground truth (see PR #457 validation comment) and rejected: every
 * dimension landed below 0.50 F1 with 28.1% exact-set-match across cells. The
 * model-agnostic dedup + cadence work from that PR is preserved here; the
 * model string stays on Sonnet. The string is also persisted to
 * `creative_tag_assignments.model_version`, so the cadence gate and content-
 * hash dedup are scoped to "tags produced by this exact model".
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

/** Token usage for a single classification call. Zeroed out for hits that
 * never reached Anthropic (empty image, hash-reuse short-circuit, etc). */
export interface AutoTagUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface AutoTagDiagnostics {
  tags: AutoTagResult[];
  rawTagCount: number;
  hallucinatedTagCount: number;
  /** Only set when these diagnostics came from a live Anthropic call —
   * `validateAutoTagResponseWithDiagnostics` (pure validation, no call) omits
   * it. */
  usage?: AutoTagUsage;
  /** Content hash of the resolved thumbnail. Only set on a live call (see
   * `usage` above) — same value that would be persisted as
   * `creative_tag_assignments.thumbnail_hash`. */
  thumbnailHash?: string | null;
  /** Where the thumbnail bytes came from — `"cache"` when `thumbnailCache`
   * (see `AutoTaggerDeps`) served a prior Meta download, `"meta"` otherwise. */
  thumbnailSource?: AutoTagThumbnailSource;
}

/**
 * Content-addressed byte cache for Meta thumbnails, keyed by the SHA256 of
 * the decoded image bytes (see `hashAutoTagImage`) — not by URL, since
 * Meta's CDN URLs carry rotating signature/expiry params.
 *
 * `get` is looked up by URL because the caller doesn't know the content
 * hash until bytes are in hand; a real implementation resolves this via an
 * internal url → hash index (see `createSupabaseAutoTagThumbnailCache`).
 * Both methods MUST NOT throw — implementations should swallow their own
 * errors and return `null` / resolve, so a cache outage never blocks
 * tagging. Callers still wrap calls defensively as a second line of
 * defence.
 */
export interface AutoTagThumbnailCache {
  get(url: string): Promise<(AutoTagImage & { hash: string }) | null>;
  put(url: string, hash: string, image: AutoTagImage): Promise<void>;
}

export type AutoTagThumbnailSource = "cache" | "meta";

export interface AutoTaggerDeps {
  taxonomy: MotionCreativeTagRow[];
  anthropic: Pick<Anthropic, "messages">;
  modelVersion: string;
  /**
   * Optional Storage-backed cache for the raw thumbnail bytes fetched from
   * Meta. Cuts duplicate Meta/CDN traffic when the exact same URL is
   * resolved more than once — e.g. `scripts/validate-ai-tagging.ts` running
   * the same snapshot's creatives through two `--model` values back to
   * back. Purely a cost/traffic optimisation: a miss or a cache error always
   * falls back to a live Meta fetch (see `resolveAutoTagImage`).
   */
  thumbnailCache?: AutoTagThumbnailCache;
}

export type AutoTagImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface AutoTagImage {
  base64: string;
  mediaType: AutoTagImageMediaType;
}

/** One creative to tag in a deduplicated batch. */
export interface DedupAutoTagInput {
  creativeName: string;
  thumbnailUrl: string | null;
  headline: string | null;
  body: string | null;
}

/**
 * Provenance of a creative's tags within a deduplicated batch:
 * - `tagged` — this creative's image triggered the (single) Claude call.
 * - `reused_run` — another creative in this batch shares the image; reused, no call.
 * - `reused_persisted` — the image hash matched `knownTagsByHash` (this event's
 *   own prior run); no call.
 * - `reused_global` — the image hash matched `resolveKnownTagsByHash` (a
 *   DIFFERENT event's tags for the same content hash); no call.
 * - `no_thumbnail` — input had no thumbnail URL; nothing to tag.
 * - `fetch_failed` — the thumbnail fetch failed; could not hash or tag.
 * - `empty` — Claude returned no usable tags for the image.
 * - `error` — the Claude call threw for this image's hash group.
 */
export type DedupAutoTagOutcome =
  | "tagged"
  | "reused_run"
  | "reused_persisted"
  | "reused_global"
  | "no_thumbnail"
  | "fetch_failed"
  | "empty"
  | "error";

export interface DedupAutoTagResult {
  creativeName: string;
  thumbnailHash: string | null;
  tags: AutoTagResult[];
  outcome: DedupAutoTagOutcome;
  /** Only non-zero for the representative call that actually hit Anthropic. */
  usage: AutoTagUsage;
}

export interface DedupAutoTaggerDeps extends AutoTaggerDeps {
  /** Tags already persisted for a given image hash (e.g. from prior cron runs
   * of THIS event). Checked before `resolveKnownTagsByHash`. */
  knownTagsByHash?: ReadonlyMap<string, AutoTagResult[]>;
  /**
   * Optional global lookup, called once per batch with every unique hash from
   * Phase 1 that `knownTagsByHash` didn't already cover. Lets a caller do a
   * cross-event DB query (recurring creative assets are frequently reused
   * across different events/clients) without a second thumbnail fetch — the
   * bytes are already in memory by the time this fires. Hashes the resolver
   * doesn't return proceed to classification as normal.
   */
  resolveKnownTagsByHash?: (
    hashes: string[],
  ) => Promise<ReadonlyMap<string, AutoTagResult[]>>;
  /** Max concurrent thumbnail fetches / Claude calls. Defaults to 1. */
  concurrency?: number;
  /** Per-image error hook (the batch swallows the throw and continues). */
  onClassifyError?: (creativeName: string, error: unknown) => void;
  /** Fires once per resolvable thumbnail URL in Phase 1 — lets the caller
   * tally `thumbnailCache` hit/miss counts for cron logging. */
  onThumbnailFetch?: (info: {
    url: string;
    source: AutoTagThumbnailSource;
  }) => void;
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

/**
 * System prompt wrapped as a single cached content block. The taxonomy is
 * ~5-15K tokens and identical across every creative in a cron run (and across
 * runs, until the taxonomy itself changes), so it's the highest-value prompt-
 * caching target: Anthropic caches the prefix (tools + this system block) for
 * 5 minutes and subsequent calls within that window pay the ~10%-of-base
 * "cache read" rate instead of full input-token price. See
 * https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching.
 * `classifyAutoTagImage` is the only caller — kept separate from
 * `buildAutoTagSystemPrompt` so tests/scripts that just want the raw string
 * (e.g. asserting taxonomy content) don't have to unwrap the block shape.
 */
export function buildAutoTagSystemBlocks(
  taxonomy: MotionCreativeTagRow[],
): Array<{
  type: "text";
  text: string;
  cache_control: { type: "ephemeral" };
}> {
  return [
    {
      type: "text",
      text: buildAutoTagSystemPrompt(taxonomy),
      cache_control: { type: "ephemeral" },
    },
  ];
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

export function buildAutoTagUserPrompt(
  input: Pick<AutoTagInput, "headline" | "body">,
): string {
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
  const resolved = await resolveAutoTagImage(
    input.thumbnailUrl,
    deps.thumbnailCache,
  );
  if (!resolved) return EMPTY_DIAGNOSTICS;
  const diagnostics = await classifyAutoTagImage(resolved.image, input, deps);
  return {
    ...diagnostics,
    thumbnailHash: resolved.hash,
    thumbnailSource: resolved.source,
  };
}

const ZERO_USAGE: AutoTagUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

const EMPTY_DIAGNOSTICS: AutoTagDiagnostics = {
  tags: [],
  rawTagCount: 0,
  hallucinatedTagCount: 0,
  usage: ZERO_USAGE,
};

function usageFromResponse(usage: Usage | undefined): AutoTagUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
  };
}

/**
 * Fetch a thumbnail and return it as inline base64 + media type, or null when
 * the fetch fails. Split out of `autoTagWithDiagnostics` so the dedup path can
 * hash the bytes and feed the same payload to `classifyAutoTagImage` without a
 * second network round-trip.
 */
async function fetchAutoTagImage(url: string): Promise<AutoTagImage | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const mediaType = mediaTypeFromContentType(
    response.headers.get("content-type"),
  );
  const base64 = Buffer.from(await response.arrayBuffer()).toString("base64");
  return { base64, mediaType };
}

/** Single Anthropic classification call against an already-fetched image. */
async function classifyAutoTagImage(
  image: AutoTagImage,
  copy: Pick<AutoTagInput, "headline" | "body">,
  deps: AutoTaggerDeps,
): Promise<AutoTagDiagnostics> {
  const message = await deps.anthropic.messages.create({
    model: deps.modelVersion,
    max_tokens: 1024,
    temperature: 0,
    // Cached as one breakpoint (see buildAutoTagSystemBlocks) — Anthropic
    // caches the tools+system prefix for 5m so repeat calls in a cron run
    // pay the cache-read rate on the ~5-15K taxonomy tokens instead of full
    // input price.
    system: buildAutoTagSystemBlocks(deps.taxonomy),
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
          { type: "text", text: buildAutoTagUserPrompt(copy) },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: image.mediaType,
              data: image.base64,
            },
          },
        ],
      },
    ],
  });

  const usage = usageFromResponse(message.usage);
  const toolUse = message.content.find(
    (block): block is ToolUseBlock =>
      block.type === "tool_use" && block.name === AUTO_TAG_TOOL_NAME,
  );
  if (!toolUse) return { ...EMPTY_DIAGNOSTICS, usage };

  const diagnostics = validateAutoTagResponseWithDiagnostics(
    toolUse.input,
    deps.taxonomy,
  );
  return { ...diagnostics, usage };
}

/**
 * Stable content hash of a fetched thumbnail. We hash the decoded bytes (via
 * their canonical base64 encoding) rather than the thumbnail URL because Meta
 * CDN URLs carry rotating signature/expiry query params — the same image is
 * served under many URLs. Renamed/duplicate ads that reuse one image therefore
 * collapse to one hash, which is the dedup key for `autoTagDeduped` and the
 * value persisted to `creative_tag_assignments.thumbnail_hash`.
 */
export function hashAutoTagImage(base64: string): string {
  return createHash("sha256").update(base64).digest("hex");
}

/**
 * Resolve a thumbnail's bytes + content hash, preferring `cache` over a live
 * Meta fetch. This is the one call site both `autoTagWithDiagnostics` and
 * `autoTagDeduped`'s Phase 1 route through, so every consumer of
 * `AutoTaggerDeps.thumbnailCache` benefits identically.
 *
 * Cache errors (read OR write) are swallowed here — `thumbnailCache` is a
 * pure cost optimisation and must never turn a cache outage into a tagging
 * outage. A `get` miss (including a thrown error) always falls through to
 * `fetchAutoTagImage`.
 */
async function resolveAutoTagImage(
  url: string,
  cache?: AutoTagThumbnailCache,
): Promise<
  { image: AutoTagImage; hash: string; source: AutoTagThumbnailSource } | null
> {
  if (cache) {
    try {
      const cached = await cache.get(url);
      if (cached) {
        return { image: cached, hash: cached.hash, source: "cache" };
      }
    } catch {
      // Best-effort cache — fall through to a live Meta fetch below.
    }
  }

  const image = await fetchAutoTagImage(url);
  if (!image) return null;
  const hash = hashAutoTagImage(image.base64);

  if (cache) {
    try {
      await cache.put(url, hash, image);
    } catch {
      // A write failure must never fail tagging — the next run just
      // re-fetches from Meta and tries the write again.
    }
  }

  return { image, hash, source: "meta" };
}

/**
 * Content-hash deduplicated tagging. Fetches every input's thumbnail once,
 * groups inputs by image content hash, and calls Claude at most once per unique
 * image — reusing the result across every creative_name that shares the image.
 * `knownTagsByHash` lets a caller seed already-persisted tags (e.g. from prior
 * cron runs) so a recurring image is never re-sent to Claude.
 *
 * Pure of any database work: the caller persists `{ creativeName, thumbnailHash,
 * tags }` and supplies `knownTagsByHash`. Network/Anthropic failures are
 * isolated per image so one bad thumbnail can't sink the batch.
 */
export async function autoTagDeduped(
  inputs: DedupAutoTagInput[],
  deps: DedupAutoTaggerDeps,
): Promise<DedupAutoTagResult[]> {
  // Copied (not aliased) since Phase 1.5 below may add global-lookup hits.
  const known = new Map<string, AutoTagResult[]>(deps.knownTagsByHash ?? []);
  const concurrency = Math.max(1, deps.concurrency ?? 1);

  // Phase 1 — resolve (cache or Meta) + hash each thumbnail (concurrently).
  const prepared = await mapWithConcurrency(inputs, concurrency, async (input) => {
    if (!input.thumbnailUrl) {
      return { input, hash: null, image: null, fetchFailed: false };
    }
    const resolved = await resolveAutoTagImage(
      input.thumbnailUrl,
      deps.thumbnailCache,
    );
    if (!resolved) {
      return { input, hash: null, image: null, fetchFailed: true };
    }
    deps.onThumbnailFetch?.({
      url: input.thumbnailUrl,
      source: resolved.source,
    });
    return {
      input,
      hash: resolved.hash,
      image: resolved.image,
      fetchFailed: false,
    };
  });

  // Phase 1.5 — optional global (cross-event) lookup for hashes the caller's
  // own `knownTagsByHash` didn't already cover. Runs once for the whole
  // batch, keyed off hashes we already have in memory from Phase 1 — no
  // extra thumbnail fetches.
  const globallyKnown = new Set<string>();
  if (deps.resolveKnownTagsByHash) {
    const uncovered = [
      ...new Set(
        prepared
          .map((item) => item.hash)
          .filter((hash): hash is string => hash !== null && !known.has(hash)),
      ),
    ];
    if (uncovered.length > 0) {
      const resolved = await deps.resolveKnownTagsByHash(uncovered);
      for (const [hash, tags] of resolved) {
        if (known.has(hash)) continue;
        known.set(hash, tags);
        globallyKnown.add(hash);
      }
    }
  }

  // Phase 2 — resolve tags once per unique hash. Reuse persisted tags when we
  // can; otherwise call Claude on the first member's image.
  const reusedPersisted = new Set<string>();
  const errored = new Set<string>();
  const tagsByHash = new Map<string, AutoTagResult[]>();
  const usageByHash = new Map<string, AutoTagUsage>();
  const hashesToClassify: string[] = [];
  const representativeByHash = new Map<string, (typeof prepared)[number]>();

  for (const item of prepared) {
    if (item.hash === null) continue;
    if (known.has(item.hash)) {
      if (!tagsByHash.has(item.hash)) {
        tagsByHash.set(item.hash, known.get(item.hash) ?? []);
        reusedPersisted.add(item.hash);
      }
      continue;
    }
    if (!representativeByHash.has(item.hash)) {
      representativeByHash.set(item.hash, item);
      hashesToClassify.push(item.hash);
    }
  }

  await mapWithConcurrency(hashesToClassify, concurrency, async (hash) => {
    const rep = representativeByHash.get(hash);
    if (!rep || !rep.image) {
      tagsByHash.set(hash, []);
      return;
    }
    try {
      const diagnostics = await classifyAutoTagImage(rep.image, rep.input, deps);
      tagsByHash.set(hash, diagnostics.tags);
      if (diagnostics.usage) usageByHash.set(hash, diagnostics.usage);
    } catch (err) {
      errored.add(hash);
      tagsByHash.set(hash, []);
      deps.onClassifyError?.(rep.input.creativeName, err);
    }
  });

  // Phase 3 — assemble per-creative outcomes in input order.
  const emittedRepresentative = new Set<string>();
  return prepared.map((item) => {
    if (item.hash === null) {
      return {
        creativeName: item.input.creativeName,
        thumbnailHash: null,
        tags: [],
        outcome: item.fetchFailed ? "fetch_failed" : "no_thumbnail",
        usage: ZERO_USAGE,
      };
    }
    const tags = tagsByHash.get(item.hash) ?? [];
    const isRepresentative = !emittedRepresentative.has(item.hash);
    emittedRepresentative.add(item.hash);

    let outcome: DedupAutoTagOutcome;
    if (errored.has(item.hash)) {
      outcome = "error";
    } else if (globallyKnown.has(item.hash)) {
      outcome = "reused_global";
    } else if (reusedPersisted.has(item.hash)) {
      outcome = "reused_persisted";
    } else if (isRepresentative) {
      outcome = tags.length > 0 ? "tagged" : "empty";
    } else {
      outcome = tags.length > 0 ? "reused_run" : "empty";
    }

    return {
      creativeName: item.input.creativeName,
      thumbnailHash: item.hash,
      tags,
      outcome,
      usage: isRepresentative
        ? (usageByHash.get(item.hash) ?? ZERO_USAGE)
        : ZERO_USAGE,
    };
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length || 1) },
    async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        results[current] = await worker(items[current]);
      }
    },
  );
  await Promise.all(runners);
  return results;
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

export function mediaTypeFromContentType(
  contentType: string | null,
): AutoTagImageMediaType {
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
