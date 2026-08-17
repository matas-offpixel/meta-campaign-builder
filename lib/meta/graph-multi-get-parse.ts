/**
 * lib/meta/graph-multi-get-parse.ts
 *
 * Drop-in replacement for Meta's removed multi-read endpoint.
 *
 * WHAT BROKE
 *
 *   Reading many nodes in one call used to be
 *   `GET /?ids=<id,id,…>&fields=<…>`, which returned a plain object
 *   keyed by node id. Meta REMOVED the `ids` query parameter with
 *   Graph API v26.0 (released 29 July 2026). Every such call now
 *   fails with:
 *
 *     meta_code=100 "The ids query parameter is deprecated in v26.0+."
 *
 *   The removal is not gated on the version in the request URL — this
 *   app pins nothing (`META_API_VERSION` is unset, so `lib/meta/client.ts`
 *   defaults to v21.0) and its calls started failing on 28–29 July 2026
 *   regardless.
 *
 *   Every caller of the old endpoint wrapped it in a try/catch that
 *   degraded to "no data" rather than throwing — a sensible posture
 *   for one bad batch, catastrophic when EVERY batch fails. So the
 *   removal surfaced nowhere: creative previews went blank, AI
 *   auto-tagging stopped writing, the audience source cache froze,
 *   and budget-pacing spend silently read as £0. No alarms, because
 *   "empty result" and "endpoint gone" are indistinguishable to a
 *   caller that swallows errors.
 *
 * WHAT REPLACES IT
 *
 *   Meta's Batch API: `POST /` with a `batch` array of
 *   `{method, relative_url}` sub-requests. Its response is an ARRAY
 *   positionally matching the request, each entry `{code, body}`
 *   where `body` is a JSON *string*, and a sub-request can fail on
 *   its own inside an HTTP 200 envelope.
 *
 *   `graphMultiGetByIds` hides all of that and returns the SAME
 *   `Record<string, T>` shape the old endpoint returned, with the
 *   SAME `(path, params, token)` call signature as
 *   `graphGetWithToken`. That is deliberate: every call site swaps by
 *   changing one identifier, and none of the surrounding
 *   "look up `res[id]`, treat missing as unknown" logic has to be
 *   re-reasoned about. `path` is accepted and ignored (callers passed
 *   `""` or `"/"`); `params.ids` is the CSV id list and
 *   `params.fields` the field list.
 *
 * WHY THIS MODULE IS SPLIT FROM THE FETCHER
 *
 *   These are the pure pieces — request shaping and response
 *   parsing — with no imports at all. The fetcher lives in
 *   `graph-multi-get.ts` because it imports `lib/meta/client.ts`,
 *   whose TS parameter-property classes cannot be parsed by Node's
 *   `--experimental-strip-types` test runner. Same seam as
 *   `lib/meta/retry.ts` and `lib/meta/error-classify.ts`: the logic
 *   worth testing stays importable on its own.
 */

/** Meta's documented per-batch sub-request cap. */
export const GRAPH_BATCH_MAX = 50;

export interface GraphBatchSubResponse {
  code?: number;
  body?: string;
}

export interface GraphBatchSubRequest {
  method: "GET";
  relative_url: string;
}

/**
 * Build the `batch` array for a chunk of node ids.
 *
 * `fields` is percent-encoded. This is not merely defensive: callers
 * pass Graph field-expansion syntax such as
 * `insights.date_preset(maximum){spend}` (budget pacing) and
 * `ads.limit(0).summary(true)` (ad-set guards). Braces and parens are
 * not legal raw in a URL, and `relative_url` is parsed by Meta as a
 * path+query, so leaving them unencoded risks a truncated or rejected
 * field list — which, given every caller swallows failures, would fail
 * silently in exactly the way this whole module exists to stop.
 * Meta percent-decodes before parsing, so the round trip is lossless.
 */
export function buildMultiGetBatch(
  ids: readonly string[],
  fields: string,
): GraphBatchSubRequest[] {
  const encodedFields = fields ? encodeURIComponent(fields) : "";
  return ids.map((id) => ({
    method: "GET" as const,
    relative_url: encodedFields
      ? `${encodeURIComponent(id)}?fields=${encodedFields}`
      : encodeURIComponent(id),
  }));
}

/**
 * Parse one batch sub-response into a node object, or `null` when the
 * sub-request did not yield a usable node.
 *
 * Returns `null` — never a partially-populated object — for a
 * missing/empty body, a body that isn't valid JSON, a body that isn't
 * a JSON object, an error envelope, or a body with no `id`.
 *
 * The error-envelope branch is the one that matters: a failed
 * sub-request rides inside the batch's own HTTP 200, so without it a
 * `{"error":{…}}` would land in the result map as a node whose every
 * field is `undefined`. Callers uniformly treat "key present" as
 * "Meta answered", so that is strictly worse than a miss.
 */
export function parseMultiGetSubResponse(
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

/**
 * Collapse a batch response array into the id-keyed object the old
 * `ids=` endpoint returned. Keyed by the `id` inside each parsed body
 * rather than by array position, so a sub-response for an id Meta
 * canonicalised still lands on a correct key.
 */
export function collectMultiGetResponses<T>(
  subResponses: ReadonlyArray<GraphBatchSubResponse | null | undefined>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const sub of subResponses) {
    const parsed = parseMultiGetSubResponse(sub);
    if (!parsed) continue;
    out[parsed.id as string] = parsed as T;
  }
  return out;
}

