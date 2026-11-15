/**
 * lib/dashboard/audience-panels.ts
 *
 * HE1 + HE3 panels for every view of the sales dashboard: one Who we
 * reached (E1) and one Direct-to-fan (E5) model per view id, so the panels
 * follow the show and venue the dashboard has open. Pure: the reads are in
 * ./audience-panels-server.ts.
 *
 * A view is
 *   - "all": the client (every show of the client);
 *   - a venue's view (SalesVenue.viewId, or "venue:unset"): every show at
 *     that events.venue_key, live and finished;
 *   - a show's chip id (its code, lower-cased): that show.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { audienceForShows, campaignCountsFor, type CampaignDayRow, type ClientBreakdownRows } from "../audience-breakdowns/read.ts";
import { buildDirectToFan, type D2CScope, type D2CSurface, type DirectToFanInput, type DirectToFanModel } from "./direct-to-fan.ts";
import { buildWhoWeReached, type WhoWeReachedModel } from "./who-we-reached.ts";

export type PanelShow = { id: string; code: string | null; name: string; venue_key: string | null };

export type PanelVenue = { key: string | null; name: string; viewId: string };

export type AudiencePanels = { reach: WhoWeReachedModel; d2c: DirectToFanModel };

export type AudiencePanelsByView = Record<string, AudiencePanels>;

export type AudiencePanelsInput = {
  clientId: string;
  clientName: string;
  shows: readonly PanelShow[];
  breakdowns: Pick<ClientBreakdownRows, "meta" | "tiktok">;
  campaignDays: readonly CampaignDayRow[];
  d2c: DirectToFanInput;
};

export const ALL_VIEW = "all";
export const VENUE_NOT_SET_VIEW = "venue:unset";

/** The client page's D2C tab, where the per-message rate belongs (PI5). */
export function rateHref(clientId: string): string {
  return `/clients/${clientId}?tab=d2c`;
}

type Scope = { eventIds: string[]; d2c: D2CScope };

/** Every view id the dashboard has → the shows it covers. Views that match no show are left out. */
export function scopesForViews(
  viewIds: readonly string[],
  venues: readonly PanelVenue[],
  shows: readonly PanelShow[],
  clientName: string,
): Map<string, Scope> {
  const byCode = new Map<string, PanelShow>();
  for (const s of shows) if (s.code) byCode.set(s.code.toLowerCase(), s);
  const venueByView = new Map<string, PanelVenue>();
  for (const v of venues) venueByView.set(v.viewId, v);
  const out = new Map<string, Scope>();
  for (const id of viewIds) {
    if (id === ALL_VIEW) {
      out.set(id, { eventIds: shows.map((s) => s.id), d2c: { kind: "client", label: clientName } });
      continue;
    }
    const venue = venueByView.get(id) ?? (id === VENUE_NOT_SET_VIEW ? { key: null, name: "Venue not set", viewId: id } : null);
    if (venue) {
      const ids = shows.filter((s) => (s.venue_key ?? null) === venue.key).map((s) => s.id);
      out.set(id, { eventIds: ids, d2c: { kind: "venue", label: venue.name, venueKey: venue.key } });
      continue;
    }
    const show = byCode.get(id);
    if (show) out.set(id, { eventIds: [show.id], d2c: { kind: "show", label: show.name, eventId: show.id } });
  }
  return out;
}

export function buildAudiencePanels(
  input: AudiencePanelsInput,
  view: { viewIds: readonly string[]; venues: readonly PanelVenue[] },
  surface: D2CSurface,
): AudiencePanelsByView {
  const names = new Map(input.shows.map((s) => [s.id, s.name]));
  const showName = (id: string) => names.get(id) ?? "—";
  const out: AudiencePanelsByView = {};
  for (const [viewId, scope] of scopesForViews(view.viewIds, view.venues, input.shows, input.clientName)) {
    const wanted = new Set(scope.eventIds);
    const audience = audienceForShows(input.breakdowns, wanted);
    const campaigns = campaignCountsFor(
      input.breakdowns.meta.filter((r) => wanted.has(r.owner_event_id)),
      input.campaignDays,
    );
    out[viewId] = {
      reach: buildWhoWeReached(audience, campaigns, scope.d2c.label),
      d2c: buildDirectToFan(input.d2c, scope.d2c, { surface, showName, rateHref: rateHref(input.clientId) }),
    };
  }
  return out;
}
