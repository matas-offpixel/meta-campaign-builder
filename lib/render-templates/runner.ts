/**
 * lib/render-templates/runner.ts — the local runner's choices
 * (scripts/render-package.mts), kept here so they're tested.
 *
 *   - runnerTrack: `--track <creative_lab_audio_files.id>` picks the track;
 *     an id that isn't a usable track on this show (not this event's, no
 *     drop, rights flagged, unusable or no Storage copy) is refused before
 *     anything renders. Without it, the first track in loadTracks' order
 *     (billing order, a drop set by hand before the Lab's, oldest first).
 *   - trackLine: the chosen track's name, id and drop, printed before the
 *     plan so the yes is given on the right track.
 *   - dryRunLines: the plan the dry run prints, for the same picks the
 *     apply sends.
 *
 * The runner's lines are console output for the operator running it, not
 * screen or Claude words. Relative imports only (node:test).
 */

import { beatGrid } from "./beats.ts";
import { badgeLine, fileRights } from "./rights.ts";
import type { LoadedPackage, TrackRow } from "./load.ts";
import { cutSheetText, isRefusal, planMontage } from "./montage-plan.ts";
import { packageFiles, packageOwner, pickedClips, pickedTrack, refusalFor } from "./package-view.ts";
import { montageText, type StartDeps } from "./start.ts";
import { fileNameFor } from "./store.ts";

export const RUNNER_LINES = {
  badTrack: "That track can't be used for this show. Nothing was rendered.",
} as const;

export type TrackChoice = { ok: true; track: TrackRow | null } | { ok: false; line: string };

/** The track the runner renders: `--track` when given (and usable here), else loadTracks' first usable one. */
export function runnerTrack(loaded: LoadedPackage, trackId: string | null): TrackChoice {
  if (trackId) {
    const hit = loaded.tracks.find((t) => t.id === trackId && t.dropS != null && !t.flagged && t.storagePath);
    return hit ? { ok: true, track: hit } : { ok: false, line: RUNNER_LINES.badTrack };
  }
  const first = pickedTrack(loaded.state);
  return { ok: true, track: first ? loaded.tracks.find((t) => t.id === first.id) ?? null : null };
}

/** "Track: Make Believe · 9f5086f2-… · drop at 21.737 s, set by hand". */
export function trackLine(track: TrackRow): string {
  const how = track.dropSource === "operator" ? "set by hand" : "the Lab's";
  return `Track: ${track.name} · ${track.id} · drop at ${track.dropS!.toFixed(3)} s, ${how}`;
}

/** The dry run's plan for these picks: the cut sheet and every file's name and rights, or why it would be refused. */
export async function dryRunLines(loaded: LoadedPackage, deps: Pick<StartDeps, "readLowPcm">, trackId: string | null): Promise<string[]> {
  const picks = trackId ? { trackId } : {};
  const refusal = refusalFor({ approval: true, recipes: ["montage"], state: loaded.state, picks, foreignPromoter: [], copy: { voice: "promoter", approvedCaption: true, artist: null } });
  if (refusal) return [`Would be refused: ${refusal.text}`];
  const track = pickedTrack(loaded.state, picks)!;
  const row = loaded.tracks.find((t) => t.id === track.id)!;
  const grid = row.beatGrid ?? beatGrid(await deps.readLowPcm(row.storagePath!), track.dropS!, { durationS: track.durationS ?? undefined });
  const clips = pickedClips(loaded.state, picks);
  const plan = planMontage({
    grid,
    drop: { trackS: track.dropS!, source: track.dropSource ?? "lab" },
    trackName: track.name,
    clips: clips.map((c) => ({ id: c.id, name: c.name, owner: c.owner, isHeadliner: c.isHeadliner, inS: c.inS, outS: c.outS })),
    text: montageText(loaded, undefined),
  });
  if (isRefusal(plan)) return [`Would be refused: the plan says ${plan.refused}`];
  const owner = packageOwner(loaded.state, picks)!;
  const lines = [`Cut plan (announcement; teaser and no text share the cuts):`, cutSheetText(plan.sheet, "announcement").trimEnd(), `Files (round to be set at start; shown as r1):`];
  for (const f of packageFiles()) {
    const name = fileNameFor({ eventCode: loaded.facts.code, owner, recipe: "montage", variant: f.variant, stage: loaded.facts.stage, round: 1, ratio: f.ratio });
    const badge = badgeLine(fileRights(owner, f.variant !== "no-text", loaded.facts.clientId), loaded.facts.clientName);
    lines.push(`  ${name} · ${badge.badge}${badge.why ? ` · ${badge.why}` : ""}`);
  }
  return lines;
}
