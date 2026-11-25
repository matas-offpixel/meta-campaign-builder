/**
 * lib/artist-library/suggest.ts — who probably owns a held file (proposals only).
 *
 * A file is held when an ad ran it and no Lab clip, Lab render or source-map
 * entry says whose footage it is: it stays with the client (rights.ts
 * clientAdRights). The dry run proposes an owner for each, from the file's
 * name only, so Matas can confirm one client × owner group at a time:
 *
 *   promoter  a static the client ran (its own artwork, ticket tiers, line-up
 *             cards), or a video named for the crowd, the room or the venue;
 *   artist    a file named as the artist's own post (Instagram, IG, TikTok,
 *             or an Instagram media id as its name) or their press kit;
 *   unsure    anything else, a "feed post" included (whose feed?).
 *
 * A suggestion is never written: it changes no owner_kind and no shareable
 * flag, and the planned rows are the same with or without it. A confirmed
 * "artist" group goes into the source map (source-map.ts) by Drive id, as
 * Enzo's UGC did; a confirmed "promoter" group needs nothing (held is
 * already the promoter's).
 *
 * Pure.
 */
import { fold } from "./match.ts";
import type { PlannedAsset } from "./backfill.ts";

export type SuggestedOwner = "promoter" | "artist" | "unsure";

export interface HeldFile {
  artistId: string;
  artistName: string;
  /** The ad name, as the file reads in the held list. */
  file: string;
  /** The creative it is: the ad name less a bulk-attach " — {ad set}" tail and copy suffixes (creativeName). */
  creative: string;
  kind: string;
  eventId: string | null;
  clientId: string | null;
  ads: number;
}

export interface Suggestion {
  owner: SuggestedOwner;
  /** The rule that fired, in a few words. */
  why: string;
}

const has = (folded: string, words: readonly string[]) => words.some((w) => folded.includes(` ${w} `));

/** Named for the artist's own account. A bare "reel", "story" or "post" isn't: "IV Location Reel" is the promoter's. */
const ARTIST_POST = ["ig", "insta", "instagram", "tiktok", "ig post", "ig reel", "ig story"];
const PRESS = ["press", "presskit", "press kit", "press shot", "press shots", "press pic", "press photo", "epk"];
const CROWD = ["crowd", "crowds", "venue", "recap", "aftermovie", "after movie", "highlights", "dancefloor", "dance floor", "room", "rooms", "drone", "queue", "atmosphere"];
/** An Instagram media id as a file name: 15–20 digits, nothing else. */
const IG_MEDIA_ID = /^\s*\d{15,20}(?:\.[a-z0-9]{2,4})?\s*$/i;

/**
 * The creative an ad name stands for: bulk-attach adds " — {ad set}" (or
 * " — attached:{id}") and Ads Manager " – Copy n"; both are cut, so one
 * creative is one line to decide. "Arthi Artist Card Motion — Garage
 * Audience 2" is "Arthi Artist Card Motion".
 */
export function creativeName(adName: string): string {
  let out = adName.split(" \u2014 ")[0]!.trim();
  for (;;) {
    const next = out.replace(/\s*[\u2013-]\s*Copy(?:\s+\d+)?$/i, "").trim();
    if (next === out) return out || adName.trim();
    out = next;
  }
}

/**
 * The proposal for one held file. `venueNames` are the show's venue names,
 * matched whole (folded), never by a word of them. The client's name isn't
 * one: "Puzzle - Enzo Vid 2" is how Puzzle names its edits, not crowd footage.
 */
export function suggestOwner(file: Pick<HeldFile, "file" | "kind">, ctx: { venueNames?: readonly (string | null | undefined)[] } = {}): Suggestion {
  const name = fold(file.file);
  if (IG_MEDIA_ID.test(file.file)) return { owner: "artist", why: "named by its Instagram media id" };
  if (has(name, PRESS)) return { owner: "artist", why: "named as a press kit" };
  // "IW Feed Post", "J2 - Adam Beyer Feed Post": a feed post is as often the promoter's feed as the artist's.
  if (has(name, ["feed post", "feed posts"])) return { owner: "unsure", why: "a feed post: whose feed isn't said" };
  if (has(name, ARTIST_POST)) return { owner: "artist", why: "named as the artist's own post" };
  if (file.kind === "static") return { owner: "promoter", why: "a static the client ran (its artwork)" };
  if (has(name, CROWD)) return { owner: "promoter", why: "named for the crowd or the venue" };
  for (const v of ctx.venueNames ?? []) {
    const venue = fold(v).trim();
    if (venue && name.includes(` ${venue} `)) return { owner: "promoter", why: "named for the venue" };
  }
  return { owner: "unsure", why: "the name doesn't say" };
}

/**
 * The plan's held files that nothing accounts for: ad rows held with no Lab
 * clip, Lab render or source file. One per show and ad name, as the view
 * groups them.
 */
export function heldNoSourceFiles(rows: readonly PlannedAsset[], artistName: string): HeldFile[] {
  const out = new Map<string, HeldFile>();
  for (const r of rows) {
    if (r.shareable || !r.meta_ad_id || r.lab_clip_id || r.lab_render_id || r.drive_file_id) continue;
    const file = (r.name ?? "").trim() || r.asset_key;
    const key = `${r.source_event_id ?? r.source_client_id ?? ""}\u0000${file}`;
    const have = out.get(key);
    if (have) have.ads += 1;
    else out.set(key, { artistId: r.artist_id, artistName, file, creative: creativeName(file), kind: r.kind, eventId: r.source_event_id, clientId: r.source_client_id, ads: 1 });
  }
  return [...out.values()];
}
