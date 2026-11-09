/**
 * "From the Lab" (S17, HS12). A finished render of this event becomes an
 * intake asset from its Storage file, named by the pairing, placed as the
 * 9:16. The Drive copy is never the source.
 */

export const LAB_RENDER_HASH = "lab-render:";

export function labRenderHash(renderId: string): string {
  return `${LAB_RENDER_HASH}${renderId}`;
}

export function pairingName(artist: string, clipNo: number, caption: string): string {
  const angle = caption.trim().replaceAll("_", " ");
  return `${artist} #${clipNo} × ${angle}`.trim();
}
