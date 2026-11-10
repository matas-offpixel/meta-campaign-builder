/**
 * Kit-font delivery for server renders (overlay templates issue 7, O49–O52).
 * A face provided with the client's open files is cleared for every render
 * (O49; issue 6's licence gate is withdrawn, O50). What is left is delivery:
 *
 *   - Never in git, never in the public Remotion bundle: the font lives in a
 *     private Storage bucket under the client's kit (KIT_FONT_BUCKET).
 *   - Per render, a signed URL that expires within the hour is made, the face
 *     is fetched to a temporary file, and its PostScript name is checked
 *     against the kit's before any frame is set. The URL is never logged,
 *     stored or passed to the composition.
 *   - The type is set from that file (sharp, as on the stills) and reaches
 *     the composition as images, so the browser, the Lambda site and its
 *     serve URL never see a font file.
 *   - No face, or the wrong face: the render stops, nothing falls back (O51):
 *     "Held — {face} didn't load for this render · retry".
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readFontFaces } from "./kit-font.ts";
import { claimAllowed } from "./t1-video.ts";

/** The private bucket kit fonts live in. It does not exist yet: it is created private (never public-read) before the first upload. */
export const KIT_FONT_BUCKET = "kit-fonts";
/** O52: a signed font URL lives at most an hour, made for one render. */
export const KIT_FONT_URL_TTL_S = 3600;

/** The kit's own path for a face: {client id}/{PostScript name}.{ext}. */
export function kitFontPath(clientId: string, postscriptName: string, ext: "otf" | "ttf"): string {
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new Error("kit fonts sit under the client's id");
  if (!/^[A-Za-z0-9_-]+$/.test(postscriptName)) throw new Error("a PostScript name has no spaces or slashes");
  return `${clientId}/${postscriptName}.${ext}`;
}

export const didNotLoad = (face: string) => `Held — ${face} didn't load for this render · retry`;

export class KitFaceHeldError extends Error {
  constructor(face: string) {
    super(didNotLoad(face));
    this.name = "KitFaceHeldError";
  }
}

export type KitFaceDeps = {
  /** Storage: a signed URL for the path, at most KIT_FONT_URL_TTL_S seconds. */
  signUrl: (bucket: string, path: string, ttlS: number) => Promise<string | null>;
  /** Fetch the bytes behind a URL (fetch in production; a stub in tests). */
  fetchBytes: (url: string) => Promise<Uint8Array | null>;
};

/**
 * O52: fetch the kit face for one render and hand its local file to `run`.
 * The face's PostScript name must be the kit's; any miss stops the render
 * with the held line before `run` runs. The file is removed afterwards.
 */
export async function withKitFace<T>(face: { postscriptName: string; path: string }, deps: KitFaceDeps, run: (file: string) => Promise<T>): Promise<T> {
  const url = await deps.signUrl(KIT_FONT_BUCKET, face.path, KIT_FONT_URL_TTL_S).catch(() => null);
  if (!url) throw new KitFaceHeldError(face.postscriptName);
  const bytes = await deps.fetchBytes(url).catch(() => null);
  if (!bytes?.length) throw new KitFaceHeldError(face.postscriptName);
  let names: string[] = [];
  try {
    names = readFontFaces(bytes).map((f) => f.postscriptName ?? "");
  } catch {
    throw new KitFaceHeldError(face.postscriptName);
  }
  if (!names.includes(face.postscriptName)) throw new KitFaceHeldError(face.postscriptName);
  const dir = mkdtempSync(join(tmpdir(), "kit-face-"));
  const file = join(dir, `${face.postscriptName}${face.path.slice(face.path.lastIndexOf("."))}`);
  try {
    writeFileSync(file, bytes);
    return await run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A T1 clip render on Lambda: the clip, its kit faces, and the claim. */
export type T1LambdaRequest = { clipId: string; durationS: number; claim: string | null };

export type T1LambdaDeps<T> = KitFaceDeps & {
  /** Set the type layers from the local face file (sharp) and return what the composition needs. */
  setType: (req: T1LambdaRequest, faceFile: string) => Promise<{ topUrl: string; claimUrl: string | null }>;
  renderOnLambda: (req: T1LambdaRequest, layers: { topUrl: string; claimUrl: string | null }) => Promise<T>;
};

/**
 * Render a T1 clip on Lambda (O53). The face is loaded and checked first; a
 * clip under 4.75 s renders without its claim (O37). No licence gate (O50).
 */
export async function renderT1ClipOnLambda<T>(req: T1LambdaRequest, face: { postscriptName: string; path: string }, deps: T1LambdaDeps<T>): Promise<{ rendered: T; claimDropped: string | null }> {
  const claim = req.claim ? claimAllowed(req.durationS) : { ok: true as const };
  const sent: T1LambdaRequest = claim.ok ? req : { ...req, claim: null };
  const layers = await withKitFace(face, deps, (file) => deps.setType(sent, file));
  return { rendered: await deps.renderOnLambda(sent, layers), claimDropped: claim.ok ? null : claim.line };
}
