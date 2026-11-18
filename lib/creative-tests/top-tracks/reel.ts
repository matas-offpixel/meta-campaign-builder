/**
 * Top tracks, the reel's pure rules (docs/design-record/2026-11-18-creative-lab-top-tracks.html):
 * TK1's format and file name, TK2's four headlines, TK4's order, reveal and
 * playing row, TK5's row, TK6's layout, TK9's ends, TK10's options and words.
 * The audio's rules are audio-rules.ts; the bands and face test are
 * layout.ts; the composition is src/remotion/compositions/TopTracks.tsx.
 *
 * No imports from the Node side: the composition and the Lab tab both read
 * this. Every string is the record's.
 */

import type { EndKind, Framing, Ladder, RowsAppear, TrackCount } from "./frame.ts";

// ── TK1: the format ─────────────────────────────────────────────────────────

export const TOP_TRACKS = {
  width: 1080,
  height: 1920,
  fps: 30,
  /** O96's band: every piece sits inside x 120–960, y 353–1238. */
  band: { left: 120, right: 960, top: 353, bottom: 1238 },
  /** Feed's centre 4:5 (O95). */
  feed: { top: 285, bottom: 1635 },
} as const;

export type { EndKind, Framing, Ladder, RowsAppear, TrackCount };
export const FRAMINGS: readonly Framing[] = ["ranked", "level", "forever", "cant-live"];

export type EndCardPlace = "column" | "centred";
export type ListSide = "left" | "right";
export type BackgroundKind = "press" | "dj" | "montage" | "broll";

export type ReelOptions = {
  framing: Framing;
  tracks: TrackCount;
  rowsAppear: RowsAppear;
  ladder: Ladder;
  end: EndKind;
  endCard: EndCardPlace;
  list: ListSide;
  background: BackgroundKind;
};

/** TK10: defaults first. */
export const DEFAULT_OPTIONS: ReelOptions = { framing: "ranked", tracks: 5, rowsAppear: "start", ladder: "joke", end: "date", endCard: "column", list: "left", background: "press" };

/** TK1: {event code}_{artist}_top-tracks-{framing}-{n}tracks-{cta|nocta}-{stage}_r{n}_9x16.mp4. A draft adds _draft before _9x16 (as the T1 drafts do). */
export function topTracksFileName(input: { eventCode: string | null; artistSlug: string; framing: Framing; tracks: number; end: EndKind; stage: string; roundNo: number; draft?: boolean }): string {
  const code = input.eventCode?.trim();
  const body = `${input.artistSlug}_top-tracks-${input.framing}-${input.tracks}tracks-${input.end === "date" ? "cta" : "nocta"}-${input.stage}_r${input.roundNo}${input.draft ? "_draft" : ""}_9x16.mp4`;
  return code ? `${code}_${body}` : body;
}

// ── TK2: the headline ───────────────────────────────────────────────────────

/** TK2's four headlines, Matas's words, exact. The apostrophe is the kit's typographic ’. */
export function headline(framing: Framing, artist: string, n: number): string {
  switch (framing) {
    case "ranked":
      return `Top ${artist} tracks ranked 1–${n}`;
    case "forever":
      return `${artist} tracks that changed music forever`;
    case "level":
      return `What’s your ${artist} level?`;
    case "cant-live":
      return `${artist} tracks we can’t live without`;
  }
}

/** TK10 at 393: the narrow chip shortens to its ending after the artist's name. */
export function narrowChip(framing: Framing, artist: string, n: number): string {
  if (framing === "forever") return "… changed music forever";
  if (framing === "cant-live") return "… we can’t live without";
  return headline(framing, artist, n);
}

/** The kit's case: Puzzle's is uppercase. */
export function kitCase(text: string, kase: "upper" | "as-is"): string {
  return kase === "upper" ? text.toLocaleUpperCase("en-GB") : text;
}

/** Ranked and Level are Spotify's order (TK2). */
export function isSpotifyOrdered(framing: Framing): boolean {
  return framing === "ranked" || framing === "level";
}

// ── TK3 → the reel's timeline, TK4's reveal (frame.ts, re-exported) ─────────

export { JOIN, REVEAL, endState, playOrder, reelTimeline, rowForPlay, rowMarkers, rowState, rungs, type ReelTimeline, type RowState, type TimedSnippet } from "./frame.ts";

// ── TK5: a row ──────────────────────────────────────────────────────────────

