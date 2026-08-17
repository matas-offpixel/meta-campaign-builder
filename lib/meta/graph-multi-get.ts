/**
 * lib/meta/graph-multi-get.ts
 *
 * The network half of the `ids=` replacement. Pure request-shaping and
 * response-parsing live in `./graph-multi-get-parse.ts`; see that
 * module's header for the full background on what Meta removed in
 * Graph API v26.0 and why every caller of the old endpoint failed
 * silently.
 *
 * CHUNKING
 *
 *   Meta caps a batch at 50 sub-requests. Callers already chunk to
 *   their own budgets (20-25), but this helper re-chunks defensively
 *   so a caller passing more than the cap degrades into extra calls
 *   rather than an error.
 */

import { graphPostWithToken } from "@/lib/meta/client";
import {
  buildMultiGetBatch,
  collectMultiGetResponses,
  GRAPH_BATCH_MAX,
  type GraphBatchSubResponse,
} from "@/lib/meta/graph-multi-get-parse";

export {
  buildMultiGetBatch,
  collectMultiGetResponses,
  parseMultiGetSubResponse,
  GRAPH_BATCH_MAX,
  type GraphBatchSubRequest,
  type GraphBatchSubResponse,
} from "@/lib/meta/graph-multi-get-parse";

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Read many nodes by id in one round trip per chunk.
 *
 * Signature-compatible with `graphGetWithToken` so call sites migrate
 * by swapping the identifier and nothing else. `path` is ignored.
 *
 * Throws on a whole-batch failure (auth, rate limit) so callers'
 * existing try/catch keeps behaving as it did. Individual sub-request
 * failures are simply absent from the returned record — the same way
 * the old endpoint omitted ids it could not resolve.
 */
export async function graphMultiGetByIds<T>(
  _path: string,
  params: Record<string, string>,
  token: string,
): Promise<Record<string, T>> {
  const ids = (params.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return {};
  const fields = params.fields ?? "";

  const batches = await Promise.all(
    chunk([...new Set(ids)], GRAPH_BATCH_MAX).map((idChunk) =>
      graphPostWithToken<GraphBatchSubResponse[]>(
        "",
        {
          batch: buildMultiGetBatch(idChunk, fields),
          include_headers: false,
        },
        token,
      ),
    ),
  );

  const out: Record<string, T> = {};
  for (const batch of batches) {
    Object.assign(out, collectMultiGetResponses<T>(Array.isArray(batch) ? batch : []));
  }
  return out;
}
