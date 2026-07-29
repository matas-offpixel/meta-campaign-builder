/**
 * lib/d2c/bird/paginate.ts
 *
 * One cursor-following list helper for every Bird collection endpoint.
 *
 * Bird caps `limit` at 100 (>100 → 422) and returns `{results, nextPageToken}`.
 * Reading only the first page is not a performance nicety — it is a
 * correctness bug: `findProjectByName` reported "not found" for projects that
 * existed (the workspace holds 383), and the caller responded by creating a
 * DUPLICATE. Same failure mode applies to campaigns.
 *
 * ⚠️ The trap: Bird returns the cursor as `nextPageToken` but only accepts it
 * back as the **`pageToken`** query param. Sending it as `nextPageToken` is
 * accepted with a 200 and re-serves page 1 forever — so the mistake looks like
 * it works until you compare ids. Verified empirically against the live API.
 *
 * Related trap, same flavour: Bird's `/contacts` list endpoint ACCEPTS filter
 * params (`?identifierValue=`, `?phonenumber=`, `?query=`, `?search=`) and
 * silently ignores them, returning an unfiltered page 1 with a 200. Never
 * trust a filtered 200 without checking the returned row actually matches.
 */

import { birdJson } from "./client.ts";

/** Bird rejects limit > 100 with a 422. */
export const BIRD_MAX_PAGE_SIZE = 100;
/** Backstop so a repeating/looping cursor can never spin forever. */
const MAX_PAGES = 100;

/** Bird list responses vary in envelope key; normalise to an array. */
export function unwrapBirdList<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of [
      "results",
      "data",
      "channelTemplates",
      "projects",
      "campaigns",
      "broadcasts",
      "items",
    ]) {
      if (Array.isArray(o[k])) return o[k] as T[];
    }
  }
  return [];
}

/**
 * Follow Bird's `nextPageToken` cursor to completion.
 *
 * @param maxItems stop early once this many rows are collected (callers that
 *                 only need a couple of rows shouldn't walk the whole set).
 */
export async function listAllBirdPages<T>(
  apiKey: string,
  path: string,
  maxItems = Infinity,
): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const remaining = maxItems - out.length;
    if (remaining <= 0) break;

    const params = new URLSearchParams({
      limit: String(Math.min(BIRD_MAX_PAGE_SIZE, remaining)),
    });
    // `pageToken` — NOT `nextPageToken`. See the module doc.
    if (pageToken) params.set("pageToken", pageToken);

    const json = await birdJson<unknown>(apiKey, `${path}?${params}`, { method: "GET" });
    const batch = unwrapBirdList<T>(json);
    out.push(...batch);

    const next =
      json && typeof json === "object"
        ? (json as { nextPageToken?: unknown }).nextPageToken
        : undefined;
    // Stop on: no cursor, an empty page, or a cursor that did not advance.
    if (typeof next !== "string" || !next || batch.length === 0 || next === pageToken) {
      break;
    }
    pageToken = next;
  }

  return out.length > maxItems ? out.slice(0, maxItems) : out;
}