/** TK5: "with {names}" from Spotify's artists less this one, ", " and " & " before the last; left out when the title already names them. */
export function withLine(title: string, spotifyArtists: readonly string[], artist: string): string | null {
  const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const others = spotifyArtists.filter((a) => norm(a) !== norm(artist));
  if (!others.length) return null;
  if (/\b(feat\.|with)\s/i.test(title)) return null;
  const names = others.length === 1 ? others[0]! : `${others.slice(0, -1).join(", ")} & ${others[others.length - 1]}`;
  return `with ${names}`;
}

// ── TK6: sizes and the fit ──────────────────────────────────────────────────

export const TK_TYPE = {
  /** Headline: cap 0.024 H, at most 2 lines in 840 px, steps 0.85 and 0.75. */
  headline: { capPx: 46, maxLines: 2, maxWidth: 840, steps: [1, 0.85, 0.75] as const },
  /** Titles: cap 40 px for 4–5 rows, 52 for 3, at most 2 lines, same steps. */
  title: { capPx4to5: 40, capPx3: 52, maxLines: 2, steps: [1, 0.85, 0.75] as const },
  /** The "with" line at 0.65 of the title's cap. */
  withRatio: 0.65,
  number: { capPx4to5: 56, capPx3: 72 },
  rung: { capPx4to5: 44, capPx3: 56 },
  /** The list column: 480 px; 70 px under the headline's last baseline; last baseline on or above 1238. */
  column: { width: 480, gapUnderHeadline: 70 },
  /** The accent bar: 6 px, on the list's outer edge (x 120, or 954 for a list on the right). The list's type starts 18 px inside it (invented in the build): the bar never sits on a number, and a title's 24 px slide starts on x 120, inside the band. */
  bar: { width: 6, gap: 18 },
  /** Gap between the marker column and the titles (invented in the build: half the marker's cap). */
  markerGapPerCap: 0.5,
  /** Line pitch: cap top to next cap top, in caps (invented in the build, as T1's details). */
  pitchPerCap: 1.35,
  /** Empty rows (Forever, can't-live): 2 px rules at 40 %. */
  ruleHeight: 2,
} as const;

export type Measure = (text: string, capPx: number) => number;

/**
 * Greedy word wrap into at most `maxLines` lines of `maxWidth`, never
 * splitting `unbroken` (the artist's name) across lines. Null when it can't.
 */
export function wrap(text: string, capPx: number, maxWidth: number, maxLines: number, measure: Measure, unbroken: string | null = null): string[] | null {
  const tokens: string[] = [];
  let rest = text;
  if (unbroken && rest.toLowerCase().includes(unbroken.toLowerCase())) {
    const at = rest.toLowerCase().indexOf(unbroken.toLowerCase());
    tokens.push(...rest.slice(0, at).split(/\s+/).filter(Boolean), rest.slice(at, at + unbroken.length));
    rest = rest.slice(at + unbroken.length);
    const tail = rest.split(/\s+/).filter(Boolean);
    // A trailing "?" or "’s" stays on the name's token.
    if (tail.length && !/\s/.test(rest[0] ?? " ")) tokens[tokens.length - 1] += tail.shift();
    tokens.push(...tail);
  } else tokens.push(...rest.split(/\s+/).filter(Boolean));
  const lines: string[] = [];
  let line = "";
  for (const tok of tokens) {
    const next = line ? `${line} ${tok}` : tok;
    if (measure(next, capPx) <= maxWidth + 1e-6) line = next;
    else {
      if (!line || measure(tok, capPx) > maxWidth + 1e-6) return null;
      lines.push(line);
      line = tok;
    }
  }
  if (line) lines.push(line);
  return lines.length <= maxLines ? lines : null;
}

/** The size steps: the first step whose wrap fits, or null. */
export function fitSteps(text: string, baseCap: number, steps: readonly number[], maxWidth: number, maxLines: number, measure: Measure, unbroken: string | null = null): { capPx: number; lines: string[]; step: number } | null {
  for (let i = 0; i < steps.length; i += 1) {
    const capPx = Math.round(baseCap * steps[i]! * 100) / 100;
    const lines = wrap(text, capPx, maxWidth, maxLines, measure, unbroken);
    if (lines) return { capPx, lines, step: i };
  }
  return null;
}

export type PlacedLine = { text: string; capPx: number; capTop: number; left: number; width: number; role: "headline" | "title" | "with" | "marker" };

export type RowLayout = {
  index: number;
  marker: PlacedLine | null;
  title: PlacedLine[];
  withLine: PlacedLine[];
  /** The row's band (for the bar and the rule). */
  top: number;
  bottom: number;
};

export type ReelLayout = {
  headline: PlacedLine[];
  rows: RowLayout[];
  column: { left: number; right: number };
  bar: { left: number };
  titleLeft: number;
};

