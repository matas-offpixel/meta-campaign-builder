/**
 * lib/artist-library/rights.ts — who may use what (AL1).
 *
 * Matas, 25 Nov: promoter-filmed footage stays with that promoter; only
 * artist footage and press kits travel between clients. A render is
 * shareable only if every clip in it is artist-owned.
 *
 * Pure. Mirrors migration 269's CHECKs so a writer fails before Postgres
 * would, and every reader decides "can this event use it" in one place.
 */
import { AL_WORDS, alWord } from "./words.ts";

export type OwnerKind = "artist" | "promoter" | "offpixel";
export type HeldReason = "filmed" | "footage" | "branding" | "names";
export type AssetKind = "clip" | "static" | "render" | "caption";

export interface Rights {
  ownerKind: OwnerKind;
  shareable: boolean;
  /** Why it stays with its client; null when shareable. */
  heldReason: HeldReason | null;
  /** The client it stays with (source_client_id). */
  clientId: string | null;
}

const held = (ownerKind: OwnerKind, heldReason: HeldReason, clientId: string | null): Rights => ({ ownerKind, shareable: false, heldReason, clientId });

/** A Lab clip: creative_lab_clips.owner. Anything not artist-owned is the promoter's. */
export function clipRights(owner: string | null | undefined, clientId: string | null): Rights {
  if (owner === "artist") return { ownerKind: "artist", shareable: true, heldReason: null, clientId };
  return held("promoter", "filmed", clientId);
}

/**
 * An Off/Pixel render: shareable only when it has clips and every one is
 * artist-owned. One promoter clip (or a clip whose owner isn't known)
 * keeps it with the client: "Uses {client}'s footage".
 */
export function renderRights(clipOwners: readonly (string | null | undefined)[], clientId: string | null): Rights {
  const allArtist = clipOwners.length > 0 && clipOwners.every((owner) => owner === "artist");
  return allArtist ? { ownerKind: "offpixel", shareable: true, heldReason: null, clientId } : held("offpixel", "footage", clientId);
}

/**
 * An ad the client ran that no Lab render or clip accounts for. Nothing
 * says the artist owns it, so it stays with the client: a still is the
 * client's artwork, a video the client's footage.
 */
export function clientAdRights(kind: "clip" | "static" | "render", clientId: string | null): Rights {
  return held("promoter", kind === "static" ? "branding" : "filmed", clientId);
}

/** A file dropped into the library's Clips or Statics: shareable artist material by definition (AL4). */
export function libraryDropRights(): Rights {
  return { ownerKind: "artist", shareable: true, heldReason: null, clientId: null };
}

/** An approved artist-voice caption: shareable unless it names a client's venue or brand. */
export function captionRights(namesClient: boolean, clientId: string | null): Rights {
  return namesClient ? held("artist", "names", clientId) : { ownerKind: "artist", shareable: true, heldReason: null, clientId };
}

/** Migration 269's CHECKs, as a sentence for a test or a dry run. Null when the row is allowed. */
export function rightsProblem(r: Rights): string | null {
  if (r.ownerKind === "promoter" && r.shareable) return "promoter material can't be shareable";
  if (r.shareable !== (r.heldReason == null)) return "a held row needs its reason, a shareable one has none";
  if (!r.shareable && !r.clientId) return "a held row needs the client it stays with";
  return null;
}

/**
 * Can an asset be listed, ranked and used on an event of `eventClientId`?
 * Shareable material always; the owning client's own on its own events.
 * Without an event (null), shareable only.
 */
export function usableOn(asset: Pick<Rights, "shareable" | "clientId">, eventClientId: string | null): boolean {
  if (asset.shareable) return true;
  return Boolean(eventClientId && asset.clientId && asset.clientId === eventClientId);
}

/** The badge and the reason under it (AL1). `audience: "client"` is the .public set, for any surface a client can see. */
export function badgeWords(
  asset: Pick<Rights, "shareable" | "heldReason">,
  clientName: string,
  audience: "operator" | "client" = "operator",
): { badge: string; why: string | null } {
  if (asset.shareable) return { badge: AL_WORDS["al.badge.shareable"], why: null };
  const reason = asset.heldReason ?? "filmed";
  if (audience === "client") return { badge: AL_WORDS["al.badge.client.public"], why: AL_WORDS[`al.why.${reason}.public`] };
  return { badge: alWord("al.badge.client", { client: clientName }), why: alWord(`al.why.${reason}`, { client: clientName }) };
}
