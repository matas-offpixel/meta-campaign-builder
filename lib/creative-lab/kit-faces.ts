/**
 * The faces in each client's kit and where each came from (overlay templates
 * issue 7: O49, O51). A face enters a kit only from the client's own files;
 * the source is kept for the record and never shown (rule 5). Kept in code
 * until the kit has a table (no migration on this branch).
 *
 * A face listed here is provided, so cleared for every render (O49). Its file
 * lives in the private kit-fonts bucket at its storage path and is loaded per
 * render from a signed URL (t1-lambda.ts withKitFace, O52).
 */

import { KIT_FONT_BUCKET, kitFontPath } from "./t1-lambda.ts";

export type KitFace = {
  clientId: string;
  /** The kit's name for the face, checked against the loaded file (O52). */
  postscriptName: string;
  ext: "otf" | "ttf";
  /** O51: only a face the client supplied enters the kit. */
  source: { from: "client"; detail: string; recordedBy: string; at: string };
  storage: { bucket: string; path: string };
};

const PUZZLE = "92f7334b-ef76-4095-88d6-f422ba1ff3f2";

export const KIT_FACES: readonly KitFace[] = [
  {
    clientId: PUZZLE,
    postscriptName: "BootzyCondensedTM-Regular",
    ext: "otf",
    source: { from: "client", detail: "supplied by Puzzle or their designer with the 4th Birthday open files (the STORY and STATIC PSDs set it); the file itself came separately", recordedBy: "Matas", at: "2026-11-10" },
    storage: { bucket: KIT_FONT_BUCKET, path: kitFontPath(PUZZLE, "BootzyCondensedTM-Regular", "otf") },
  },
];

/** The provided face for a client's kit, or null: a face not supplied by the client is never in a kit (O51). */
export function providedFace(clientId: string, postscriptName: string): KitFace | null {
  return KIT_FACES.find((f) => f.clientId === clientId && f.postscriptName === postscriptName && f.source.from === "client") ?? null;
}
