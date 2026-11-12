/**
 * One made triple-fit, outside a caption round, through renderTripleFitClip.
 *
 * This lives apart from render.ts on purpose. triple-fit-render.ts paints
 * with sharp and reaches artist-card.ts, which loads @vladmandic/face-api
 * and the selfie model. render.ts is imported by the caption render route
 * (/api/admin/remotion/render-caption), and every file it imports is traced
 * into that Vercel function: importing triple-fit-render.ts from render.ts
 * put the route over the 250 MB limit (#1186). Only
 * scripts/triple-fit-lab-draft.mts calls this today.
 */

import type { ServiceRoleDb } from "./load.ts";
import { defaultSign, one, probeClip, type RenderDeps } from "./render.ts";
import { renderTripleFitClip, type TripleFitHooks } from "./triple-fit-render.ts";

/** Nothing is written to creative_lab_renders. The claim is the event's approved ladder claim. */
export async function renderMadeTripleFit(
  db: ServiceRoleDb,
  input: {
    clipId?: string;
    /** Used when the made row is not stored yet. It still has to name its source clip. */
    clip?: Record<string, unknown>;
    signUrl?: RenderDeps["signUrl"];
    probe?: RenderDeps["probe"];
    serveUrl?: string;
    hooks?: TripleFitHooks;
  },
): Promise<Awaited<ReturnType<typeof renderTripleFitClip>>> {
  const clip = input.clip ?? (input.clipId ? await one(db, "creative_lab_clips", input.clipId) : null);
  if (!clip) throw new Error("clip not found");
  if (!String(clip.triple_fit_source_id ?? "").trim()) throw new Error("This clip is not a triple-fit");
  return renderTripleFitClip({
    db,
    clip,
    signUrl: input.signUrl ?? defaultSign,
    probe: input.probe ?? probeClip,
    serveUrl: input.serveUrl,
    hooks: input.hooks,
  });
}
