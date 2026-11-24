/**
 * Electric's customer lists, as Meta holds them (ops, 24 Nov, on #1363):
 * read-only GETs on /act_{id}/customaudiences, every page, every request
 * counted. Nothing here writes, shares or uploads.
 *
 * Which account holds a list: the audience's own `account_id` (its owner).
 * A list that shows in another account's listing with a different owner is
 * shared to that account. A list Meta returns without `account_id` counts
 * as held by the account whose listing returned it.
 *
 * Pure apart from `fetchAccountAudiences`, which takes its fetch. No `@/`
 * imports, so node --test can load it.
 */

import { normalizeAccount, type KnownAudience } from "./resolve.ts";
import type { GenrePoolKey } from "../learning/genre/families.ts";

export const LIST_FIELDS = [
  "id",
  "name",
  "subtype",
  "account_id",
  "approximate_count_lower_bound",
  "approximate_count_upper_bound",
  "operation_status",
  "time_updated",
] as const;

/** Only this edge, only GET. */
export const CUSTOM_AUDIENCES_PATH = /^\/v\d+\.\d+\/act_\d+\/customaudiences$/;

export function isAllowedGraphRead(url: string, method: string | undefined): boolean {
  if ((method ?? "GET").toUpperCase() !== "GET") return false;
  try {
    const u = new URL(url);
    return u.hostname === "graph.facebook.com" && CUSTOM_AUDIENCES_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

export interface GraphAudience {
  id: string;
  name: string;
  subtype: string | null;
  /** The owner account, `act_…`, or null when Meta didn't say. */
  ownerAccount: string | null;
  countLower: number | null;
  countUpper: number | null;
  operationCode: number | null;
  operationDescription: string | null;
  timeUpdated: string | null;
}

export function parseAudience(raw: Record<string, unknown>): GraphAudience | null {
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const op = (raw.operation_status ?? null) as { code?: unknown; description?: unknown } | null;
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
  const t = raw.time_updated;
  return {
    id: raw.id,
    name: raw.name,
    subtype: typeof raw.subtype === "string" ? raw.subtype : null,
    ownerAccount: normalizeAccount(typeof raw.account_id === "string" ? raw.account_id : null),
    countLower: num(raw.approximate_count_lower_bound),
    countUpper: num(raw.approximate_count_upper_bound),
    operationCode: num(op?.code),
    operationDescription: typeof op?.description === "string" ? op.description : null,
    timeUpdated: typeof t === "number" ? new Date(t * 1000).toISOString() : typeof t === "string" ? t : null,
  };
}

export interface AccountListing {
  accountId: string;
  audiences: GraphAudience[];
  requests: number;
  error: string | null;
}

/**
 * Every page of one account's custom audiences. One attempt per request,
 * each counted. The token goes in the query and is never returned or logged.
 */
export async function fetchAccountAudiences(
  accountId: string,
  opts: { token: string; version: string; fetch: typeof fetch; pageSize?: number; maxPages?: number },
): Promise<AccountListing> {
  const out: AccountListing = { accountId, audiences: [], requests: 0, error: null };
  const first = new URL(`https://graph.facebook.com/${opts.version}/${accountId}/customaudiences`);
  first.searchParams.set("fields", LIST_FIELDS.join(","));
  first.searchParams.set("limit", String(opts.pageSize ?? 200));
  first.searchParams.set("access_token", opts.token);
  let next: string | null = first.toString();
  for (let page = 0; next && page < (opts.maxPages ?? 50); page += 1) {
    out.requests += 1;
    let body: { data?: unknown; paging?: { next?: unknown }; error?: { message?: unknown; code?: unknown } };
    try {
      const res = await opts.fetch(next, { method: "GET" });
      body = (await res.json()) as typeof body;
      if (!res.ok || body.error) {
        out.error = `HTTP ${res.status}${body.error ? ` · code ${String(body.error.code)} · ${String(body.error.message)}` : ""}`;
        return out;
      }
    } catch (err) {
      out.error = err instanceof Error ? err.message.replace(/access_token=[^&\s]+/g, "access_token=…") : String(err);
      return out;
    }
    for (const raw of Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : []) {
      const a = parseAudience(raw);
      if (a) out.audiences.push(a);
    }
    next = typeof body.paging?.next === "string" && isAllowedGraphRead(body.paging.next, "GET") ? body.paging.next : null;
  }
  return out;
}

// ─── The lists ops named ───────────────────────────────────────────────────

export interface NamedList {
  /** As ops wrote it. */
  name: string;
  /** The template family it stands for; null for the all-genre list. */
  family: GenrePoolKey | null;
  /** In templates, or a per-show list kept out of them. */
  use: "template" | "per_show";
}

export const NAMED_LISTS: readonly NamedList[] = [
  { name: "NX LOVES DATA CSV", family: null, use: "template" },
  { name: "Tech House Data", family: "house_tech", use: "template" },
  { name: "Disco House Data", family: "disco", use: "template" },
  { name: "Commercial House Data", family: "commercial", use: "template" },
  { name: "Garage & Grime Data", family: "garage_bass", use: "template" },
  { name: "DnB Data", family: "dnb", use: "template" },
  { name: "Techno Data", family: "techno", use: "template" },
  // Trance and hard dance: the hard end of the techno template.
  { name: "Trance & Hard Dance", family: "hard_techno", use: "template" },
  { name: "Ewan McVicar Signups - Tech House / Disco", family: null, use: "per_show" },
  { name: "Locklead Tech House Data", family: null, use: "per_show" },
  { name: "azyr-newcastle-signups-2026-09-18.csv", family: null, use: "per_show" },
];

/** Ops' mapping (Matas confirms), by template name. */
export const TEMPLATE_LISTS: Record<string, readonly string[]> = {
  "House & disco": ["NX LOVES DATA CSV", "Tech House Data", "Disco House Data"],
  "House & garage": ["NX LOVES DATA CSV", "Tech House Data", "Garage & Grime Data", "DnB Data", "Techno Data"],
  Techno: ["NX LOVES DATA CSV", "Techno Data", "Trance & Hard Dance"],
  "Commercial house": ["NX LOVES DATA CSV", "Commercial House Data", "Tech House Data", "Disco House Data", "DnB Data"],
};

export function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * The Meta audiences that are this list: the same name, ignoring case,
 * spacing and punctuation, or the name followed by more (Meta shows
 * "NX LOVES DATA CSV" with a label after it). Customer lists only
 * (subtype CUSTOM) when Meta says the subtype.
 */
export function matchList(list: NamedList, audiences: GraphAudience[]): GraphAudience[] {
  const key = nameKey(list.name);
  return audiences.filter((a) => {
    if (a.subtype && a.subtype !== "CUSTOM") return false;
    const k = nameKey(a.name);
    return k === key || (k.startsWith(key) && list.use === "template" && key.length >= 8);
  });
}

export interface ListPlacement {
  list: NamedList;
  /** The audience (one id) and the account that holds it. */
  id: string | null;
  metaName: string | null;
  holder: string | null;
  /** Other accounts whose listing shows it (shared to them). */
  sharedTo: string[];
  countLower: number | null;
  countUpper: number | null;
  timeUpdated: string | null;
  operation: string | null;
  /** Meta's status reads as outdated or expiring. */
  outdated: boolean;
  /** More than one Meta audience matched the name: the most recently updated is used. */
  alsoMatched: string[];
}

const OUTDATED = /outdated|expir|not been updated|hasn.t been updated|inactive|out of date/i;

/** Where each named list lives, from the accounts' listings. */
export function placeLists(listings: AccountListing[], lists: readonly NamedList[] = NAMED_LISTS): ListPlacement[] {
  return lists.map((list) => {
    // id → which listings showed it, and what Meta said its owner was.
    const seen = new Map<string, { a: GraphAudience; in: Set<string> }>();
    for (const l of listings) {
      for (const a of matchList(list, l.audiences)) {
        const hit = seen.get(a.id) ?? { a, in: new Set<string>() };
        hit.in.add(l.accountId);
        seen.set(a.id, hit);
      }
    }
    const all = [...seen.values()].sort((x, y) => (y.a.timeUpdated ?? "").localeCompare(x.a.timeUpdated ?? "") || x.a.id.localeCompare(y.a.id));
    const best = all[0];
    if (!best) {
      return { list, id: null, metaName: null, holder: null, sharedTo: [], countLower: null, countUpper: null, timeUpdated: null, operation: null, outdated: false, alsoMatched: [] };
    }
    const shownIn = [...best.in].sort();
    const holder = best.a.ownerAccount ?? (shownIn.length === 1 ? shownIn[0]! : null);
    const op = best.a.operationDescription ?? (best.a.operationCode != null ? String(best.a.operationCode) : null);
    return {
      list,
      id: best.a.id,
      metaName: best.a.name,
      holder,
      sharedTo: shownIn.filter((a) => a !== holder),
      countLower: best.a.countLower,
      countUpper: best.a.countUpper,
      timeUpdated: best.a.timeUpdated,
      operation: op,
      outdated: Boolean(op && OUTDATED.test(op)),
      alsoMatched: all.slice(1).map((x) => x.a.id),
    };
  });
}

// ─── What the dry run knows, and what --apply registers ────────────────────

/** Every account that can use each found list: its holder and the accounts it's shared to. */
export function placementAccounts(p: ListPlacement): string[] {
  return p.id ? [...new Set([p.holder, ...p.sharedTo].filter((a): a is string => Boolean(a)))] : [];
}

/** The found lists as known audiences, in each account that can use them (the dry run's view). */
export function knownFromPlacements(placements: ListPlacement[]): KnownAudience[] {
  return placements.flatMap((p) =>
    placementAccounts(p).map((accountId): KnownAudience => ({
      source: "meta",
      metaAudienceId: p.id!,
      accountId,
      subtype: "customer_list",
      listRole: null,
      familyKey: p.list.family,
    })),
  );
}

/**
 * The meta_custom_audiences rows --apply writes so the existing audience
 * picker sees the template lists: one per list per account that can use it,
 * skipping one already registered there. The shape is the only customer-list
 * writer's (lib/retargeting/list-row.ts listRowPayload: funnel_stage
 * retargeting, retention_days null, source_id = the Meta id, status ready),
 * with no show (event_id null) and no role (list_role null), as ops asked.
 * Names and ids only: never a count of who's on it.
 */
export function listRegisterRows(
  placements: ListPlacement[],
  opts: { userId: string; clientId: string; registered: ReadonlySet<string> },
): Array<Record<string, unknown>> {
  return placements
    .filter((p) => p.list.use === "template" && p.id)
    .flatMap((p) =>
      placementAccounts(p)
        .filter((accountId) => !opts.registered.has(`${p.id}|${accountId}`))
        .map((accountId) => ({
          user_id: opts.userId,
          client_id: opts.clientId,
          event_id: null,
          name: p.metaName ?? p.list.name,
          funnel_stage: "retargeting",
          audience_subtype: "customer_list",
          list_role: null,
          retention_days: null,
          source_id: p.id,
          source_meta: { subtype: "customer_list", heldIn: p.holder, ...(p.holder !== accountId ? { sharedFrom: p.holder } : {}) },
          meta_audience_id: p.id,
          meta_ad_account_id: accountId,
          status: "ready",
          status_error: null,
        })),
    );
}
