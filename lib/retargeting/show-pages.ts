/**
 * lib/retargeting/show-pages.ts — the Pages a show's Retargeting builds from
 * (TC9), matched as audience_sources matches them (fix 1, 27 Nov: the 26 Nov
 * dry run matched no Page on any show while audience_sources found NX LOVES
 * and Rudimental on NX26-RUDIMENTAL). The same code, not a copy:
 *   - the promoter's brand Pages: only the show's own brand's (Matas, 27 Nov;
 *     show-brands.ts), by name, from the client's Business Manager listing,
 *     the ad account's Pages and the Pages the show's drafts run from
 *     (promoterPageIds), each with its Instagram;
 *   - the lineup in billing order with each act's Page and Instagram from the
 *     artist library and the Lab (lineupSources); an act with no Page id
 *     takes the ad account's Page of the same name and that Page's Instagram;
 *   - the venue's Page (venues.meta_page_id);
 *   - access by the Audience Builder's own check (resolvePageAccess): in the
 *     client's Business Manager (client_business_manager_links, owned and
 *     client Pages), else the token's tasks on the Page.
 * Graph reads only (GETs through the read's graph), each cached per run.
 *
 * Relative imports only (node:test).
 */
import { lineupSources, promoterPageIds } from "../mcp/audiences/sources.ts";
import type { Db } from "../mcp/tool-types.ts";
import { resolvePageAccess } from "../meta/page-access.ts";
import type { RefreshGraph } from "../onsale-refresh/purchase-read.ts";
import type { SourcePage } from "./audiences.ts";
import type { MatchedPages } from "./funnel-plan.ts";
import { isShowBrandPage } from "./show-brands.ts";

export type PromotePage = { id: string; name: string | null; igId: string | null };

/** What one run has read already: an ad account's promote_pages, a business's Pages, a Page's access. */
export type ShowPagesCache = {
  promote: Map<string, PromotePage[] | null>;
  business: Map<string, Map<string, string>>;
  access: Map<string, { ok: boolean; name: string | null }>;
};

export const newShowPagesCache = (): ShowPagesCache => ({ promote: new Map(), business: new Map(), access: new Map() });

const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** One edge, every page of it (≤ 10 pages). */
async function edge(graph: RefreshGraph, path: string, params: Record<string, string>, count: () => void): Promise<Row[]> {
  const rows: Row[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    count();
    const body = (await graph.graphGet(path, { ...params, ...(after ? { after } : {}) })) as { data?: Row[]; paging?: { cursors?: { after?: string }; next?: string } };
    rows.push(...(body.data ?? []));
    after = body.paging?.next ? (body.paging.cursors?.after ?? null) : null;
    if (!after) break;
  }
  return rows;
}

/**
 * The show's Pages for the funnel: SourcePage rows (promoter, venue, lineup)
 * with access, and the names plan_retargeting lists (TC9). With no graph, the
 * Pages are listed with access unknown (null).
 */
