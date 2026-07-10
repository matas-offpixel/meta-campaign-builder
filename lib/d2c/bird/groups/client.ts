/**
 * lib/d2c/bird/groups/client.ts
 *
 * Typed client for Bird's group/list API. CONFIRMED, standalone — no
 * JOURNEY_CREATE_VERIFIED gate needed here.
 *
 * Discovery (2026-07-10, read-only probe, see
 * docs/D2C_BIRD_FLOW_AUTOMATION_INVESTIGATION.md): `/workspaces/{ws}/groups`
 * and `/workspaces/{ws}/lists` are the SAME underlying resource, dual-mounted
 * on two path aliases (`GET /lists/{id}` and `GET /groups/{id}` both return
 * 200 for the same id). This client standardises on `/groups` — the path
 * exercised by the CONFIRMED create probe (probe #1, 2026-07-09) — as the one
 * shared implementation for both the new Journey trigger-group resolution and
 * the existing WhatsApp poll cron's audience-list resolution
 * (`app/api/cron/d2c-autoresp-poll-bird/route.ts`), which previously
 * duplicated this lookup inline against `/lists`. One resolver, one behaviour
 * — no risk of the two callers silently diverging onto different objects.
 */

import { birdJson } from "../client.ts";

export interface BirdGroupClientConfig {
  apiKey: string;
  workspaceId: string;
}

export interface BirdGroup {
  id: string;
  name: string;
  description?: string;
  contactCount?: number;
  isProof?: boolean;
}

function groupsPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/groups`;
}

/** Bird list responses vary in envelope key; normalise to an array. */
function unwrapList<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    const r = (json as Record<string, unknown>).results;
    if (Array.isArray(r)) return r as T[];
  }
  return [];
}

export async function listGroups(
  cfg: BirdGroupClientConfig,
  limit = 100,
): Promise<BirdGroup[]> {
  const capped = Math.min(limit, 100);
  const json = await birdJson<unknown>(
    cfg.apiKey,
    `${groupsPath(cfg.workspaceId)}?limit=${capped}`,
    { method: "GET" },
  );
  return unwrapList<BirdGroup>(json);
}

export async function getGroup(
  cfg: BirdGroupClientConfig,
  groupId: string,
): Promise<BirdGroup> {
  return birdJson<BirdGroup>(
    cfg.apiKey,
    `${groupsPath(cfg.workspaceId)}/${groupId}`,
    { method: "GET" },
  );
}

/**
 * Shared lookup — replaces the ad-hoc `/lists` name-match previously inlined
 * in the poll cron. Same semantics: trimmed, case-insensitive match on
 * `audience.tag`.
 */
export async function findGroupByName(
  cfg: BirdGroupClientConfig,
  name: string,
): Promise<BirdGroup | null> {
  const target = name.trim().toLowerCase();
  const list = await listGroups(cfg);
  return list.find((g) => g.name.trim().toLowerCase() === target) ?? null;
}

/** CONFIRMED — POST /workspaces/{ws}/groups { name } -> 201 (probe #1, 2026-07-09). */
export async function createGroup(
  cfg: BirdGroupClientConfig,
  name: string,
): Promise<BirdGroup> {
  return birdJson<BirdGroup>(cfg.apiKey, groupsPath(cfg.workspaceId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export interface ResolveOrCreateGroupResult {
  group: BirdGroup;
  existed: boolean;
}

/** Idempotency: never mint a duplicate group for the same event tag. */
export async function resolveOrCreateGroup(
  cfg: BirdGroupClientConfig,
  name: string,
): Promise<ResolveOrCreateGroupResult> {
  const existing = await findGroupByName(cfg, name);
  if (existing) return { group: existing, existed: true };
  const created = await createGroup(cfg, name);
  return { group: created, existed: false };
}
