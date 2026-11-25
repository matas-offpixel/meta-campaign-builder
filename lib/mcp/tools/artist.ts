/**
 * lib/mcp/tools/artist.ts — get_artist (read-only, AL5).
 *
 * What Off/Pixel holds on one artist, as plain text in the AL record's
 * words: shows across clients, the best files per stage with Drive links,
 * other files, approved captions, insights (none until AL3) and the rights.
 * With an event code it lists shareable material plus that event's client's
 * own, and counts every other client's in one line each; without one it
 * lists shareable material only. Promoter material never travels (Matas,
 * 25 Nov). Reads only (lib/artist-library/load.ts); archived clients out.
 */
import { z } from "zod";
import { artistAnswer, unknownArtistAnswer } from "../../artist-library/answer.ts";
import { findArtist, loadArtistData } from "../../artist-library/load.ts";
import { buildArtistView } from "../../artist-library/view.ts";
import { ToolInputError, type McpTool } from "../tool-types.ts";
import { loadEventByCode, normaliseCode } from "./shared.ts";

export const getArtistTool: McpTool = {
  name: "get_artist",
  title: "Get artist",
  kind: "read",
  description: [
    "Everything Off/Pixel holds on one artist, across every client: past shows with spend on the artist's ads, the best clips, statics and renders per stage with Drive links, other files, approved captions, insights and the rights for each file.",
    "Call it before any Instagram research for an artist, and go to Instagram only for what's missing or older than 6 months.",
    "Give the event you are working on: then the answer lists shareable material plus that client's own, and counts what stays with other clients. Without an event, shareable material only.",
    'Example: get_artist({ name: "Enzo Siragusa", event: "ES27-ENZOSIRAGUSA" }).',
  ].join(" "),
  inputSchema: {
    name: z.string().min(1).max(120).describe("The artist's name, as stored (case and accents don't matter)."),
    event: z.string().min(2).max(40).optional().describe('The event code you are working on, e.g. "ES27-ENZOSIRAGUSA".'),
  },
  async run(ctx, args) {
    const name = String(args.name ?? "").trim();
    let event: { code: string; clientId: string | null; id: string } | null = null;
    if (args.event != null) {
      const code = normaliseCode(args.event);
      const found = await loadEventByCode(ctx.db, code);
      if (!found) throw new ToolInputError(`No event with code ${code}.`);
      event = { code: found.primary.event_code ?? code, clientId: found.primary.client_id, id: found.primary.id };
    }
    const { artist, closest } = await findArtist(ctx.db, name);
    if (!artist) {
      return { data: unknownArtistAnswer(name, closest), eventId: event?.id ?? null, clientId: event?.clientId ?? null, summary: { found: false, closest: closest.length } };
    }
    const data = await loadArtistData(ctx.db, artist.id, event ? [event.id] : []);
    // The event asked about counts as one of the artist's shows: a thread is working on it for this artist.
    const linkedEventIds = event && !data.linkedEventIds.includes(event.id) ? [...data.linkedEventIds, event.id] : data.linkedEventIds;
    const view = buildArtistView({ assets: data.assets, insights: data.insights, events: data.events, linkedEventIds, today: ctx.today });
    const names = new Map(data.clients.map((c) => [c.id, c.name]));
    const text = artistAnswer({
      artist,
      view,
      clientName: (id) => (id ? names.get(id) ?? "" : ""),
      event: event ? { code: event.code, clientId: event.clientId } : null,
      driveFolderId: data.driveFolderId,
      today: ctx.today,
    });
    return {
      data: text,
      eventId: event?.id ?? null,
      clientId: event?.clientId ?? null,
      summary: { found: true, artistId: artist.id, shows: view.counted.shows, clients: view.counted.clients, files: view.groups.length, captions: view.captions.length },
    };
  },
};
