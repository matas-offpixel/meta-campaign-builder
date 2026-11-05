/**
 * Creative Lab rounds: the rights gate and ad names.
 *
 * Rights (roadmap §2 rule 6): no round is built for an artist until the
 * written paid-use permission is stored (rights_doc_ref) and approved
 * (approved_at). The artist must belong to the event's client: rights
 * are granted to a promoter, not to every client that books the artist.
 *
 * Ad names are ASCII only, <ARTIST>-clip<NN>_cap-<style><N>, so a regex
 * can parse them later and metaAdName() leaves them unchanged.
 */

import type { ServiceRoleDb } from "./load.ts";
import type { CaptionStyle } from "./tags.ts";

export type RoundRefusal = "artist_not_found" | "event_not_found" | "artist_client_mismatch" | "no_rights_doc" | "not_approved";

export class RoundRefusedError extends Error {
  readonly code: RoundRefusal;

  constructor(code: RoundRefusal, message: string) {
    super(message);
    this.name = "RoundRefusedError";
    this.code = code;
  }
}

export type LabArtist = {
  id: string;
  client_id: string;
  name: string;
  rights_doc_ref: string | null;
  approved_at: string | null;
};

/** Throws RoundRefusedError when the artist may not be used in a round. */
export function assertArtistCleared(artist: LabArtist | null, eventClientId: string | null): asserts artist is LabArtist {
  if (!artist) throw new RoundRefusedError("artist_not_found", "No Creative Lab artist with that id.");
  if (!artist.rights_doc_ref?.trim()) {
    throw new RoundRefusedError("no_rights_doc", `${artist.name}: no written paid-use permission stored (rights_doc_ref).`);
  }
  if (!artist.approved_at) {
    throw new RoundRefusedError("not_approved", `${artist.name}: permission stored but not approved (approved_at).`);
  }
  if (eventClientId && artist.client_id !== eventClientId) {
    throw new RoundRefusedError("artist_client_mismatch", `${artist.name}: permission is held by another client.`);
  }
}

export type LabRound = {
  id: string;
  event_id: string;
  artist_id: string;
  round_no: number;
  channel: "meta" | "tiktok";
  status: string;
};

export async function createRound(
  db: ServiceRoleDb,
  args: { userId: string; eventId: string; artistId: string; channel?: "meta" | "tiktok" },
): Promise<LabRound> {
  const [artistRes, eventRes, lastRes] = await Promise.all([
    db
      .from("creative_lab_artists")
      .select("id, client_id, name, rights_doc_ref, approved_at")
      .eq("id", args.artistId)
      .maybeSingle(),
    db.from("events").select("id, client_id").eq("id", args.eventId).maybeSingle(),
    db
      .from("creative_lab_rounds")
      .select("round_no")
      .eq("event_id", args.eventId)
      .eq("artist_id", args.artistId)
      .order("round_no", { ascending: false })
      .limit(1),
  ]);
  if (artistRes.error) throw new Error(`creative_lab_artists: ${artistRes.error.message}`);
  if (eventRes.error) throw new Error(`events: ${eventRes.error.message}`);
  if (lastRes.error) throw new Error(`creative_lab_rounds: ${lastRes.error.message}`);
  const event = eventRes.data as { id: string; client_id: string | null } | null;
  if (!event) throw new RoundRefusedError("event_not_found", "No event with that id.");
  const artist = artistRes.data as LabArtist | null;
  assertArtistCleared(artist, event.client_id);

  const last = ((lastRes.data ?? []) as { round_no: number }[])[0];
  const { data, error } = await db
    .from("creative_lab_rounds")
    .insert({
      user_id: args.userId,
      event_id: args.eventId,
      artist_id: artist.id,
      round_no: (last?.round_no ?? 0) + 1,
      channel: args.channel ?? "meta",
      status: "draft",
    })
    .select("id, event_id, artist_id, round_no, channel, status")
    .single();
  if (error) throw new Error(`creative_lab_rounds insert: ${error.message}`);
  return data as LabRound;
}

export const AD_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** LUKEDEAN-clip01_cap-lineup1. The artist part keeps ASCII letters and digits only. */
export function buildAdName(args: { artistName: string; clipNo: number; style: CaptionStyle; captionNo: number }): string {
  const artist = args.artistName
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  if (!artist) throw new Error(`artist name has no ASCII letters or digits: ${args.artistName}`);
  if (!Number.isInteger(args.clipNo) || args.clipNo < 1) throw new Error(`bad clip number: ${args.clipNo}`);
  if (!Number.isInteger(args.captionNo) || args.captionNo < 1) throw new Error(`bad caption number: ${args.captionNo}`);
  return `${artist}-clip${String(args.clipNo).padStart(2, "0")}_cap-${args.style}${args.captionNo}`;
}

export function parseAdName(name: string): { artist: string; clipNo: number; style: string; captionNo: number } | null {
  const m = /^([A-Z0-9]+)-clip(\d+)_cap-([a-z_]+?)(\d+)$/.exec(name);
  return m ? { artist: m[1], clipNo: Number(m[2]), style: m[3], captionNo: Number(m[4]) } : null;
}
