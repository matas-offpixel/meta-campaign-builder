/**
 * lib/render-templates/start.ts — one path for starting a package, from the
 * Lab's Render (no approval: Matas starts it himself, RT1) and from
 * render_package (Matas's yes in Claude, RY1).
 *
 * Order (RY3): no approval → over the cap → a recipe not built → another
 * client's promoter footage in the picks → artist-voice copy with no
 * approved caption → needs missing → the cost guard. Nothing is downloaded,
 * planned or written before every refusal has passed; a refusal renders
 * nothing.
 *
 * Relative imports only (node:test).
 */

import { isApprovedCaption } from "../artist-library/load.ts";
import { beatGrid, type BeatGrid } from "./beats.ts";
import type { MontageVariant, Ratio } from "./file-name.ts";
import { driveIdFromLink, foreignPicks, loadPackageState, type Db, type LoadDeps, type LoadedPackage } from "./load.ts";
import { isRefusal, planMontage, type MontageText } from "./montage-plan.ts";
import { packageFiles, packageOwner, pickedClips, pickedTrack, refusalFor, requestLines, type Picks, type Refusal } from "./package-view.ts";
import { costGuard, saveBeatGrid, startPackage } from "./store.ts";
import { filesWord, m4, type Recipe } from "./words.ts";

export type StartDeps = LoadDeps & {
  /** The track's low-passed mono PCM (readEnvelopes' `low`), from its Storage copy. */
  readLowPcm(storagePath: string): Promise<Uint8Array>;
};

export type CopyPick = { hook?: string; voice?: "promoter" | "artist" };

export type RequestInput = {
  userId: string;
  eventId: string;
  recipes: readonly Recipe[];
  picks?: { clips?: readonly string[]; track?: string; copy?: CopyPick };
  source: "lab" | "claude";
  approval: { asked: string; answer: string } | null;
  now: Date;
  today: string;
  /** Re-render: just these files, at this round. */
  only?: readonly { variant: MontageVariant; ratio: Ratio }[];
  round?: number;
  /** The local runner's start: files begin as rendering, for it alone (store.ts). */
  hold?: boolean;
};

export type RequestResult =
  | { ok: true; packageId: string; files: number; fileNames: string[]; started: string; request: string[]; loaded: LoadedPackage }
  | { ok: false; refusal: Refusal; loaded: LoadedPackage | null };

/** The kit's date line from the stored date: "SUNDAY 27TH DECEMBER" (Bootzy caps; facts from source). */
export function kitDate(eventDate: string | null): string {
  if (!eventDate) return "";
  const d = new Date(`${eventDate.slice(0, 10)}T12:00:00Z`);
  const day = d.getUTCDate();
  const suffix = day % 10 === 1 && day !== 11 ? "ST" : day % 10 === 2 && day !== 12 ? "ND" : day % 10 === 3 && day !== 13 ? "RD" : "TH";
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(d).toUpperCase();
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(d).toUpperCase();
  return `${weekday} ${day}${suffix} ${month}`;
}

export function montageText(loaded: LoadedPackage, copy: CopyPick | undefined): MontageText {
  const { facts, state } = loaded;
  return {
    hook: (copy?.hook?.trim() || facts.name).toUpperCase(),
    date: kitDate(facts.eventDate),
    venue: (facts.venueName || facts.venueCity || "").toUpperCase(),
    lineup: state.lineup.map((a) => a.name.toUpperCase()),
    cta: state.claim.lines.map((l) => l.toUpperCase()),
  };
}

/** Is `hook` one of the artist's approved captions? (The library's own read, lib/artist-library/load.ts.) */
export async function approvedCaption(db: Db, artistName: string | null, hook: string | undefined): Promise<boolean> {
  if (!artistName || !hook?.trim()) return false;
  return isApprovedCaption(db, artistName, hook);
}

function resolvePicks(loaded: LoadedPackage, picks: RequestInput["picks"]): Picks {
  const clipIds = picks?.clips?.length
    ? picks.clips.map((key) => {
        const hit = loaded.clips.all.find((c) => c.id === key || (c.driveFileId && (c.driveFileId === key || c.driveFileId === driveIdFromLink(key))));
        return hit?.id ?? key;
      })
    : undefined;
  return { clipIds, trackId: picks?.track };
}

