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

// ── List membership (contacts in a list) ────────────────────────────────────
//
// Endpoint + contact shape verified against Bird Contacts API docs
// (2026-07-14, "List contacts in a list"):
//   GET /workspaces/{ws}/lists/{listId}/contacts?limit=100
//     -> { results: [ { id, computedDisplayName, featuredIdentifiers: [
//            { key: "phonenumber" | "emailaddress", value } ],
//            attributes: { phonenumber: [...], emailaddress: [...], ... },
//            listIds: [...] } ] }
// Groups and lists are the same dual-mounted resource (see file header), so a
// group id resolved via findGroupByName is a valid {listId} here.
//
// Why this exists: Bird's channels /messages endpoint has NO list-targeting
// field — a `receiver.contacts[].listId` is rejected 422 "property listId is
// unsupported" (live-verified 2026-07-14, T26-ALGARVE). The only supported way
// to send to a whole list is to resolve its members to individual phone
// identifiers and send one message each (see provider.ts fan-out).

export interface BirdContactIdentifier {
  key: string;
  value: string;
}

export interface BirdContact {
  id: string;
  computedDisplayName?: string;
  featuredIdentifiers?: BirdContactIdentifier[];
  attributes?: Record<string, unknown>;
  listIds?: string[];
}

function contactsInListPath(workspaceId: string, listId: string): string {
  return `/workspaces/${workspaceId}/lists/${listId}/contacts`;
}

/** Read a "next page" cursor from a Bird list envelope, tolerating field-name variance. */
function readNextPageToken(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  for (const k of ["nextPageToken", "pageToken", "next"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  // Some Bird envelopes nest pagination under `pagination` / `meta`.
  for (const wrap of ["pagination", "meta"]) {
    const w = o[wrap];
    if (w && typeof w === "object") {
      const t = readNextPageToken(w);
      if (t) return t;
    }
  }
  return null;
}

/**
 * List all contacts in a Bird list/group, following pagination.
 *
 * Pagination note: the page size (`limit`, max 100) and the `results` envelope
 * are docs-confirmed; the exact next-cursor field name is NOT (the docs sample
 * shows a single page). `readNextPageToken` therefore checks several common
 * shapes and the loop hard-stops if the cursor repeats or is absent, so a
 * wrong cursor field degrades to "first 100 only" rather than looping — a
 * flagged limitation to confirm on the live smoke test, not a crash. Callers
 * dedupe identifiers downstream, so a repeated page is harmless.
 */
export async function listContactsInList(
  cfg: BirdGroupClientConfig,
  listId: string,
  opts: { pageLimit?: number; maxPages?: number } = {},
): Promise<BirdContact[]> {
  const pageLimit = Math.min(Math.max(opts.pageLimit ?? 100, 1), 100);
  const maxPages = Math.max(opts.maxPages ?? 200, 1);
  const out: BirdContact[] = [];
  let pageToken: string | null = null;
  const seenTokens = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ limit: String(pageLimit) });
    if (pageToken) qs.set("pageToken", pageToken);
    const json = await birdJson<unknown>(
      cfg.apiKey,
      `${contactsInListPath(cfg.workspaceId, listId)}?${qs.toString()}`,
      { method: "GET" },
    );
    out.push(...unwrapList<BirdContact>(json));
    const next = readNextPageToken(json);
    if (!next || seenTokens.has(next)) break;
    seenTokens.add(next);
    pageToken = next;
  }
  return out;
}

/**
 * Extract phone-number identifiers from a Bird contact. Bird keys phone
 * identifiers as `phonenumber` (mirrors the `emailaddress` key in the docs
 * sample) in both `featuredIdentifiers[]` and the `attributes` map. Values are
 * returned trimmed and in featured-then-attribute order; callers dedupe.
 */
export function contactPhoneIdentifiers(contact: BirdContact): string[] {
  const phones: string[] = [];
  for (const fi of contact.featuredIdentifiers ?? []) {
    if (
      fi &&
      fi.key === "phonenumber" &&
      typeof fi.value === "string" &&
      fi.value.trim()
    ) {
      phones.push(fi.value.trim());
    }
  }
  const attrs = contact.attributes;
  if (attrs && typeof attrs === "object") {
    const p = (attrs as Record<string, unknown>).phonenumber;
    if (Array.isArray(p)) {
      for (const v of p) {
        if (typeof v === "string" && v.trim()) phones.push(v.trim());
      }
    }
  }
  return phones;
}
