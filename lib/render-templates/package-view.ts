/**
 * lib/render-templates/package-view.ts — what a package needs and what it
 * will render (RT1), and what Claude is told (RT3 as re-ruled by RY1–RY3).
 *
 * Pure: load.ts reads the event's state; this turns it into the card the Lab
 * shows, the lines Claude gets, and the refusals, all in M4's words.
 *
 * Only material this show can use reaches here: shareable files and the
 * show's client's own (get_artist's rule, usableOn in artist-library/rights).
 * load.ts drops everything else before this sees it, and counts it only for
 * the promoter refusal.
 *
 * Relative imports only (node:test).
 */

import { MONTAGE_VARIANTS, RATIOS, type MontageVariant, type Ratio } from "./file-name.ts";
import { MONTAGE } from "./montage-plan.ts";
import { montageOwner, ownerLabel, type RenderOwner } from "./rights.ts";
import { M4_WORDS, candidate, filesWord, m4, recipeWord, recipesWord, stageWord, type Recipe, type Stage } from "./words.ts";

/** Files per recipe: montage 3 versions × 3 ratios; roll-call and top tracks CTA / No CTA × 3; artist card 3 versions × (3 statics + 1 video). */
export const RECIPE_FILES: Record<Recipe, number> = { montage: 9, "roll-call": 6, "top-tracks": 6, "artist-card": 12 };
export const BUILT_RECIPES: readonly Recipe[] = ["montage"];

/**
 * The file cap for one package (RY3: the builder sets it). 24 lets one yes
 * carry the montage with the roll-call and top tracks beside it (9 + 6 + 6 =
 * 21) once they're built, and stops the all-four package (33) and anything
 * a loop could stack up: one call can never start more than 24 Lambda
 * renders.
 */
export const MAX_PACKAGE_FILES = 24;

export type NeedState = "ready" | "short" | "none" | "missing";
export type NeedKey = "clips" | "track" | "lineup" | "kit" | "claim" | "raw_clip" | "press_shot" | "tracks" | "artwork" | "snippets" | "details";

export type Need = {
  key: NeedKey;
  label: string;
  /** The ochre "{n} of {m} picked" carries n and m. */
  state: NeedState;
  n?: number;
  m?: number;
  /** The detail beside the label: whose clips, the drop, the kit, the claim and when the tiers were read. */
  detail: string | null;
  /** Where Pick goes: the Lab's own place to add or set it. Null when ready. */
  pick: string | null;
};

export type CandidateClip = {
  id: string;
  name: string;
  owner: "artist" | "promoter";
  /** The client the clip's Lab artist belongs to: the one promoter footage stays with. */
  clientId: string;
  clientName: string;
  artistName: string | null;
  isHeadliner: boolean;
  inS: number;
  outS: number;
  driveFileId: string | null;
};

export type CandidateTrack = {
  id: string;
  name: string;
  artistName: string | null;
  dropS: number | null;
  dropSource: "lab" | "operator" | null;
  durationS: number | null;
  flagged: boolean;
  /** The drop's place in the montage, when the beat grid is known. */
  dropAtS: number | null;
};

export type ClaimState = { state: "ready" | "none" | "missing"; text: string | null; lines: string[]; readAt: string | null };

export type PackageState = {
  event: { id: string; code: string; name: string; clientId: string; clientName: string; stage: Stage; date: string | null; venue: string | null };
  lineup: { name: string; isHeadliner: boolean }[];
  /** Usable on this event only, already ordered headliners first. */
  clips: CandidateClip[];
  tracks: CandidateTrack[];
  kit: { ready: boolean };
  claim: ClaimState;
};

export type Picks = { clipIds?: string[]; trackId?: string };

