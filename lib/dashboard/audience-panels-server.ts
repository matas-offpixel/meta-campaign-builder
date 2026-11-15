import "server-only";

/**
 * lib/dashboard/audience-panels-server.ts
 *
 * The reads behind the HE1 + HE3 panels on both sales pages. Read-only.
 *
 *   - Who we reached: lib/audience-breakdowns/read.ts on the caller's
 *     client (the owner's session internally, RLS; the service role on the
 *     share link), plus the campaigns' own ad_daily_insights counts for
 *     PI1's comparison.
 *   - Direct-to-fan: lib/d2c/stats-ingest/read.ts on the service role
 *     (migration 246 has no authenticated read). Internally this runs only
 *     after the owner's session has read the client's dashboard.
 *
 * A failed read leaves that panel out (null) rather than failing the page.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadCampaignDays, loadClientBreakdownRows } from "@/lib/audience-breakdowns/read";
import { loadAllPaged } from "@/lib/db/paged-read";
import { loadClientD2CInput } from "@/lib/d2c/stats-ingest/read";
import type { SalesDashboardModel, SalesSurface } from "@/lib/dashboard/sales-vs-spend";
import { createServiceRoleClient } from "@/lib/supabase/server";

import { buildAudiencePanels, VENUE_NOT_SET_VIEW, type AudiencePanelsByView, type PanelShow, type PanelVenue } from "./audience-panels";

/** The share's panels are at most this old, as the share's sales figures (D11). */
const SHARE_CACHE_MS = 5 * 60 * 1000;
const shareCache = new Map<string, { at: number; panels: AudiencePanelsByView }>();

function viewsOf(model: SalesDashboardModel): { viewIds: string[]; venues: PanelVenue[] } {
  const venues: PanelVenue[] = (model.venues ?? []).map((v) => ({ key: v.key, name: v.name, viewId: v.viewId }));
  if (model.views[VENUE_NOT_SET_VIEW] && !venues.some((v) => v.viewId === VENUE_NOT_SET_VIEW)) {
    venues.push({ key: null, name: "Venue not set", viewId: VENUE_NOT_SET_VIEW });
  }
  return { viewIds: Object.keys(model.views), venues };
}

async function load(
  reachDb: SupabaseClient,
  d2cDb: SupabaseClient,
  clientId: string,
  model: SalesDashboardModel,
  surface: SalesSurface,
): Promise<AudiencePanelsByView | null> {
  try {
    const [shows, breakdowns, d2c] = await Promise.all([
      loadAllPaged<{ id: string; event_code: string | null; name: string | null; venue_key: string | null }>(
        reachDb,
        "events",
        "id,event_code,name,venue_key",
        ["id"],
        (q) => q.eq("client_id", clientId),
      ),
      loadClientBreakdownRows(reachDb, clientId),
      loadClientD2CInput(d2cDb, clientId),
    ]);
    const campaignDays = await loadCampaignDays(reachDb, breakdowns.meta.map((r) => r.meta_campaign_id));
    const panelShows: PanelShow[] = shows.map((s) => ({ id: s.id, code: s.event_code, name: s.name ?? s.event_code ?? "—", venue_key: s.venue_key }));
    return buildAudiencePanels(
      { clientId, clientName: model.clientName, shows: panelShows, breakdowns, campaignDays, d2c },
      viewsOf(model),
      surface,
    );
  } catch (error) {
    console.error("[audience-panels] read failed", error);
    return null;
  }
}

/** Internal: HE1 on the owner's session, HE3 on the service role (call only after the owner's dashboard read). */
export function loadInternalAudiencePanels(sb: SupabaseClient, clientId: string, model: SalesDashboardModel): Promise<AudiencePanelsByView | null> {
  return load(sb, createServiceRoleClient(), clientId, model, "internal");
}

/** Share: the token already resolved to `clientId`; service role throughout. Never writes. */
export async function loadShareAudiencePanels(clientId: string, model: SalesDashboardModel, now = Date.now()): Promise<AudiencePanelsByView | null> {
  const cached = shareCache.get(clientId);
  if (cached && now - cached.at < SHARE_CACHE_MS) return cached.panels;
  const service = createServiceRoleClient();
  const panels = await load(service, service, clientId, model, "share");
  if (panels) shareCache.set(clientId, { at: now, panels });
  return panels;
}
