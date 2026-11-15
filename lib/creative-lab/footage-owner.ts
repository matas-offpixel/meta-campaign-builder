/**
 * The caption follows the footage's owner (W1–W8).
 * Promoter copy pairs only with the promoter's own footage.
 * An Artist caption or a quote pairs only with that artist's clips,
 * plus promoter clips that feature that artist.
 * A missing owner is a row from before the column existed: pairing
 * stays as it was, except a generated first-person caption, which
 * enters no new round.
 */

export type FootageOwner = "promoter" | "artist";

export type OwnerSource =
  | { kind: "instagram"; handle: string; clientHandle: string | null; artistId: string | null }
  | { kind: "artist_folder" | "press_kit" | "artist_clips"; artistId: string }
  | { kind: "venue_crowd" }
  | { kind: "upload"; folderKey: string; artistId: string | null };

export type PairClip = {
  id: string;
  owner: FootageOwner | null;
  artistId: string | null;
  featuredArtistIds: readonly string[];
};

export type PairCaption = {
  id: string;
  style: string;
  mode?: string | null;
  artistId?: string | null;
  status?: string | null;
};

const HANDLE = (value: string | null | undefined) => (value ?? "").trim().replace(/^@/, "").toLowerCase();

/** Who a new clip belongs to, from the path it arrived on. */
export function ownerFromImport(source: OwnerSource): { owner: FootageOwner; artistId: string | null } {
  if (source.kind === "venue_crowd") return { owner: "promoter", artistId: null };
  if (source.kind === "upload") {
    if (source.folderKey === "02/venue-crowd") return { owner: "promoter", artistId: null };
    return { owner: "artist", artistId: source.artistId };
  }
  if (source.kind === "instagram") {
    const handle = HANDLE(source.handle);
    const client = HANDLE(source.clientHandle);
    if (client && handle === client) return { owner: "promoter", artistId: null };
    return { owner: "artist", artistId: source.artistId };
  }
  return { owner: "artist", artistId: source.artistId };
}

export type OwnedClip = {
  rightsRef: string;
  rightsChip: string;
  owner: FootageOwner;
  artistId: string | null;
  ownerSetBy: string | null;
  ownerSetAt: string | null;
};

/** A hand correction. The rights ref and the rights chip stay as they were. */
export function assignOwner(
  clip: { rightsRef: string; rightsChip: string },
  next: { owner: FootageOwner; artistId: string | null },
  who: string,
  when: string,
): OwnedClip {
  return {
    rightsRef: clip.rightsRef,
    rightsChip: clip.rightsChip,
    owner: next.owner,
    artistId: next.owner === "promoter" ? null : next.artistId,
    ownerSetBy: who,
    ownerSetAt: when,
  };
}

export function toggleFeature(ids: readonly string[], artistId: string): string[] {
  return ids.includes(artistId) ? ids.filter((id) => id !== artistId) : [...ids, artistId];
}

function artistCaption(caption: PairCaption): boolean {
  return caption.mode === "quote" || caption.style === "quote" || caption.style === "artist";
}

/**
 * Whether this caption may sit on this clip.
 * First-person captions are retired from new rounds.
 * A clip with no owner yet is not blocked, so a row from before
 * the migration still proposes the way it did.
 */
export function captionAllowsClip(caption: PairCaption, clip: PairClip): boolean {
  if (caption.status === "retired" || caption.style === "artist_first_person") return false;
  if (clip.owner == null) return true;
  if (artistCaption(caption)) {
    if (!caption.artistId) return false;
    if (clip.owner === "artist") return clip.artistId === caption.artistId;
    return clip.featuredArtistIds.includes(caption.artistId);
  }
  return clip.owner === "promoter";
}

/** The clip list every Pair with mode uses, so a crossed pair is never written. */
export function clipsForStyle<T extends PairClip>(style: string, artistId: string | null, clips: readonly T[]): T[] {
  const caption: PairCaption = { id: "style", style, artistId, status: "proposed" };
  return clips.filter((clip) => captionAllowsClip(caption, clip));
}