/** London "Wed 25 Nov, 09:00" (the records' {date, time}). */
export function londonDateTime(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

/** The clips the montage takes: the picks when given (usable ones, in order), else the first 16 usable. */
export function pickedClips(state: PackageState, picks: Picks = {}): CandidateClip[] {
  if (picks.clipIds?.length) {
    const byId = new Map(state.clips.flatMap((c) => [[c.id, c] as const, ...(c.driveFileId ? [[c.driveFileId, c] as const] : [])]));
    const out: CandidateClip[] = [];
    for (const id of picks.clipIds) {
      const clip = byId.get(id);
      if (clip && !out.includes(clip)) out.push(clip);
    }
    return out.slice(0, MONTAGE.clips);
  }
  return state.clips.slice(0, MONTAGE.clips);
}

export function pickedTrack(state: PackageState, picks: Picks = {}): CandidateTrack | null {
  const usable = state.tracks.filter((t) => t.dropS != null && !t.flagged);
  if (picks.trackId) return usable.find((t) => t.id === picks.trackId) ?? null;
  return usable[0] ?? null;
}

/** "{a} filmed by {client} · {b} {artist}’s", one part per owner, a part with none left out. */
export function clipsMix(clips: readonly CandidateClip[], clientName: string): string | null {
  if (!clips.length) return null;
  const template = M4_WORDS["m4.need.clips.mix"];
  const [promoterPart, artistPart] = template.split(" · ") as [string, string];
  const parts: string[] = [];
  const promoter = clips.filter((c) => c.owner === "promoter").length;
  if (promoter) parts.push(promoterPart.replace("{a}", String(promoter)).replace("{client}", clientName));
  const byArtist = new Map<string, number>();
  for (const c of clips) if (c.owner === "artist" && c.artistName) byArtist.set(c.artistName, (byArtist.get(c.artistName) ?? 0) + 1);
  for (const [artist, b] of byArtist) parts.push(artistPart.replace("{b}", String(b)).replace("{artist}", artist));
  return parts.join(" · ");
}

function stateWord(need: Pick<Need, "state" | "n" | "m">): string {
  if (need.state === "ready") return m4("m4.need.ready");
  if (need.state === "short") return m4("m4.need.count", { n: need.n ?? 0, m: need.m ?? 0 });
  if (need.state === "none") return m4("m4.need.none");
  return m4("m4.need.missing");
}

export type CardLinks = { clips: string; track: string; claim: string; lineup: string; kit: string };

export const DEFAULT_LINKS = (eventId: string): CardLinks => ({
  clips: `/events/${eventId}?tab=creative-lab#lab-clips`,
  track: `/events/${eventId}?tab=creative-lab#lab-snippet`,
  claim: `/today#claims`,
  lineup: `/events/${eventId}?tab=creative-lab#lab-lineup`,
  kit: `/events/${eventId}?tab=drive`,
});

/** The montage's needs (RT1): 16 clips, track and drop, lineup, overlay kit, claim. */
export function montageNeeds(state: PackageState, picks: Picks = {}, links: CardLinks = DEFAULT_LINKS(state.event.id)): Need[] {
  const clips = pickedClips(state, picks);
  const m = MONTAGE.clips;
  const clipNeed: Need = {
    key: "clips",
    label: m4("m4.need.clips", { m }),
    state: clips.length >= m ? "ready" : clips.length > 0 ? "short" : "missing",
    n: clips.length,
    m,
    detail: clipsMix(clips, state.event.clientName),
    pick: clips.length >= m ? null : links.clips,
  };
  const track = pickedTrack(state, picks);
  const anyTrack = state.tracks.length > 0;
  const trackNeed: Need = {
    key: "track",
    label: m4("m4.need.track"),
    state: track ? "ready" : anyTrack ? "none" : "missing",
    detail: track?.dropAtS != null ? m4("m4.need.track.drop", { s: track.dropAtS.toFixed(1) }) : null,
    pick: track ? null : links.track,
  };
  const n = state.lineup.length;
  const lineupNeed: Need = {
    key: "lineup",
    label: m4("m4.need.lineup"),
    state: n > 0 ? "ready" : "missing",
    detail: n === 1 ? m4("m4.need.lineup.count.one") : n > 1 ? m4("m4.need.lineup.count", { n }) : null,
    pick: n > 0 ? null : links.lineup,
  };
  const kitNeed: Need = {
    key: "kit",
    label: m4("m4.need.kit"),
    state: state.kit.ready ? "ready" : "missing",
    detail: state.kit.ready ? m4("m4.need.kit.name", { client: state.event.clientName }) : null,
    pick: null,
  };
  const claimNeed: Need = {
    key: "claim",
    label: m4("m4.need.claim"),
    state: state.claim.state === "ready" ? "ready" : state.claim.state === "none" ? "none" : "missing",
    detail: state.claim.state === "ready" && state.claim.text ? m4("m4.need.claim.line", { claim: state.claim.text, "date, time": state.claim.readAt ? londonDateTime(state.claim.readAt) : "" }) : null,
    pick: state.claim.state === "ready" ? null : links.claim,
  };
  return [clipNeed, trackNeed, lineupNeed, kitNeed, claimNeed];
}

export function versionsLine(variants: readonly MontageVariant[] = MONTAGE_VARIANTS, ratios: readonly Ratio[] = RATIOS): string {
  const word = (v: MontageVariant) => (v === "no-text" ? M4_WORDS["m4.variant.no_text"] : v === "teaser" ? M4_WORDS["m4.variant.teaser"] : M4_WORDS["m4.variant.announcement"]);
  const versions = variants.map((v, i) => (i === 0 ? word(v) : word(v).toLowerCase())).join(", ");
  return m4("m4.render.files", { versions, ratios: ratios.join(", ") });
}

export type RecipeCard = {
  recipe: Recipe;
  title: string;
  what: string;
  built: boolean;
  owner: string;
  needs: (Need & { stateWord: string })[];
  ready: boolean;
  files: number;
  button: string | null;
  under: string | null;
  muted: string | null;
};

const WHAT: Record<Recipe, string> = {
  montage: M4_WORDS["m4.recipe.montage.what"],
  "roll-call": M4_WORDS["m4.recipe.roll_call.what"],
  "top-tracks": M4_WORDS["m4.recipe.top_tracks.what"],
  "artist-card": M4_WORDS["m4.recipe.artist_card.what"],
};

export function packageOwner(state: PackageState, picks: Picks = {}): RenderOwner | null {
  const clips = pickedClips(state, picks);
  if (!clips.length) return null;
  const lead = state.lineup.find((a) => a.isHeadliner)?.name ?? state.lineup[0]?.name ?? null;
  const leadArtist = clips.find((c) => c.artistName === lead)?.artistName ?? clips.find((c) => c.artistName)?.artistName ?? lead;
  return montageOwner(clips, { name: state.event.clientName }, leadArtist);
}

/** The muted cards' needs, as the record draws them, from what the event holds. Never actionable. */
export type MutedInputs = {
  rawClip: string | null;
  pressShot: string | null;
  /** Top tracks: tracks with a drop picked. */
  tracks: number;
  /** Artist card: track snippets picked. */
  snippets: number;
  artwork: string | null;
  details: string | null;
  artistName: string | null;
};

function simple(key: NeedKey, label: string, ready: boolean, detail: string | null, link: string | null): Need {
  return { key, label, state: ready ? "ready" : "missing", detail: ready ? detail : null, pick: ready ? null : link };
}

export function mutedNeeds(recipe: Exclude<Recipe, "montage">, state: PackageState, muted: MutedInputs, links: CardLinks): Need[] {
  const kit = montageNeeds(state, {}, links).find((n) => n.key === "kit")!;
  const claim = montageNeeds(state, {}, links).find((n) => n.key === "claim")!;
  if (recipe === "roll-call") return [simple("raw_clip", m4("m4.need.raw_clip"), Boolean(muted.rawClip), muted.rawClip, links.clips), kit, claim];
  const press = simple("press_shot", m4("m4.need.press_shot"), Boolean(muted.pressShot), muted.pressShot, links.clips);
  const count = (key: "tracks" | "snippets", m: number): Need => {
    const n = Math.min(key === "tracks" ? muted.tracks : muted.snippets, m);
    const label = key === "tracks" ? (m === 1 ? m4("m4.need.tracks.one") : m4("m4.need.tracks", { m })) : m === 1 ? m4("m4.need.snippets.one") : m4("m4.need.snippets", { m });
    return { key, label, state: n >= m ? "ready" : n > 0 ? "short" : "none", n, m, detail: null, pick: n >= m ? null : links.track };
  };
  if (recipe === "top-tracks") return [press, count("tracks", 3), simple("artwork", m4("m4.need.artwork"), Boolean(muted.artwork), muted.artwork, links.kit)];
  return [press, count("snippets", 3), simple("details", m4("m4.need.details"), Boolean(muted.details), muted.details, null)];
}

export function recipeCards(state: PackageState, muted: MutedInputs, picks: Picks = {}, links: CardLinks = DEFAULT_LINKS(state.event.id)): RecipeCard[] {
  const withWords = (needs: Need[]) => needs.map((n) => ({ ...n, stateWord: stateWord(n) }));
  const needs = montageNeeds(state, picks, links);
  const ready = needs.every((n) => n.state === "ready");
  const files = RECIPE_FILES.montage;
  const montage: RecipeCard = {
    recipe: "montage",
    title: recipeWord("montage"),
    what: WHAT.montage,
    built: true,
    owner: ownerLabel(packageOwner(state, picks)),
    needs: withWords(needs),
    ready,
    files,
    button: files === 1 ? m4("m4.render.one") : m4("m4.render", { n: files }),
    under: versionsLine(),
    muted: null,
  };
  const artistOwner = muted.artistName ? m4("m4.owner.artist", { artist: muted.artistName }) : m4("m4.owner.pending");
  const later = (["roll-call", "top-tracks", "artist-card"] as const).map(
    (recipe): RecipeCard => ({
      recipe,
      title: recipeWord(recipe),
      what: WHAT[recipe],
      built: false,
      owner: artistOwner,
      needs: withWords(mutedNeeds(recipe, state, muted, links)),
      ready: false,
      files: RECIPE_FILES[recipe],
      button: null,
      under: null,
      muted: m4("m4.recipe.later"),
    }),
  );
  return [montage, ...later];
}

/** "{code} · {stage}" and the rights line under the title. */
export function pickerHeader(state: PackageState): { title: string; forLine: string; rights: string } {
  return {
    title: m4("m4.picker.title"),
    forLine: m4("m4.picker.for", { code: state.event.code, stage: stageWord(state.event.stage) }),
    rights: m4("m4.picker.rights", { client: state.event.clientName }),
  };
}

// ─── What Claude is told ─────────────────────────────────────────────────────

/** One recipe's needs as the card shows them: "16 clips ready (11 filmed by Puzzle · 5 Enzo Siragusa’s)". */
export function needsLine(needs: readonly Need[]): string {
  return needs
    .map((n) => {
      const label = n.key === "clips" || n.key === "tracks" || n.key === "snippets" ? n.label : n.label.charAt(0).toLowerCase() + n.label.slice(1);
      return `${label} ${stateWord(n)}${n.detail ? ` (${n.detail})` : ""}`;
    })
    .join(" · ");
}

/** The missing list for RT3's refusal: "clips (5 of 16 picked), track and drop, overlay kit and claim". */
export function missingList(needs: readonly Need[]): string {
  const parts = needs
    .filter((n) => n.state !== "ready")
    .map((n) => {
      const base = n.key === "clips" ? "clips" : n.label.charAt(0).toLowerCase() + n.label.slice(1);
      return n.state === "short" ? `${base} (${stateWord(n)})` : base;
    });
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** RT3's request lines: the package line, then one line per recipe with its needs. */
export function requestLines(state: PackageState, recipes: readonly Recipe[], picks: Picks = {}): string[] {
  const files = recipes.reduce((s, r) => s + RECIPE_FILES[r], 0);
  const lines = [m4("m4.mcp.request", { code: state.event.code, client: state.event.clientName, recipes: recipesWord(recipes), files: filesWord(files) })];
  for (const r of recipes) if (r === "montage") lines.push(m4("m4.mcp.recipe", { recipe: recipeWord(r), needs: needsLine(montageNeeds(state, picks)) }));
  return lines;
}

export type Refusal =
  | { refused: "no_approval"; text: string }
  | { refused: "cap"; text: string; files: number }
  | { refused: "not_built"; text: string; recipe: Recipe }
  | { refused: "promoter"; text: string; count: number; clientName: string }
  | { refused: "voice"; text: string; artist: string }
  | { refused: "needs"; text: string; recipe: Recipe; needs: string }
  | { refused: "busy" | "too_soon"; text: string };

export type PickedFromElsewhere = { clientName: string; count: number };

/**
 * RY3's refusals, in order: no approval; over the cap; another client's
 * promoter footage in the picks (counted); artist-voice copy with no
 * approved caption; needs missing. Each ends "Nothing was rendered.".
 * Null when the package may start (the cost guard is the store's).
 */
export function refusalFor(input: {
  approval: boolean;
  recipes: readonly Recipe[];
  state: PackageState;
  picks: Picks;
  /** Picked clips that are another client's promoter footage, by that client. */
  foreignPromoter: readonly PickedFromElsewhere[];
  copy: { voice: "promoter" | "artist"; approvedCaption: boolean; artist: string | null };
}): Refusal | null {
  if (!input.approval) return { refused: "no_approval", text: m4("m4.mcp.refused.no_approval") };
  const files = input.recipes.reduce((s, r) => s + RECIPE_FILES[r], 0);
  if (files > MAX_PACKAGE_FILES) return { refused: "cap", text: m4("m4.mcp.refused.cap", { n: files, c: MAX_PACKAGE_FILES }), files };
  const unbuilt = input.recipes.find((r) => !BUILT_RECIPES.includes(r));
  if (unbuilt) return { refused: "not_built", text: candidate("notBuilt", { recipe: recipeWord(unbuilt) }), recipe: unbuilt };
  const foreign = [...input.foreignPromoter].sort((a, b) => b.count - a.count)[0];
  if (foreign && foreign.count > 0) {
    const text =
      foreign.count === 1
        ? m4("m4.mcp.refused.promoter.one", { client: foreign.clientName, "show client": input.state.event.clientName })
        : m4("m4.mcp.refused.promoter", { n: foreign.count, client: foreign.clientName, "show client": input.state.event.clientName });
    return { refused: "promoter", text, count: foreign.count, clientName: foreign.clientName };
  }
  if (input.copy.voice === "artist" && !input.copy.approvedCaption) {
    const artist = input.copy.artist ?? "";
    return { refused: "voice", text: m4("m4.mcp.refused.voice", { artist }), artist };
  }
  for (const recipe of input.recipes) {
    const needs = montageNeeds(input.state, input.picks);
    if (needs.some((n) => n.state !== "ready")) {
      const list = missingList(needs);
      return { refused: "needs", text: m4("m4.mcp.missing", { recipe: recipeWord(recipe), code: input.state.event.code, needs: list }), recipe, needs: list };
    }
  }
  return null;
}

/** Today's muted line for a refused package (RY2). */
export function refusalRowLine(r: Refusal): string {
  if (r.refused === "no_approval") return "";
  if (r.refused === "cap") return m4("today.mcp.row.refused.cap", { c: MAX_PACKAGE_FILES });
  if (r.refused === "promoter") return m4("today.mcp.row.refused.promoter", { client: r.clientName });
  if (r.refused === "voice") return m4("today.mcp.row.refused.voice");
  if (r.refused === "needs") return m4("today.mcp.row.refused.needs", { recipe: recipeWord(r.recipe), needs: r.needs });
  return "";
}

/** The files a package renders: every version × ratio (montage). */
export function packageFiles(): { variant: MontageVariant; ratio: Ratio }[] {
  return MONTAGE_VARIANTS.flatMap((variant) => RATIOS.map((ratio) => ({ variant, ratio })));
}