export async function readShowPages(args: {
  db: Db;
  graph: RefreshGraph | null;
  event: { id: string; client_id: string | null; clientName?: string | null; code?: string | null };
  venue: { meta_page_id: string | null; meta_page_name: string | null; name: string | null } | null;
  adAccountId: string | null;
  businessIds: readonly string[];
  cache: ShowPagesCache;
}): Promise<{ pages: SourcePage[]; matched: MatchedPages; calls: number }> {
  let calls = 0;
  const count = () => {
    calls += 1;
  };
  const { db, graph, cache } = args;
  const [own, lineup] = await Promise.all([promoterPageIds(db, args.event.id, args.event.client_id), lineupSources(db, args.event.id)]);

  // The ad account's Pages (promote_pages), with their Instagram accounts.
  let promote: PromotePage[] | null = null;
  if (graph && args.adAccountId) {
    const account = args.adAccountId.startsWith("act_") ? args.adAccountId : `act_${args.adAccountId}`;
    if (!cache.promote.has(account)) {
      const rows = await edge(graph, `/${account}/promote_pages`, { fields: "id,name,instagram_business_account{id}", limit: "100" }, count).catch(() => null);
      cache.promote.set(account, rows ? rows.map((r) => ({ id: String(r.id), name: str(r.name), igId: str((r.instagram_business_account as Row | undefined)?.id) })) : null);
    }
    promote = cache.promote.get(account) ?? null;
  }
  const promoteById = new Map((promote ?? []).map((p) => [p.id, p]));
  // An act with no Page id on file takes the ad account's Page of the same name (audience_sources' rule).
  for (const act of lineup) {
    if (act.pageId) continue;
    const hit = (promote ?? []).find((p) => norm(p.name) && norm(p.name) === norm(act.name));
    if (!hit) continue;
    act.pageId = hit.id;
    act.pageName = hit.name;
    act.igId ??= hit.igId;
  }
  // The client's Business Manager Pages (owned and client), read once a run per business.
  const loadBusinessPages = async (): Promise<Map<string, string>> => {
    const map = new Map<string, string>();
    if (!graph) return map;
    for (const businessId of args.businessIds) {
      if (!cache.business.has(businessId)) {
        const pages = new Map<string, string>();
        for (const e of ["owned_pages", "client_pages"]) {
          for (const r of await edge(graph, `/${businessId}/${e}`, { fields: "id,name", limit: "200" }, count).catch(() => [] as Row[])) if (r.id && !pages.has(String(r.id))) pages.set(String(r.id), str(r.name) ?? String(r.id));
        }
        cache.business.set(businessId, pages);
      }
      for (const [id, name] of cache.business.get(businessId)!) if (!map.has(id)) map.set(id, name);
    }
    return map;
  };
  const bmPages = await loadBusinessPages();
  // The promoter's Pages (Matas, 27 Nov): only the show's own brand's (show-brands.ts), by name, from the client's Business Manager
  // listing, the ad account's Pages and the Pages the show's drafts run from; never every Page the client owns. An act's own Page is
  // lineup, never promoter.
  const actPages = new Set(lineup.map((a) => a.pageId).filter((v): v is string => Boolean(v)));
  const candidateNames = new Map<string, string | null>();
  for (const [id, name] of bmPages) candidateNames.set(id, name);
  for (const p of promote ?? []) if (!candidateNames.get(p.id)) candidateNames.set(p.id, p.name);
  for (const id of own) if (!candidateNames.has(id)) candidateNames.set(id, null);
  const brandIds = [...candidateNames].filter(([id, name]) => !actPages.has(id) && isShowBrandPage(args.event.code, args.event.clientName, name)).map(([id]) => id);
  const venueId = args.venue?.meta_page_id && /^\d{5,32}$/.test(args.venue.meta_page_id) ? args.venue.meta_page_id : null;
  const pageIds = [...new Set([...brandIds, ...(venueId ? [venueId] : []), ...lineup.map((a) => a.pageId).filter((v): v is string => Boolean(v))])];

  // Access: the Audience Builder's check, BM Pages first, then the token's tasks.
  const access = new Map<string, { ok: boolean; name: string | null }>();
  if (graph && pageIds.length) {
    const todo = pageIds.filter((id) => !cache.access.has(id));
    if (todo.length) {
      const businessPages = async () => bmPages;
      const probe = async (pageId: string) => {
        count();
        return (await graph.graphGet(`/${pageId}`, { fields: "id,name,tasks" })) as { id?: string; name?: string; tasks?: string[] };
      };
      const res = await resolvePageAccess(todo, "", { probe, businessPages }).catch(() => null);
      for (const id of todo) cache.access.set(id, { ok: Boolean(res?.accessiblePageIds.includes(id)), name: res?.names[id] ?? null });
    }
    for (const id of pageIds) access.set(id, cache.access.get(id)!);
  }
  const hasRole = (id: string) => (access.has(id) ? access.get(id)!.ok : null);
  const nameOf = (id: string, fallback: string | null) => promoteById.get(id)?.name ?? bmPages.get(id) ?? access.get(id)?.name ?? fallback ?? id;

  const pages: SourcePage[] = [];
  const seen = new Set<string>();
  const add = (page: SourcePage) => {
    if (seen.has(page.id)) return;
    seen.add(page.id);
    pages.push(page);
  };
  for (const id of brandIds) add({ id, name: nameOf(id, args.event.clientName ?? null), igId: promoteById.get(id)?.igId ?? null, kind: "promoter", hasRole: hasRole(id) });
  if (venueId) add({ id: venueId, name: nameOf(venueId, args.venue?.meta_page_name ?? args.venue?.name ?? null), igId: promoteById.get(venueId)?.igId ?? null, kind: "venue", hasRole: hasRole(venueId) });
  for (const act of lineup) if (act.pageId) add({ id: act.pageId, name: act.pageName ?? act.name, igId: act.igId ?? promoteById.get(act.pageId)?.igId ?? null, kind: "lineup", hasRole: hasRole(act.pageId) });

  const matched: MatchedPages = {
    venue: venueId ? nameOf(venueId, args.venue?.meta_page_name ?? args.venue?.name ?? null) : null,
    brands: [...new Set(brandIds.map((id) => nameOf(id, args.event.clientName ?? null)))],
    artists: [...new Set(lineup.filter((a) => a.pageId).map((a) => a.name))],
  };
  return { pages, matched, calls };
}