export type LayoutRefusal = { refused: "headline" } | { refused: "title"; title: string };

export type RowInput = { title: string; withText: string | null; marker: string | null };

/**
 * TK6: the headline at x 120–960 with its cap top at 353; the list a 480 px
 * column (x 120–600 on the left, 480–960 on the right), starting 70 px under
 * the headline's last baseline, its last baseline on or above 1238, the rows
 * sharing the height equally. Text is in the kit's case before measuring.
 */
export function layoutReel(input: { headline: string; artist: string; rows: readonly RowInput[]; list: ListSide; measure: Measure; markerKind: "number" | "rung" | "none" }): ReelLayout | LayoutRefusal {
  const { measure } = input;
  const band = TOP_TRACKS.band;
  const head = fitSteps(input.headline, TK_TYPE.headline.capPx, TK_TYPE.headline.steps, TK_TYPE.headline.maxWidth, TK_TYPE.headline.maxLines, measure, input.artist);
  if (!head) return { refused: "headline" };
  const pitch = (cap: number) => cap * TK_TYPE.pitchPerCap;
  const headline: PlacedLine[] = head.lines.map((text, i) => ({ text, capPx: head.capPx, capTop: band.top + i * pitch(head.capPx), left: band.left, width: measure(text, head.capPx), role: "headline" }));
  const headBaseline = headline[headline.length - 1]!.capTop + head.capPx;
  const n = input.rows.length;
  const few = n <= 3;
  const columnLeft = input.list === "left" ? band.left : band.right - TK_TYPE.column.width;
  const column = { left: columnLeft, right: columnLeft + TK_TYPE.column.width };
  // The type sits inside the bar's side of the column.
  const inset = TK_TYPE.bar.width + TK_TYPE.bar.gap;
  const typeLeft = input.list === "left" ? column.left + inset : column.left;
  const typeRight = input.list === "left" ? column.right : column.right - inset;
  const markerCap = input.markerKind === "number" ? (few ? TK_TYPE.number.capPx3 : TK_TYPE.number.capPx4to5) : input.markerKind === "rung" ? (few ? TK_TYPE.rung.capPx3 : TK_TYPE.rung.capPx4to5) : 0;
  const markerW = markerCap ? Math.max(...input.rows.map((r) => (r.marker ? measure(r.marker, markerCap) : 0))) : 0;
  const titleLeft = typeLeft + (markerCap ? markerW + TK_TYPE.markerGapPerCap * markerCap : 0);
  const titleWidth = typeRight - titleLeft;
  const baseTitle = few ? TK_TYPE.title.capPx3 : TK_TYPE.title.capPx4to5;
  const listTop = headBaseline + TK_TYPE.column.gapUnderHeadline;
  const rowH = (band.bottom - listTop) / Math.max(1, n);
  const rows: RowLayout[] = [];
  for (let i = 0; i < n; i += 1) {
    const r = input.rows[i]!;
    const fit = fitSteps(r.title, baseTitle, TK_TYPE.title.steps, titleWidth, TK_TYPE.title.maxLines, measure);
    if (!fit) return { refused: "title", title: r.title };
    const withCap = Math.round(fit.capPx * TK_TYPE.withRatio * 100) / 100;
    const withLines = r.withText ? wrap(r.withText, withCap, titleWidth, 1, measure) : [];
    if (r.withText && !withLines) return { refused: "title", title: r.title };
    const top = listTop + i * rowH;
    const titleLines: PlacedLine[] = fit.lines.map((text, j) => ({ text, capPx: fit.capPx, capTop: top + j * pitch(fit.capPx), left: titleLeft, width: measure(text, fit.capPx), role: "title" }));
    const afterTitle = titleLines[titleLines.length - 1]!.capTop + pitch(fit.capPx);
    const withPlaced: PlacedLine[] = (withLines ?? []).map((text) => ({ text, capPx: withCap, capTop: afterTitle, left: titleLeft, width: measure(text, withCap), role: "with" }));
    // The row's lines must end inside its share (and the last on or above 1238).
    const lastBase = withPlaced.length ? withPlaced[0]!.capTop + withCap : titleLines[titleLines.length - 1]!.capTop + fit.capPx;
    if (lastBase > top + rowH + 1e-6 || lastBase > band.bottom + 1e-6) return { refused: "title", title: r.title };
    const marker: PlacedLine | null = r.marker && markerCap ? { text: r.marker, capPx: markerCap, capTop: top, left: typeLeft, width: measure(r.marker, markerCap), role: "marker" } : null;
    rows.push({ index: i, marker, title: titleLines, withLine: withPlaced, top, bottom: top + rowH });
  }
  return { headline, rows, column, bar: { left: input.list === "left" ? band.left : band.right - TK_TYPE.bar.width }, titleLeft };
}

