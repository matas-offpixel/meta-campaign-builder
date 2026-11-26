/**
 * lib/mcp/shows-deps.ts
 *
 * The real McpShowsDeps for the route (M3d-a): the app's own create and
 * save paths, for one operator. Not imported by tests (they pass spies);
 * the guard test pins exactly what this file imports, and only the route
 * wiring imports it. App database only: nothing here reaches Meta or Drive.
 *
 *   - createEvent: the event form's create (insertEventRow, lib/db/events.ts:
 *     the events insert and its key-moments seed) on the service-role
 *     client, the row naming the operator's user_id as the form's does.
 *   - createClient: the clients form's create (insertClientRow,
 *     lib/db/clients.ts), the same way.
 *   - addSpotifyArtist / saveLineup: the Lab's "add from Spotify"
 *     (addSpotifyToLineup) and lineup save (saveLabLineup), as the Lab's
 *     route calls them (artists, event_artists source lab,
 *     creative_lab_event_facts). No Spotify call: the tool passes the id.
 *   - loadReleases: the event page's Releases card reads (loadEventReleases,
 *     loadClientLadder, loadSalesHistory, loadEventArtists).
 *   - postRelease: the Releases card's save (postReleaseAs, the route's own
 *     handler: releases, the derived sale dates on events, a manual
 *     tier_channel_sales count, a held ticket_warnings proposal).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertEventRow } from "@/lib/db/events";
import { insertClientRow } from "@/lib/db/clients";
import { addSpotifyToLineup, saveLabLineup } from "@/lib/creative-lab/lineup";
import { loadClientLadder, loadEventArtists, loadEventReleases, loadSalesHistory } from "@/lib/db/releases";
import { postReleaseAs } from "@/app/api/events/[id]/releases/route";
import type { McpShowsDeps } from "./tool-types";

export function realShowsDeps(db: SupabaseClient): McpShowsDeps {
  return {
    async createEvent({ userId, row }) {
      const created = await insertEventRow(db, { ...row, user_id: userId } as never);
      if (!created) throw new Error("event not created");
      return { id: created.id, slug: created.slug };
    },
    async createClient({ userId, row }) {
      const created = await insertClientRow(db, { ...row, user_id: userId } as never);
      if (!created) throw new Error("client not created");
      return { id: created.id, slug: created.slug };
    },
    async addSpotifyArtist({ userId, eventId, name, spotifyId }) {
      return addSpotifyToLineup(db as never, {
        userId,
        eventId,
        pick: {
          name,
          spotifyId,
          imageUrl: null,
          genres: [],
          instagramHandle: null,
          tiktokHandle: null,
          musicbrainzId: null,
          profileJson: { spotify: { id: spotifyId, name, genres: [] } },
        },
      });
    },
    saveLineup({ userId, eventId, slots }) {
      return saveLabLineup(db as never, { userId, eventId, slots });
    },
    async loadReleases({ eventId, clientId }) {
      const releases = await loadEventReleases(db as never, eventId);
      if (!releases) return null;
      const [ladder, counts, lineup, event] = await Promise.all([
        clientId ? loadClientLadder(db as never, clientId).catch(() => []) : Promise.resolve([]),
        loadSalesHistory(db as never, eventId).catch(() => []),
        loadEventArtists(db as never, eventId).catch(() => ({ artists: [], lastProposalAt: null })),
        db.from("events").select("event_date").eq("id", eventId).maybeSingle(),
      ]);
      return {
        releases,
        ladder: ladder ?? [],
        counts,
        artists: lineup.artists,
        lastProposalAt: lineup.lastProposalAt,
        eventAt: (event.data as { event_date?: string | null } | null)?.event_date ?? null,
      };
    },
    async postRelease({ userId, eventId, body }) {
      const req = new Request(`http://localhost/api/events/${eventId}/releases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const res = await postReleaseAs(req, eventId, { db: db as never, user: { id: userId } });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: res.status, body: json };
    },
  };
}
