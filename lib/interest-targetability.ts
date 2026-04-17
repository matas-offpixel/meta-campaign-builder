/**
 * Interest targetability helpers.
 *
 * Selected interests carry a `targetabilityStatus` indicating whether they map
 * to a live Meta ad-targeting interest. The launch flow only sends `valid`
 * items to Meta; unresolved/discovery/deprecated items are kept on the chip
 * for context and skipped at launch.
 *
 * This module owns the small, pure helpers shared by:
 *   - components/steps/audiences/interest-groups-panel.tsx (add-time tagging
 *     and background validation triggers)
 *   - app/api/meta/interest-validate/route.ts (response shape contract)
 *   - app/api/meta/launch-campaign/route.ts (skip-at-launch filter)
 */

import type {
  InterestSuggestion,
  InterestTargetabilityStatus,
} from "@/lib/types";

/**
 * Meta ad-interest IDs are large numeric strings (current Meta IDs are
 * 13–17 digits). We treat anything matching `^\d{10,}$` as plausibly a real
 * Meta-issued ID; this matches the same regex used in `lib/meta/adset.ts`
 * `isRealMetaId` and the launch preflight filter.
 *
 * Synthetic IDs (e.g. `int1` from mock data, slugged hint phrases) will fail
 * this check and be marked `pending` so background validation kicks in.
 */
export function isMetaConfirmedId(id: string | undefined | null): boolean {
  if (!id) return false;
  return /^\d{10,}$/.test(id.trim());
}

/**
 * Status that should be treated as "OK to send to Meta targeting at launch".
 * Anything else gets skipped (and surfaced to the user).
 *
 * Items that predate this feature won't have `targetabilityStatus` at all;
 * those are treated as `valid` on read so older drafts don't suddenly start
 * dropping interests at launch. New adds always get an explicit value.
 */
export function isInterestTargetable(i: InterestSuggestion): boolean {
  if (!i.targetabilityStatus) return true;
  return i.targetabilityStatus === "valid";
}

/**
 * Returns a copy of the interest with `targetabilityStatus` set if missing.
 *   - Meta-shaped id  → "valid" (came from a confirmed Meta entity row)
 *   - everything else → "pending" (caller should run a live lookup next)
 *
 * Idempotent — if the field is already set, the input is returned unchanged.
 */
export function enrichWithTargetability(
  interest: InterestSuggestion,
): InterestSuggestion {
  if (interest.targetabilityStatus) return interest;
  return {
    ...interest,
    targetabilityStatus: isMetaConfirmedId(interest.id) ? "valid" : "pending",
  };
}

// ─── Client-side validation API contract ─────────────────────────────────────

export interface InterestValidateRequestItem {
  /** Optional — passed back in the response so callers can correlate. */
  id?: string;
  /** Required — the human-readable name we'll search Meta for. */
  name: string;
}

export interface InterestValidateResultMeta {
  id: string;
  name: string;
  audienceSize?: number;
  path?: string[];
}

export interface InterestValidateResult {
  /** Original requested name, echoed for correlation. */
  name: string;
  /** Original requested id, echoed for correlation (may be undefined). */
  requestedId?: string;
  targetabilityStatus: InterestTargetabilityStatus;
  /**
   * The canonical Meta entity when targetabilityStatus === "valid".
   * (Note: even if the caller supplied a synthetic id, we prefer the live
   * Meta id here so the caller can swap it in.)
   */
  meta?: InterestValidateResultMeta;
  /**
   * Up to 5 nearby valid replacements when targetabilityStatus === "unresolved".
   * Empty array means Meta returned nothing for this name.
   */
  replacements?: InterestValidateResultMeta[];
  /** ISO timestamp this result was produced. */
  checkedAt: string;
}

export interface InterestValidateResponse {
  results: InterestValidateResult[];
}

/**
 * Client helper — POSTs a batch of items to /api/meta/interest-validate and
 * returns the parsed response. Failures (network, 5xx) bubble up as thrown
 * errors so the caller can leave items in `pending` and retry later.
 *
 * Safe to call from the browser (no secrets used).
 */
export async function validateInterestsTargetability(
  items: InterestValidateRequestItem[],
  init?: { signal?: AbortSignal },
): Promise<InterestValidateResponse> {
  if (items.length === 0) return { results: [] };
  const res = await fetch("/api/meta/interest-validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
    signal: init?.signal,
  });
  if (!res.ok) {
    throw new Error(
      `interest-validate failed: HTTP ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as InterestValidateResponse;
}

/**
 * Apply a validation result to an existing InterestSuggestion. Used by the
 * UI to patch a chip in place after a background lookup completes. If the
 * result resolved to a different (canonical) Meta id, the id is swapped in
 * so subsequent launches use the targetable id.
 */
export function applyTargetabilityResult(
  interest: InterestSuggestion,
  result: InterestValidateResult,
): InterestSuggestion {
  const next: InterestSuggestion = {
    ...interest,
    targetabilityStatus: result.targetabilityStatus,
    targetabilityCheckedAt: result.checkedAt,
  };
  if (result.targetabilityStatus === "valid" && result.meta) {
    next.id = result.meta.id;
    next.name = result.meta.name;
    if (result.meta.audienceSize !== undefined) {
      next.audienceSize = result.meta.audienceSize;
    }
    if (result.meta.path) next.path = result.meta.path;
    next.targetabilityReplacements = undefined;
  } else if (
    result.targetabilityStatus === "unresolved" &&
    result.replacements &&
    result.replacements.length > 0
  ) {
    next.targetabilityReplacements = result.replacements.slice(0, 5).map((r) => ({
      id: r.id,
      name: r.name,
      audienceSize: r.audienceSize,
    }));
  } else {
    next.targetabilityReplacements = undefined;
  }
  return next;
}
