import "server-only";

/**
 * lib/dashboard/page-audience-panel/server.ts
 *
 * The reads behind HE2's panel and its geography on both sales pages.
 * Read-only, and never CIRQLIN: the stored rows of migration 247 through
 * lib/cirqlin/page-audience/read.ts, HE4's entered member counts
 * (migration 249) through lib/dashboard/presale/community-headline.ts.
 *
 *   - Internal: the owner's session (both tables are owner-read RLS). The
 *     entered-by first name is looked up on the service role, after the
 *     owner's session has read the client's dashboard.
 *   - Share: the service role, the token's own client only, at most five
 *     minutes old (D11). The share link names no one.
 *
 * The stored days a period needs are paged (.range(), PostgREST's 1,000-row
 * cap). A failed read leaves the panel out (null), never the page.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingPageAudienceTable, pageAudienceForClient, PAGE_AUDIENCE_TABLE } from "@/lib/cirqlin/page-audience/read";
import { VENUE_NOT_SET_VIEW, type PanelShow, type PanelVenue } from "@/lib/dashboard/audience-panels";
import { enteredMemberCounts } from "@/lib/dashboard/presale/community-headline";
import { adminNameLookup } from "@/lib/dashboard/presale/names";
import type { SalesDashboardModel } from "@/lib/dashboard/sales-vs-spend";
import { loadAllPaged } from "@/lib/db/paged-read";
import { createServiceRoleClient } from "@/lib/supabase/server";

import { dayInZone, shiftDay } from "./dates";
import { buildGeography, buildSignupsPanels, type EnteredMembers, type GeographyByView, type PageDayCounts, type PanelSurface, type SignupsPanelsByView } from "./model";

export type PageAudiencePanels = { signups: SignupsPanelsByView; geography: GeographyByView };

const SHARE_CACHE_MS = 5 * 60 * 1000;
const shareCache = new Map<string, { at: number; panels: PageAudiencePanels }>();

/** The longest period (30 days), its day before, and a day of slack for the read's time. */
const HISTORY_DAYS = 32;

type HistoryRow = {
  page_id: string;
  fetch_day: string;
  signups: number;
  consent_marketing: number;
  whatsapp_with_phone: number;
  community_joined: number;
  community_link_clicks: number;
  partner_opt_in: number;
};

function viewsOf(model: SalesDashboardModel): { viewIds: string[]; venues: PanelVenue[] } {
  const venues: PanelVenue[] = (model.venues ?? []).map((v) => ({ key: v.key, name: v.name, viewId: v.viewId }));
  if (model.views[VENUE_NOT_SET_VIEW] && !venues.some((v) => v.viewId === VENUE_NOT_SET_VIEW)) {
    venues.push({ key: null, name: "Venue not set", viewId: VENUE_NOT_SET_VIEW });
  }
  return { viewIds: Object.keys(model.views), venues };
}

async function loadHistory(db: SupabaseClient, pageIds: string[], nowMs: number): Promise<Map<string, PageDayCounts[]>> {
  const out = new Map<string, PageDayCounts[]>();
  if (!pageIds.length) return out;
  const since = shiftDay(dayInZone(nowMs, "UTC"), -HISTORY_DAYS);
  let rows: HistoryRow[];
  try {
    rows = await loadAllPaged<HistoryRow>(
      db,
      PAGE_AUDIENCE_TABLE,
      "page_id,fetch_day,signups,consent_marketing,whatsapp_with_phone,community_joined,community_link_clicks,partner_opt_in",
      ["page_id", "fetch_day"],
      (q) => q.in("page_id", pageIds).gte("fetch_day", since),
    );
  } catch (error) {
    if (isMissingPageAudienceTable(error instanceof Error ? error.message : String(error))) return out;
    throw error;
  }
  for (const r of rows) {
    const list = out.get(r.page_id) ?? [];
    list.push({
      fetchDay: r.fetch_day,
      signups: Number(r.signups) || 0,
      consentMarketing: Number(r.consent_marketing) || 0,
      whatsappWithPhone: Number(r.whatsapp_with_phone) || 0,
      communityJoined: Number(r.community_joined) || 0,
      communityLinkClicks: Number(r.community_link_clicks) || 0,
      partnerOptIn: Number(r.partner_opt_in) || 0,
    });
    out.set(r.page_id, list);
  }
  return out;
}

async function load(
  db: SupabaseClient,
  names: ReturnType<typeof adminNameLookup>,
  clientId: string,
  model: SalesDashboardModel,
  surface: PanelSurface,
  nowMs: number,
): Promise<PageAudiencePanels | null> {
  try {
    const [events, audience] = await Promise.all([
      loadAllPaged<{ id: string; event_code: string | null; name: string | null; venue_key: string | null; is_umbrella: boolean | null }>(
        db,
        "events",
        "id,event_code,name,venue_key,is_umbrella",
        ["id"],
        (q) => q.eq("client_id", clientId),
      ),
      pageAudienceForClient(db, clientId),
    ]);
    const pages = new Map([...audience.shows, ...audience.umbrellas]);
    if (!pages.size) return null;
    const [history, entered] = await Promise.all([
      loadHistory(db, [...new Set([...pages.values()].map((f) => f.pageId))], nowMs),
      enteredMemberCounts(db, [...pages.keys()], names),
    ]);
    const enteredMembers = new Map<string, EnteredMembers>();
    for (const [id, e] of entered) enteredMembers.set(id, { members: e.members, countedOn: e.countedOn, entered: { at: e.entered.at, name: e.entered.name } });
    const shows: PanelShow[] = events.map((e) => ({ id: e.id, code: e.event_code, name: e.name ?? e.event_code ?? "—", venue_key: e.venue_key }));
    const umbrellaIds = new Set(events.filter((e) => e.is_umbrella === true).map((e) => e.id));
    const input = { shows, pages, history, entered: enteredMembers, clientName: model.clientName, umbrellaIds };
    const views = viewsOf(model);
    return { signups: buildSignupsPanels(input, views, surface, nowMs), geography: buildGeography(input, views, surface, nowMs) };
  } catch (error) {
    console.error("[page-audience-panel] read failed", error);
    return null;
  }
}

/** Internal: the owner's session; names on the service role. Call only after the owner's dashboard read. */
export function loadInternalPageAudiencePanels(sb: SupabaseClient, clientId: string, model: SalesDashboardModel, nowMs = Date.now()): Promise<PageAudiencePanels | null> {
  return load(sb, adminNameLookup(createServiceRoleClient()), clientId, model, "internal", nowMs);
}

/** Share: the token already resolved to `clientId`; service role; no names. Never writes. */
export async function loadSharePageAudiencePanels(clientId: string, model: SalesDashboardModel, nowMs = Date.now()): Promise<PageAudiencePanels | null> {
  const cached = shareCache.get(clientId);
  if (cached && nowMs - cached.at < SHARE_CACHE_MS) return cached.panels;
  const panels = await load(createServiceRoleClient(), null, clientId, model, "share", nowMs);
  if (panels) shareCache.set(clientId, { at: nowMs, panels });
  return panels;
}