export function quoteChannels(named: readonly string[] | null, rights: "promoter" | "artist_too"): string[] {
  if (named && named.length > 0) return [...named];
  return rights === "artist_too" ? ["promoter", "artist"] : ["promoter"];
}

/** Channels both the clip and the caption are cleared for. */
export function pairChannels(clipChannels: readonly string[], captionChannels: readonly string[]): string[] {
  const allowed = new Set(captionChannels);
  return clipChannels.filter((channel) => allowed.has(channel));
}

export type RoundPairing = {
  round: "promoter" | "artist";
  artistId: string | null;
  clipId: string;
  captionId: string;
  channels: readonly string[];
};

export function pairingsForClip(
  clip: PairClip & { channels: readonly string[] },
  captions: readonly (PairCaption & { channels: readonly string[] | null; rights?: "promoter" | "artist_too" })[],
): RoundPairing[] {
  const rows: RoundPairing[] = [];
  for (const caption of captions) {
    if (!captionAllowsClip(caption, clip)) continue;
    const named = caption.channels && caption.channels.length > 0
      ? [...caption.channels]
      : quoteChannels(null, caption.rights ?? "promoter");
    const channels = pairChannels(clip.channels, named);
    if (channels.length === 0) continue;
    const artist = artistCaption(caption);
    rows.push({
      round: artist ? "artist" : "promoter",
      artistId: artist ? caption.artistId ?? null : null,
      clipId: clip.id,
      captionId: caption.id,
      channels,
    });
  }
  return rows;
}

export function objectPronoun(pronouns: string | null | undefined): string {
  const head = (pronouns ?? "").toLowerCase().split(/[/\s,]+/)[0] ?? "";
  if (head === "he" || head === "him" || head === "his") return "him";
  if (head === "she" || head === "her") return "her";
  return "them";
}

export function possessivePronoun(pronouns: string | null | undefined): string {
  const head = (pronouns ?? "").toLowerCase().split(/[/\s,]+/)[0] ?? "";
  if (head === "he" || head === "him" || head === "his") return "his";
  if (head === "she" || head === "her") return "her";
  return "their";
}

export function emptyFootage(client: string, handle: string | null): { sentence: string; action: string; drop: string } {
  const bare = (handle ?? "").trim().replace(/^@/, "");
  return {
    sentence: `No ${client} footage yet. Lineup, POV and Scarcity need it.`,
    action: bare ? `Find clips on @${bare}` : `Add ${client}'s Instagram`,
    drop: "or drop them in 02 Source / Venue & crowd",
  };
}

export function footageWhy(angle: string, client: string): string {
  return `${angle} needs ${client} footage — none selected yet.`;
}

export function unpairedLine(angle: string, client: string): string {
  return `Unpaired — ${angle} needs ${client} footage.`;
}

export function needsFootageLabel(client: string): string {
  return `Needs ${client} footage`;
}

export function nextFootageLine(client: string, count: number, angle = "Lineup"): string {
  const word = count === 1 ? "caption is" : "captions are";
  return `Add ${client} footage — ${count} ${angle} ${word} waiting for it.`;
}

const GAP_STYLES = new Set(["lineup", "pov", "scarcity"]);
const GAP_LABEL: Record<string, string> = { lineup: "Lineup", pov: "POV", scarcity: "Scarcity" };

/** One style keeps its name. Mixed Lineup, POV and Scarcity stay in the count without naming one of them. */
export function footageWaitingLine(client: string, count: number, angle: string | null): string {
  if (angle) return nextFootageLine(client, count, angle);
  const word = count === 1 ? "caption is" : "captions are";
  return `Add ${client} footage — ${count} ${word} waiting for it.`;
}

