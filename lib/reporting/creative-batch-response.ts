/**
 * lib/reporting/creative-batch-response.ts
 *
 * Request builder + response parser for the phase-2 creative
 * hydration call in `lib/reporting/active-creatives-fetch.ts`.
 *
 * Lives in its own module for the same reason `lib/meta/retry.ts` and
 * `lib/meta/error-classify.ts` do: the fetch module carries
 * `import "server-only"`, which blows up under Node's
 * `--experimental-strip-types` test runner, so anything that needs
 * unit coverage has to be importable on its own.
 *
 * Background — why this shape exists at all:
 *
 *   Hydration used to use Meta's multi-read endpoint,
 *   `GET /?ids=<id,id,…>&fields=<…>`, which returned a plain object
 *   keyed by creative id. Meta REMOVED the `ids` query parameter in
 *   Graph API v26.0; every call started coming back with
 *   `meta_code=100 "The ids query parameter is deprecated in
 *   v26.0+."`. The caller's per-batch catch swallowed that by design
 *   (a degraded batch beats a dropped event), so hydration returned
 *   an empty map on every event with no error surfaced anywhere —
 *   the dashboard's Top Creatives tiles fell back to initials
 *   placeholders and the AI auto-tagger skipped every creative for
 *   want of a thumbnail.
 *
 * The replacement is the Batch API: `POST /` with a `batch` array of
 * `{method, relative_url}` sub-requests. Its response is an ARRAY
 * positionally matching the request, where each entry carries the
 * sub-response's HTTP `code` and a `body` that is a JSON *string* —
 * not a nested object. A sub-request can fail on its own (deleted
 * creative, revoked permission) and still arrive inside a 200
 * envelope, so "did this one succeed" has to be decided per entry.
 */

export interface GraphBatchSubResponse {
  code?: number;
  body?: string;
}

export interface GraphBatchSubRequest {
  method: "GET";
  relative_url: string;
}

/**
 * Build the `batch` array for a chunk of creative ids.
 *
 * `fields` is passed through verbatim as a comma-joined list.
 * Commas are legal unencoded in a query-string value and Meta's own
 * batch examples use them that way, so no escaping is applied — the
 * caller owns the field list and it contains no user input.
 */
export function buildCreativeBatchRequest(
  creativeIds: readonly string[],
  fields: string,
): GraphBatchSubRequest[] {
  return creativeIds.map((id) => ({
    method: "GET" as const,
    relative_url: `${id}?fields=${fields}`,
  }));
}

/**
 * Parse one batch sub-response into a creative-shaped object, or
 * `null` when the sub-request did not yield a usable creative.
 *
 * Returns `null` — never a partially-populated object — for:
 *   - a missing / empty `body`
 *   - a `body` that isn't valid JSON
 *   - a `body` that isn't a JSON object (Meta returns `true` for
 *     some write shapes; not expected here, but cheap to exclude)
 *   - an error envelope (`{"error": {...}}`), which arrives with the
 *     batch's own HTTP 200 and would otherwise masquerade as a
 *     creative with every field `undefined`
 *   - a body with no `id`, which can't be keyed into the result map
 *
 * Typed loosely (`Record<string, unknown>`) so this module stays
 * free of the fetch module's `RawCreative` import; the caller casts.
 */
export function parseCreativeBatchSubResponse(
  sub: GraphBatchSubResponse | null | undefined,
): Record<string, unknown> | null {
  if (!sub?.body) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(sub.body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if ("error" in obj) return null;
  if (typeof obj.id !== "string" || obj.id.length === 0) return null;
  return obj;
}