export async function requestPackage(db: Db, deps: StartDeps, input: RequestInput): Promise<RequestResult> {
  const loaded = await loadPackageState(db, input.eventId, deps, input.now, input.today);
  if (!loaded) return { ok: false, refusal: { refused: "needs", text: m4("m4.mcp.refused.unknown_event", { code: input.eventId }), recipe: "montage", needs: "" }, loaded: null };
  const picks = resolvePicks(loaded, input.picks);
  const voice = input.picks?.copy?.voice ?? "promoter";
  const lead = loaded.state.lineup.find((a) => a.isHeadliner)?.name ?? loaded.state.lineup[0]?.name ?? null;
  const refusal = refusalFor({
    approval: input.source === "lab" || Boolean(input.approval),
    recipes: input.recipes,
    state: loaded.state,
    picks,
    foreignPromoter: foreignPicks(loaded.clips.all, picks.clipIds),
    copy: { voice, approvedCaption: voice === "artist" ? await approvedCaption(db, lead, input.picks?.copy?.hook) : true, artist: lead },
  });
  if (refusal) return { ok: false, refusal, loaded };
  const recipe = input.recipes[0]!;
  const guarded = await costGuard(db, { eventId: loaded.facts.id, eventCode: loaded.facts.code, recipe, now: input.now });
  if (guarded && !guarded.ok) return { ok: false, refusal: { refused: guarded.refused, text: guarded.text, lab: guarded.lab }, loaded };

  const track = pickedTrack(loaded.state, picks)!;
  const trackRow = loaded.tracks.find((t) => t.id === track.id)!;
  let grid: BeatGrid | null = trackRow.beatGrid;
  if (!grid) {
    grid = beatGrid(await deps.readLowPcm(trackRow.storagePath!), track.dropS!, { durationS: track.durationS ?? undefined });
    await saveBeatGrid(db, track.id, grid, track.dropS!, input.now);
  }
  const clips = pickedClips(loaded.state, picks);
  const plan = planMontage({
    grid,
    drop: { trackS: track.dropS!, source: track.dropSource ?? "lab" },
    trackName: track.name,
    clips: clips.map((c) => ({ id: c.id, name: c.name, owner: c.owner, isHeadliner: c.isHeadliner, inS: c.inS, outS: c.outS })),
    text: montageText(loaded, input.picks?.copy),
  });
  if (isRefusal(plan)) {
    const needs = plan.refused === "too_few_clips" || plan.refused === "repeat_clip" ? "clips" : m4("m4.need.track").toLowerCase();
    return { ok: false, refusal: { refused: "needs", text: m4("m4.mcp.missing", { recipe: m4("m4.recipe.montage"), code: loaded.facts.code, needs }), recipe, needs }, loaded };
  }
  const owner = packageOwner(loaded.state, picks)!;
  const files = input.only?.length ? [...input.only] : packageFiles();
  const started = await startPackage(db, {
    userId: input.userId,
    eventId: loaded.facts.id,
    eventCode: loaded.facts.code,
    clientId: loaded.facts.clientId,
    recipe,
    stage: loaded.facts.stage,
    source: input.source,
    owner,
    files,
    picks: { clipIds: clips.map((c) => c.id), trackId: track.id, voice },
    plan,
    approval: input.approval,
    now: input.now,
    round: input.round,
    hold: input.hold,
  });
  if (!started.ok) return { ok: false, refusal: { refused: started.refused, text: started.text, lab: started.lab }, loaded };
  const n = files.length;
  const startedLine =
    input.source === "claude"
      ? m4("m4.mcp.started", { files: filesWord(n), code: loaded.facts.code })
      : n === 1
        ? m4("m4.render.started.one")
        : m4("m4.render.started", { n });
  return { ok: true, packageId: started.packageId, files: n, fileNames: started.fileNames, started: startedLine, request: requestLines(loaded.state, input.recipes, picks), loaded };
}
