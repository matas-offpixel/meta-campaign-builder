/**
 * lib/bm/client-link.ts — which Business Manager connection
 * (client_business_managers, the BM tool's) belongs to which client (M3c).
 *
 * A client's Business Manager is the owner business of its ad accounts
 * (GET /act_{id}?fields=business): the client's own meta_ad_account_id, its
 * events' and its venues'. Pure: the script (scripts/link-client-business-managers.mts)
 * does the reads and, with --apply, the one write (client_business_managers.client_id).
 *
 *   - linked: every connected business that owns one of the client's
 *     accounts, unless another client's accounts are owned by it too, or it
 *     is already linked to another client (never overwritten);
 *   - not linked, with the reason: no ad account; no account could be read;
 *     the accounts are in no business; the owner business is Off/Pixel's
 *     (an agency-owned account: the client's own BM isn't knowable from it);
 *     the owner business isn't connected in the BM tool; shared with
 *     another client; already linked elsewhere.
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
  clientId: string | null;
}

export type AccountOwner = { id: string; name: string | null } | null | "unread";

export type LinkReason =
  | "no_ad_account"
  | "accounts_unread"
  | "no_owner_business"
  | "owner_is_off_pixel"
  | "owner_not_connected"
  | "owner_shared_with_other_client"
  | "already_linked_to_other_client";

export interface LinkPlan {
  links: { clientId: string; client: string; businessId: string; business: string; already: boolean; accounts: string[]; storedBusinessMatches: boolean | null }[];
  unlinked: { clientId: string; client: string; reason: LinkReason; detail: string }[];
}

export function planClientLinks(clients: readonly LinkClient[], owners: ReadonlyMap<string, AccountOwner>, connected: readonly Connected[]): LinkPlan {
  const byBusiness = new Map(connected.map((c) => [c.businessId, c]));
  // Each client's owner businesses, and which clients each business owns accounts for.
  const ownersOf = new Map<string, Map<string, { name: string | null; accounts: string[] }>>();
  const clientsOf = new Map<string, Set<string>>();
  for (const c of clients) {
    const m = new Map<string, { name: string | null; accounts: string[] }>();
    for (const a of c.accounts) {
      const o = owners.get(a);
      if (!o || o === "unread") continue;
      const have = m.get(o.id) ?? { name: o.name, accounts: [] };
      have.accounts.push(a);
      m.set(o.id, have);
      if (!OFF_PIXEL_BUSINESS_IDS.includes(o.id)) (clientsOf.get(o.id) ?? clientsOf.set(o.id, new Set()).get(o.id)!).add(c.id);
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
    const reasons: { reason: LinkReason; detail: string }[] = [];
    for (const b of outside) {
      const info = m.get(b)!;
      const conn = byBusiness.get(b);
      const label = `${info.name ?? b} (${b})`;
      if (!conn) {
        reasons.push({ reason: "owner_not_connected", detail: `${label} isn't connected in the BM tool` });
        continue;
      }
      const sharers = [...(clientsOf.get(b) ?? [])].filter((id) => id !== c.id);
      if (sharers.length) {
        reasons.push({ reason: "owner_shared_with_other_client", detail: `${label} also owns accounts of ${sharers.length} other client(s)` });
        continue;
      }
      if (conn.clientId && conn.clientId !== c.id) {
        reasons.push({ reason: "already_linked_to_other_client", detail: `${label} is linked to another client` });
        continue;
      }
      linked += 1;
      plan.links.push({ clientId: c.id, client: c.name, businessId: b, business: conn.name, already: conn.clientId === c.id, accounts: info.accounts, storedBusinessMatches: c.storedBusinessId ? c.storedBusinessId === b : null });
    }
    if (linked === 0) {
      const first = reasons[0]!;
      no(first.reason, reasons.map((r) => r.detail).join("; "));
    }
  }
  return plan;
}
