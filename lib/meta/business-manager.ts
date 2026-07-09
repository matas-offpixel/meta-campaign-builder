/**
 * lib/meta/business-manager.ts
 *
 * Server-only Meta Graph API helpers for the Business Manager Asset Sync tool
 * (V1 — Pages only). Every call runs as the OPERATOR (Matas's personal OAuth
 * token) — never the shared META_ACCESS_TOKEN.
 *
 * Retry policy: reuses `graphGetWithToken` / `graphPostWithToken` from
 * `lib/meta/client.ts` verbatim, so the split transient-vs-rate-limit budget is
 * inherited (GET reads retry with backoff; POST grants stay single-shot). Do NOT
 * add a bespoke retry loop here — that would collapse the two policies the client
 * intentionally keeps separate.
 *
 * Import ONLY from Route Handlers / cron routes — never from client components.
 */

import {
  graphGetWithToken,
  graphPostWithToken,
  MetaApiError,
} from "./client.ts";
import type { BMPageRole } from "@/lib/bm/types";
import { buildGrantUserPagePermissionRequest } from "./business-manager-grant-request.ts";

const PAGE_LIMIT = "100";

interface GraphPaged<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/**
 * Walk every page of a cursor-paginated edge, accumulating `data`.
 * Hard cap on iterations so a pathological `next` loop can't run forever.
 */
async function paginateAll<T>(
  path: string,
  baseParams: Record<string, string>,
  token: string,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let i = 0; i < maxPages; i += 1) {
    const params: Record<string, string> = { ...baseParams, limit: PAGE_LIMIT };
    if (after) params.after = after;
    const res = await graphGetWithToken<GraphPaged<T>>(path, params, token);
    for (const row of res.data ?? []) out.push(row);
    const next = res.paging?.next;
    after = res.paging?.cursors?.after;
    if (!next || !after) break;
  }
  return out;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MetaBusiness {
  id: string;
  name?: string;
}

export interface MetaBMPage {
  id: string;
  name?: string;
  category?: string;
  fan_count?: number;
  picture?: { data?: { url?: string } };
}

export interface MetaAccessiblePage {
  id: string;
  name?: string;
  /** Roles the token owner holds on the page (e.g. MANAGE, ADVERTISE, …). */
  tasks?: string[];
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** GET /me/businesses — the Business Managers the token owner is a member of. */
export async function listBusinessManagers(token: string): Promise<MetaBusiness[]> {
  return paginateAll<MetaBusiness>("/me/businesses", { fields: "id,name" }, token);
}

/** GET /{bizId}/owned_pages — pages owned directly by the BM. */
export async function listOwnedPages(
  bizId: string,
  token: string,
): Promise<MetaBMPage[]> {
  return paginateAll<MetaBMPage>(
    `/${bizId}/owned_pages`,
    { fields: "id,name,category,fan_count,picture{url}" },
    token,
  );
}

/** GET /{bizId}/client_pages — pages shared into the BM by clients. */
export async function listClientPages(
  bizId: string,
  token: string,
): Promise<MetaBMPage[]> {
  return paginateAll<MetaBMPage>(
    `/${bizId}/client_pages`,
    { fields: "id,name,category,fan_count,picture{url}" },
    token,
  );
}

/**
 * GET /me/accounts?fields=id,tasks — pages the token owner personally has a
 * direct user role on. Used to compute `user_has_access` for each BM page.
 */
export async function listUserAccessiblePages(
  token: string,
): Promise<MetaAccessiblePage[]> {
  return paginateAll<MetaAccessiblePage>(
    "/me/accounts",
    { fields: "id,name,tasks" },
    token,
  );
}

/** GET /me?fields=id — the token owner's (app-scoped) Meta user id, for grants. */
export async function getMetaUserId(token: string): Promise<string> {
  const res = await graphGetWithToken<{ id?: string }>("/me", { fields: "id" }, token);
  if (!res.id) {
    throw new MetaApiError("Could not resolve Meta user id from /me");
  }
  return res.id;
}

// ─── Grant (mutation — single-shot, no retry) ─────────────────────────────────

/**
 * POST /{pageId}/assigned_users — grant `targetUserId` a role on the page.
 * V1 always passes role = ADVERTISER (→ tasks: ["ADVERTISE"]). See
 * `business-manager-grant-request.ts` for the request-building logic (kept
 * pure + separate so it's unit-testable without pulling in client.ts) and
 * for the regression notes on why this is NOT
 * `/{bizId}/pages/{pageId}/user_permissions`.
 *
 * `bizId` is REQUIRED — Meta's assigned_users edge rejects the call with
 * code 100 "Invalid parameter" without a `business` field in the body, even
 * though the path itself has no business id segment (see the 2026-07-09
 * regression note in `business-manager-grant-request.ts`).
 *
 * Single-shot (graphPostWithToken) on purpose — mutations must not retry.
 * Throws MetaApiError on failure; the caller inspects `.subcode === 190` to flag
 * an expired token.
 */
export async function grantUserPagePermission(
  bizId: string,
  pageId: string,
  targetUserId: string,
  role: BMPageRole,
  token: string,
): Promise<{ success?: boolean; id?: string }> {
  const { path, body } = buildGrantUserPagePermissionRequest(pageId, bizId, targetUserId, role);
  console.log(
    `[bm grant] biz=${bizId} page=${pageId} user=${targetUserId} tasks=${body.tasks.join(",")}`,
  );
  return graphPostWithToken<{ success?: boolean; id?: string }>(path, body, token);
}
