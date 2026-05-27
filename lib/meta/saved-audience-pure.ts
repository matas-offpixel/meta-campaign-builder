/**
 * lib/meta/saved-audience-pure.ts
 *
 * Pure parsing / payload helpers for the Saved Audience clone tool. No HTTP,
 * no `server-only`, no `@/`-aliased runtime imports — so the unit tests can
 * load this module under node --test without a path-alias resolver.
 *
 * The HTTP wrappers live in `./saved-audience.ts` and call into these helpers.
 */

/** Shape returned by `GET /act_{id}/saved_audiences`. */
export interface RawSavedAudience {
  id: string;
  name: string;
  description?: string;
  /** ISO timestamp — Meta surfaces this as `time_updated`. */
  time_updated?: string;
  time_created?: string;
  /** Full targeting spec. We POST this verbatim (JSON-stringified) when cloning. */
  targeting?: unknown;
  /** Run status: { code, description } — present on most saved audiences. */
  run_status?: { code?: number; description?: string };
  permission_for_actions?: unknown;
}

/** Normalised list item the picker UI consumes. */
export interface SavedAudienceListItem {
  id: string;
  name: string;
  description: string | null;
  /** ISO; falls back to time_created when time_updated is absent. */
  updatedAt: string | null;
}

/** Parse the `data` array from Meta's saved_audiences list response. */
export function parseSavedAudienceListResponse(
  json: unknown,
): SavedAudienceListItem[] {
  if (!json || typeof json !== "object") return [];
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((row): SavedAudienceListItem | null => {
      if (!row || typeof row !== "object") return null;
      const r = row as RawSavedAudience;
      if (typeof r.id !== "string" || typeof r.name !== "string") return null;
      return {
        id: r.id,
        name: r.name,
        description:
          typeof r.description === "string" && r.description.trim()
            ? r.description
            : null,
        updatedAt: r.time_updated ?? r.time_created ?? null,
      };
    })
    .filter((x): x is SavedAudienceListItem => x !== null);
}

/**
 * Build the POST body for `POST /act_{dest}/saved_audiences`. The targeting
 * spec is sent as a JSON-stringified value — Meta rejects nested objects on
 * the saved_audiences edge unless the spec is serialised.
 *
 * Source name is preserved verbatim (brief: "no suffix"). Description is
 * carried over when present so the cloned audience looks identical on the
 * destination account.
 */
export function buildSavedAudienceCreateParams(source: {
  name: string;
  description?: string | null;
  targeting: unknown;
}): { name: string; targeting: string; description?: string } {
  if (!source.targeting || typeof source.targeting !== "object") {
    throw new Error(
      "Saved audience targeting is missing — cannot clone an audience without a spec.",
    );
  }
  const params: { name: string; targeting: string; description?: string } = {
    name: source.name,
    targeting: JSON.stringify(source.targeting),
  };
  if (source.description && source.description.trim()) {
    params.description = source.description;
  }
  return params;
}

/** Case-sensitive duplicate detection — matches Meta's name uniqueness rule. */
export function findDuplicateName(
  sourceName: string,
  destNames: ReadonlySet<string>,
): boolean {
  return destNames.has(sourceName);
}

/**
 * Map a Meta error code to a clone-relevant error reason. Used so the UI can
 * label each failed cell with something more specific than the raw message.
 *
 * - 80004 — ad-account rate limit reached. Don't retry inside this batch.
 * - 100   — generic invalid-parameter; often "missing permissions for the
 *           referenced custom audience id" when BM share isn't in place.
 * - 200   — permissions error on the destination account.
 * - 190 / 102 — token expired / invalid.
 */
export type CloneFailureReason =
  | "duplicate_name"
  | "rate_limit"
  | "permission"
  | "missing_targeting"
  | "auth"
  | "unknown";

export function classifyCloneError(args: {
  code?: number | null;
  message?: string | null;
}): CloneFailureReason {
  const { code, message } = args;
  const msg = (message ?? "").toLowerCase();

  if (
    msg.includes("already exists") ||
    msg.includes("duplicate") ||
    msg.includes("name has already been taken")
  ) {
    return "duplicate_name";
  }
  if (code === 80004 || code === 4 || code === 17) return "rate_limit";
  if (code === 190 || code === 102) return "auth";
  if (code === 200) return "permission";
  if (msg.includes("permission") || msg.includes("not allowed")) {
    return "permission";
  }
  return "unknown";
}
