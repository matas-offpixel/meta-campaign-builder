/**
 * lib/meta/saved-audience.ts
 *
 * Server-only Saved Audience helpers used by the clone tool.
 *
 * Saved Audiences are a re-usable targeting bundle (geo, age, custom_audience
 * inclusions/exclusions). They live entirely Meta-side — nothing in our DB.
 * Cloning across two ad accounts on the same Business Manager works because
 * the underlying Custom Audiences are BM-shared at Manage level; the cloned
 * spec references the same custom_audience IDs and they resolve correctly on
 * the destination account.
 *
 * - GET  /act_{id}/saved_audiences         → list with full targeting
 * - GET  /act_{id}/saved_audiences (names) → list, fields trimmed to name+id
 *                                            (used for duplicate detection on
 *                                            the destination account before
 *                                            cloning)
 * - POST /act_{id}/saved_audiences         → create on destination
 *
 * Import only from Route Handlers — never from client components.
 */

import "server-only";

import { withActPrefix } from "@/lib/meta/ad-account-id";
import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import {
  buildSavedAudienceCreateParams,
  parseSavedAudienceListResponse,
  type SavedAudienceListItem,
} from "@/lib/meta/saved-audience-pure";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

export type { SavedAudienceListItem } from "@/lib/meta/saved-audience-pure";

/** Per-audience row we keep in memory while building the clone batch. */
export interface SavedAudienceWithTargeting extends SavedAudienceListItem {
  /** Raw targeting object as Meta returned it. Sent verbatim to the destination. */
  targeting: unknown;
}

/**
 * List Saved Audiences on `adAccountId`, including each audience's full
 * `targeting` spec. Used by both the source picker (display) and the clone
 * POST handler (read source, then write to destination).
 *
 * Single paginated request — `limit=200` is the practical cap for Saved
 * Audience libraries (most ad accounts have well under 100).
 */
export async function listSavedAudiencesWithTargeting(
  token: string,
  adAccountId: string,
): Promise<SavedAudienceWithTargeting[]> {
  const accountPath = withActPrefix(adAccountId);
  const json = await graphGetWithToken<Record<string, unknown>>(
    `/${accountPath}/saved_audiences`,
    {
      fields: "id,name,description,targeting,time_updated,time_created",
      limit: "200",
    },
    token,
  );

  const base = parseSavedAudienceListResponse(json);
  // Re-walk the raw data so each item picks up its `targeting` field. The pure
  // parser intentionally doesn't carry targeting to keep its surface small.
  const rawData = (json.data ?? []) as Array<{
    id: string;
    targeting?: unknown;
  }>;
  const targetingById = new Map<string, unknown>();
  for (const row of rawData) {
    if (row && typeof row === "object" && typeof row.id === "string") {
      targetingById.set(row.id, row.targeting);
    }
  }

  return base.map((item) => ({
    ...item,
    targeting: targetingById.get(item.id),
  }));
}

/**
 * Return the set of Saved Audience names that already exist on `adAccountId`.
 * Used to pre-check for name collisions on the destination before posting —
 * Meta will reject duplicates with an error_user_msg, but pre-checking lets
 * us label each failed cell with a clean "name already exists" rather than
 * surfacing Meta's raw "Validation error" string.
 */
export async function listSavedAudienceNames(
  token: string,
  adAccountId: string,
): Promise<Set<string>> {
  const accountPath = withActPrefix(adAccountId);
  const json = await graphGetWithToken<Record<string, unknown>>(
    `/${accountPath}/saved_audiences`,
    { fields: "id,name", limit: "200" },
    token,
  );
  const items = parseSavedAudienceListResponse(json);
  return new Set(items.map((i) => i.name));
}

/**
 * POST a Saved Audience to a destination ad account. The targeting spec is
 * sent JSON-stringified (Meta's saved_audiences edge requires this — it
 * rejects nested objects in form-encoded params).
 *
 * Mutation paths stay single-shot: no retries inside this call. Per-cell
 * try/catch in the route handler is the right granularity — one duplicate
 * name shouldn't abort the batch.
 *
 * Throws `MetaApiError` on Meta-side rejection so the caller can branch on
 * `.code`, `.subcode`, and `.message` for accurate per-cell failure reasons.
 */
export async function createSavedAudienceOnDestination(
  token: string,
  destAdAccountId: string,
  source: { name: string; description?: string | null; targeting: unknown },
): Promise<{ id: string }> {
  const params = buildSavedAudienceCreateParams(source);
  const accountPath = withActPrefix(destAdAccountId);
  const url = new URL(`${BASE}/${accountPath}/saved_audiences`);
  url.searchParams.set("access_token", token);

  const formBody = new URLSearchParams(params);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`Network error calling Meta API: ${String(err)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    throw new MetaApiError(
      (e.message as string) ?? `HTTP ${response.status}`,
      e.code as number | undefined,
      e.type as string | undefined,
      e.fbtrace_id as string | undefined,
      e.error_subcode as number | undefined,
      (e.error_user_msg ?? e.error_user_title) as string | undefined,
      e as Record<string, unknown>,
    );
  }

  const result = json as { id?: string };
  if (!result.id) {
    throw new Error("Meta did not return an id for the created Saved Audience");
  }
  return { id: result.id };
}
