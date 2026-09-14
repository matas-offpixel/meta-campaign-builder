import { logUnmatchedCandidates } from "../unmatched-candidates.ts";

export const TIKTOK_IMPORT_ENVELOPE_LIST_KEYS = [
  "list",
  "adgroups",
  "ads",
  "campaigns",
] as const;

export class TikTokImportEnvelopeError extends Error {
  readonly context: string;
  readonly keys: readonly string[];

  constructor(context: string, keys: readonly string[]) {
    super(
      `TikTok import failed: ${context} used none of [${keys.join(", ")}]`,
    );
    this.name = "TikTokImportEnvelopeError";
    this.context = context;
    this.keys = keys;
  }
}

export function requireArrayFromCandidates<T>(
  record: unknown,
  keys: readonly string[],
  context: string,
): T[] {
  if (record && typeof record === "object") {
    const object = record as Record<string, unknown>;
    for (const key of keys) {
      const value = object[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  logUnmatchedCandidates(context, keys);
  throw new TikTokImportEnvelopeError(context, keys);
}

export function requireObjectFromCandidates(
  record: unknown,
  keys: readonly string[],
  context: string,
): Record<string, unknown> {
  if (record && typeof record === "object" && !Array.isArray(record)) {
    const object = record as Record<string, unknown>;
    for (const key of keys) {
      const value = object[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    }
  }
  logUnmatchedCandidates(context, keys);
  throw new TikTokImportEnvelopeError(context, keys);
}

export function requireStringFromCandidates(
  record: unknown,
  keys: readonly string[],
  context: string,
): string {
  if (record && typeof record === "object" && !Array.isArray(record)) {
    const object = record as Record<string, unknown>;
    for (const key of keys) {
      const value = object[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  logUnmatchedCandidates(context, keys);
  throw new TikTokImportEnvelopeError(context, keys);
}