export function isLayout(l: ReelLayout | LayoutRefusal): l is ReelLayout {
  return !("refused" in l);
}

// ── Words: TK2, TK5, TK7, TK8, TK9 refusals and TK10's Lab strings ─────────

export const TOP_TRACKS_TAB = "Top tracks";
export const MAKE_THE_REEL = "Make the reel";

export const FRAMING_LABEL = "Framing";
export const TRACKS_LABEL = "Tracks";
export const BACKGROUND_LABEL = "Background";

export const BACKGROUND_CHIPS: Record<BackgroundKind, string> = { press: "Press shot", dj: "DJ moment", montage: "Clip montage", broll: "Event b-roll" };

/** TK10: behind Edit, one row each, defaults first. */
export const EDIT_ROWS = [
  { key: "tracks", label: "Tracks", options: [{ value: 5, text: "5" }, { value: 4, text: "4" }, { value: 3, text: "3" }] },
  { key: "rowsAppear", label: "Rows appear", options: [{ value: "start", text: "At track start" }, { value: "drop", text: "On the drop" }] },
  { key: "ladder", label: "Ladder", levelOnly: true, options: [{ value: "joke", text: "Joke" }, { value: "plain", text: "Plain" }] },
  { key: "end", label: "End", options: [{ value: "date", text: "With the date" }, { value: "nocta", text: "No CTA" }] },
  { key: "endCard", label: "End card", dateOnly: true, options: [{ value: "column", text: "In the list's column" }, { value: "centred", text: "Centred" }] },
  { key: "list", label: "List", options: [{ value: "left", text: "On the left" }, { value: "right", text: "On the right" }] },
] as const;

export function pickedCount(n: number): string {
  return `${n} of 5 picked · at least 3`;
}

export const ORDER_SPOTIFY = "Order follows Spotify's top tracks";
export const ORDER_DRAG = "Drag to reorder";
export const NOT_RANKABLE = "Not on Spotify's top tracks, so it can't be ranked";

export function orderLine(framing: Framing): string {
  return isSpotifyOrdered(framing) ? ORDER_SPOTIFY : ORDER_DRAG;
}

/** "{n} tracks · {total} s". */
export function totalLine(n: number, totalS: number): string {
  return `${n} tracks · ${(Math.round(totalS * 10) / 10).toFixed(1)} s`;
}

export function headlineTooLong(artist: string): string {
  return `The headline doesn't fit two lines for ${artist} — pick another framing.`;
}

export function titleTooLong(title: string): string {
  return `'${title}' is too long for the list — pick another track.`;
}

export function headOnList(source: "photo" | "clip"): string {
  return `The artist's head is where the list goes — choose another ${source}.`;
}

export function photoCantClear(side: "left" | "right"): string {
  return `The photo can't put the artist clear of the list: it ends at the ${side}.`;
}

export const MONTAGE_WRONG_SIDE = "In this clip the artist is on the list's side — choose another clip.";
export const TOO_BUSY = "Too busy behind the list — choose another background.";
export const CLAIM_DOESNT_FIT = "The claim doesn't fit beside the artist — make the no-CTA version.";
export const CENTRED_HEAD = "The artist's head is where the centred end goes — use the column end.";

export function mutedRow(n: number): string {
  return `Meta muted the audio (rights) · ${n} files flagged`;
}

/** TK2: a Drive-only track (not in Spotify's top tracks) can't go into a Ranked or Level reel. */
export function canTick(framing: Framing, track: { spotifyRank: number | null }): { ok: true } | { ok: false; line: string } {
  if (isSpotifyOrdered(framing) && track.spotifyRank == null) return { ok: false, line: NOT_RANKABLE };
  return { ok: true };
}

/** TK10: the summary under the inputs, as TK-G draws it. */
export function summaryLine(o: ReelOptions, totalS: number): string {
  const parts = [totalLine(o.tracks, totalS), o.rowsAppear === "start" ? "rows at track start" : "rows on the drop"];
  parts.push(o.end === "date" ? `ends with the date, ${o.endCard === "column" ? "in the list's column" : "centred"}` : "no CTA");
  parts.push(o.list === "left" ? "list on the left" : "list on the right");
  if (o.framing === "level") parts.splice(2, 0, o.ladder === "joke" ? "joke ladder" : "plain ladder");
  return parts.join(" · ");
}

/** The 9:16 preview's corner label, "9:16 · 1:09". */
export function previewLabel(totalS: number): string {
  const s = Math.round(totalS);
  return `9:16 · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