/** The strip's Next line when promoter footage is missing. Lineup, POV and Scarcity all count. */
export function ownerFootageGap(
  lab: {
    captions: readonly { style: string; status: string }[];
    clips: readonly { owner?: string | null }[];
    clientName: string | null;
    clientHandle?: string | null;
    voice?: { promoter: { handle: string | null } } | null;
  },
  owner: boolean,
): { text: string; verb: string; target: "lab-clips" } | null {
  if (!owner) return null;
  const waiting = lab.captions.filter((caption) => GAP_STYLES.has(caption.style) && caption.status === "proposed");
  if (waiting.length === 0 || lab.clips.some((clip) => clip.owner === "promoter")) return null;
  const styles = [...new Set(waiting.map((caption) => caption.style))];
  const angle = styles.length === 1 ? (GAP_LABEL[styles[0]!] ?? styles[0]!) : null;
  const handle = (lab.clientHandle || lab.voice?.promoter.handle || "").replace(/^@/, "");
  const client = lab.clientName || "the promoter";
  return {
    text: footageWaitingLine(client, waiting.length, angle),
    verb: handle ? `Find clips on @${handle}` : `Add ${lab.clientName || "the client"}'s Instagram`,
    target: "lab-clips",
  };
}

export function quotePairsLine(artist: string, client: string, pronoun: string, featuring: number): string {
  if (featuring > 0) return `pairs with ${artist}'s clips and ${client} clips that feature ${pronoun}`;
  return `pairs with ${artist}'s clips only`;
}

export function featuringLine(count: number, client: string, artist: string): string {
  const clips = count === 1 ? "clip" : "clips";
  return `and ${count} ${client} ${clips} that feature ${artist}`;
}

export function promoterTileLabel(client: string, clipNo: number, artists: readonly string[]): string {
  const base = `${client} #${clipNo}`;
  return artists.length > 0 ? `${base} · ${artists.join(" · ")}` : base;
}

export function promoterHint(narrow: boolean): string {
  return narrow ? "Lineup, POV and Scarcity" : "the promoter's own clips · Lineup, POV and Scarcity";
}

export function artistHint(name: string, pronouns: string | null | undefined, narrow: boolean): string {
  if (narrow) return `Artist and ${possessivePronoun(pronouns)} own words`;
  return `${name}'s clips · Artist and ${name}'s own words`;
}

export function artistWhy(artist: string, client: string): string {
  return `Artist is written about ${artist}, in ${client}'s voice · pairs with ${artist}'s clips only`;
}

export const RETIRED_FIRST_PERSON = "First-person words come from the artist — use Quote.";

export type CrossedRow = {
  id: string;
  eventName: string;
  style: string;
  status: string;
  generatedBy?: string | null;
  mode: string | null;
  artistId: string | null;
  clipId: string | null;
  clipOwner: FootageOwner | null;
  clipArtistId: string | null;
  featuredArtistIds: readonly string[];
};

/** Proposed captions whose clip the angle cannot use, and generated first-person rows. Nothing is deleted. */
export function planUnpair(rows: readonly CrossedRow[]): {
  unpairIds: string[];
  retireIds: string[];
  puzzleLineup: number;
  otherUnpair: number;
} {
  const unpairIds: string[] = [];
  const retireIds: string[] = [];
  for (const row of rows) {
    if (row.status === "retired") continue;
    if (row.status === "proposed" && row.style === "artist_first_person" && row.generatedBy !== "manual") retireIds.push(row.id);
    if (row.status !== "proposed" || !row.clipId || row.style === "artist_first_person") continue;
    const owner = row.clipOwner ?? (row.clipArtistId ? "artist" : "promoter");
    const allowed = captionAllowsClip(
      { id: row.id, style: row.style, mode: row.mode, artistId: row.artistId, status: row.status },
      { id: row.clipId, owner, artistId: row.clipArtistId, featuredArtistIds: row.featuredArtistIds },
    );
    if (!allowed) unpairIds.push(row.id);
  }
  const puzzleLineup = rows.filter((row) => unpairIds.includes(row.id) && row.eventName.includes("Puzzle 4th Birthday") && row.style === "lineup").length;
  return { unpairIds, retireIds, puzzleLineup, otherUnpair: unpairIds.length - puzzleLineup };
}
