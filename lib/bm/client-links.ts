/**
 * lib/bm/client-links.ts — which clients a connected Business Manager
 * belongs to (migration 276).
 *
 * A BM's clients are its client_business_managers.client_id (the primary
 * client, as before) and every client_business_manager_links row for it, so
 * one BM can serve several clients (LWE: Junction 2 and Ironworks). Until
 * 276 is applied the link table is missing and the primary client alone is
 * read, as before.
 *
 * Reads only. Relative imports only (node:test).
 */

type Db = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface BusinessClientLink {
  business_id: string;
  client_id: string;
}

const missingTable = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === "PGRST205" || e.code === "42P01" || /does not exist|schema cache|could not find the table/i.test(e.message ?? "")));

/** Every (business, client) pair for these businesses or these clients: the primary client and the link rows, deduped. */
export async function businessClientLinks(db: Db, by: { businessIds?: readonly string[]; clientIds?: readonly string[] }): Promise<BusinessClientLink[]> {
  const out = new Map<string, BusinessClientLink>();
  const add = (business_id: unknown, client_id: unknown) => {
    if (typeof business_id !== "string" && typeof business_id !== "number") return;
    if (typeof client_id !== "string" || !client_id) return;
    const b = String(business_id);
    out.set(`${b}|${client_id}`, { business_id: b, client_id });
  };
  const col = by.businessIds ? "business_id" : "client_id";
  const values = [...new Set((by.businessIds ?? by.clientIds ?? []).map(String))];
  for (let i = 0; i < values.length; i += 200) {
    const chunk = values.slice(i, i + 200);
    const primary = await db.from("client_business_managers").select("business_id, client_id").in(col, chunk);
    if (primary.error) throw new Error(`client_business_managers: ${primary.error.message}`);
    for (const r of (primary.data ?? []) as { business_id: string; client_id: string | null }[]) add(r.business_id, r.client_id);
    const links = await db.from("client_business_manager_links").select("business_id, client_id").in(col, chunk);
    if (links.error && !missingTable(links.error)) throw new Error(`client_business_manager_links: ${links.error.message}`);
    for (const r of (links.error ? [] : links.data ?? []) as { business_id: string; client_id: string }[]) add(r.business_id, r.client_id);
  }
  return [...out.values()];
}

/** Business id → its client ids. */
export function clientsByBusiness(links: readonly BusinessClientLink[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const l of links) (m.get(l.business_id) ?? m.set(l.business_id, new Set()).get(l.business_id)!).add(l.client_id);
  return m;
}

/**
 * The BM scan's archived-client rule with several clients (lib/db/client-status.ts):
 * a BM is left out only when it has clients and every one is archived; a BM
 * with no client is kept, as rows with no client are everywhere else.
 */
export function keepForScan<T extends { business_id: string }>(bms: readonly T[], links: readonly BusinessClientLink[], archived: ReadonlySet<string>): T[] {
  const by = clientsByBusiness(links);
  return bms.filter((bm) => {
    const clients = by.get(bm.business_id);
    return !clients || clients.size === 0 || [...clients].some((c) => !archived.has(c));
  });
}
