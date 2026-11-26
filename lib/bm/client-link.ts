/**
 * lib/bm/client-link.ts — which Business Manager connection
 * (client_business_managers, the BM tool's) belongs to which clients (M3c,
 * several clients per BM since 276).
 *
 * A client's Business Manager is the owner business of its ad accounts
 * (GET /act_{id}?fields=business): the client's own meta_ad_account_id, its
 * events' and its venues'. Pure: the script (scripts/link-client-business-managers.mts)
 * does the reads and, with --apply, the writes (client_business_manager_links
 * rows; client_business_managers.client_id only for a BM with one client
 * and none set).
 *
 *   - linked: every connected business that owns one of the client's
 *     accounts. One business may serve several clients (Matas, 27 Nov: LWE
 *     links to both Junction 2 and Ironworks); each is its own link, and
 *     `sharedWith` says how many other clients that business serves here;
 *   - not linked, with the reason: no ad account; no account could be read;
 *     the accounts are in no business; the owner business is Off/Pixel's
 *     (an agency-owned account: the client's own BM isn't knowable from it,
 *     and access is never asked from Off/Pixel's); the owner business isn't
 *     connected in the BM tool.
 *
 * Relative imports only (node:test).
 */

import { OFF_PIXEL_BUSINESS_IDS } from "../meta/page-access-request.ts";

/** Off/Pixel's own businesses (one constant, the access helper's): never a client's. */
export { OFF_PIXEL_BUSINESS_IDS };

export interface LinkClient {
  id: string;
  name: string;
  accounts: string[];
  /** clients.meta_business_id, compared only. */
  storedBusinessId: string | null;
}

export interface Connected {
  businessId: string;
  name: string;
  /** client_business_managers.client_id: the primary client. */
  clientId: string | null;
  /** Clients linked already (the primary client and client_business_manager_links rows). */
  linkedClientIds?: readonly string[];
}

export type AccountOwner = { id: string; name: string | null } | null | "unread";

export type LinkReason = "no_ad_account" | "accounts_unread" | "no_owner_business" | "owner_is_off_pixel" | "owner_not_connected";

export interface PlannedLink {
  clientId: string;
  client: string;
  businessId: string;
  business: string;
  /** This client is linked to this business already. */
  already: boolean;
  /** How many other clients this business serves in this plan. */
  sharedWith: number;
  accounts: string[];
  storedBusinessMatches: boolean | null;
}

export interface LinkPlan {
  links: PlannedLink[];
  unlinked: { clientId: string; client: string; reason: LinkReason; detail: string }[];
}

export function planClientLinks(clients: readonly LinkClient[], owners: ReadonlyMap<string, AccountOwner>, connected: readonly Connected[]): LinkPlan {
  const byBusiness = new Map(connected.map((c) => [c.businessId, c]));
  const ownersOf = new Map<string, Map<string, { name: string | null; accounts: string[] }>>();
  for (const c of clients) {
    const m = new Map<string, { name: string | null; accounts: string[] }>();
    for (const a of c.accounts) {
      const o = owners.get(a);
      if (!o || o === "unread") continue;
      const have = m.get(o.id) ?? { name: o.name, accounts: [] };
      have.accounts.push(a);
      m.set(o.id, have);
    }
    ownersOf.set(c.id, m);
  }

  const plan: LinkPlan = { links: [], unlinked: [] };
  for (const c of clients) {
    const no = (reason: LinkReason, detail: string) => plan.unlinked.push({ clientId: c.id, client: c.name, reason, detail });
    if (c.accounts.length === 0) {
      no("no_ad_account", "no ad account on the client, its events or its venues");
      continue;
    }
    const read = c.accounts.filter((a) => owners.get(a) !== "unread" && owners.has(a));
    if (read.length === 0) {
      no("accounts_unread", `${c.accounts.length} account(s), none readable with the token`);
      continue;
    }
    const m = ownersOf.get(c.id)!;
    if (m.size === 0) {
      no("no_owner_business", `${read.length} account(s) in no business`);
      continue;
    }
    const outside = [...m.keys()].filter((b) => !OFF_PIXEL_BUSINESS_IDS.includes(b));
    if (outside.length === 0) {
      no("owner_is_off_pixel", `${[...m.values()].reduce((s, v) => s + v.accounts.length, 0)} account(s) owned by Off/Pixel's business`);
      continue;
    }
    let linked = 0;
    const missing: string[] = [];
    for (const b of outside) {
      const info = m.get(b)!;
      const conn = byBusiness.get(b);
      if (!conn) {
        missing.push(`${info.name ?? b} (${b}) isn't connected in the BM tool`);
        continue;
      }
      linked += 1;
      const already = conn.clientId === c.id || (conn.linkedClientIds ?? []).includes(c.id);
      plan.links.push({ clientId: c.id, client: c.name, businessId: b, business: conn.name, already, sharedWith: 0, accounts: info.accounts, storedBusinessMatches: c.storedBusinessId ? c.storedBusinessId === b : null });
    }
    if (linked === 0) no("owner_not_connected", missing.join("; "));
  }
  const perBusiness = new Map<string, number>();
  for (const l of plan.links) perBusiness.set(l.businessId, (perBusiness.get(l.businessId) ?? 0) + 1);
  for (const l of plan.links) l.sharedWith = (perBusiness.get(l.businessId) ?? 1) - 1;
  return plan;
}

/**
 * --apply's writes for a plan: a link row per new (business, client), and
 * client_business_managers.client_id only for a business with exactly one
 * client in the plan and no client set (the primary client the BM tool reads).
 */
export function linkWrites(plan: LinkPlan, connected: readonly Connected[]): { links: { business_id: string; client_id: string }[]; primary: { business_id: string; client_id: string }[] } {
  const byBusiness = new Map(connected.map((c) => [c.businessId, c]));
  const links = plan.links.filter((l) => !l.already).map((l) => ({ business_id: l.businessId, client_id: l.clientId }));
  const primary = plan.links.filter((l) => l.sharedWith === 0 && !byBusiness.get(l.businessId)?.clientId).map((l) => ({ business_id: l.businessId, client_id: l.clientId }));
  return { links, primary };
}
