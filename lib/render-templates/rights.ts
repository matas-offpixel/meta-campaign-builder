/**
 * lib/render-templates/rights.ts — owner and rights per render file (RT1,
 * RT2, AL1). Owner and rights are separate:
 *
 *   - Owner is who filmed or made the footage, as the file name carries it:
 *     any promoter clip → the client (`promoter-{client-slug}`); one artist's
 *     clips only → that artist (`artist-{slug}`); several artists' clips, or
 *     a cut we made from artist material only → Off/Pixel (`offpixel`). A
 *     montage is always cut by us, so artist-only montage footage is
 *     Off/Pixel's.
 *   - Rights: a file with promoter footage stays with the client ("Filmed by
 *     {client}"). A file carrying the client's kit, artwork, venue or date —
 *     every version with text — stays with the client ("Has {client}'s
 *     branding or artwork"), even when the footage is the artist's. Only a
 *     No text version made from artist material only is Shareable, and only
 *     that kind joins the library's Renders.
 *
 * Pure. Relative imports only (node:test).
 */

import { badgeWords, rightsProblem, type Rights } from "../artist-library/rights.ts";
import { slugify, type FileOwner } from "./file-name.ts";
import { m4 } from "./words.ts";

export type ClipOwnership = { owner: "artist" | "promoter"; artistName: string | null };

export type RenderOwner = FileOwner & { name: string; artistName: string | null };

/**
 * The montage's owner from its clips. Promoter footage anywhere → the client.
 * Otherwise Off/Pixel, from the (first-billed) artist's material.
 */
export function montageOwner(clips: readonly ClipOwnership[], client: { name: string }, leadArtist: string | null): RenderOwner {
  if (clips.some((c) => c.owner !== "artist")) return { kind: "promoter", slug: slugify(client.name), name: client.name, artistName: null };
  const artist = leadArtist ?? clips.find((c) => c.artistName)?.artistName ?? null;
  return { kind: "offpixel", name: artist ? m4("m4.owner.offpixel", { artist }) : m4("m4.owner.offpixel", { artist: "" }), artistName: artist };
}

/** "Owner · {name}" on the card and the row: the client, the artist, or "Off/Pixel, from {artist}'s material". */
export function ownerLabel(owner: RenderOwner | null): string {
  if (!owner) return m4("m4.owner.pending");
  if (owner.kind === "promoter") return m4("m4.owner.promoter", { client: owner.name });
  if (owner.kind === "artist") return m4("m4.owner.artist", { artist: owner.name });
  return owner.name;
}

/** The rights of one file of a package. `hasText` is every version but No text. */
export function fileRights(owner: RenderOwner, hasText: boolean, clientId: string): Rights {
  let r: Rights;
  if (owner.kind === "promoter") r = { ownerKind: "promoter", shareable: false, heldReason: "filmed", clientId };
  else if (hasText) r = { ownerKind: owner.kind === "artist" ? "artist" : "offpixel", shareable: false, heldReason: "branding", clientId };
  else r = { ownerKind: owner.kind === "artist" ? "artist" : "offpixel", shareable: true, heldReason: null, clientId };
  const problem = rightsProblem(r);
  if (problem) throw new Error(problem);
  return r;
}

/** The badge as the row and Claude's file line print it: "This client only · {client}" with its reason, or "Shareable". */
export function badgeLine(rights: Pick<Rights, "shareable" | "heldReason">, clientName: string): { badge: string; why: string | null } {
  return badgeWords(rights, clientName, "operator");
}
