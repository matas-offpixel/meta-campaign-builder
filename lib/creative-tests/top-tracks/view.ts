/**
 * Top tracks TK10 (docs/design-record/2026-11-18-creative-lab-top-tracks.html,
 * frame TK-G): the Lab tab's view model. Pure: it takes the act, the tracks
 * (each with its TK3 plan already worked out) and the options, and returns
 * every string the tab shows, in the record's words (reel.ts, audio-rules.ts).
 * The component (components/dashboard/events/creative-lab/top-tracks.tsx)
 * renders this and nothing else.
 */

import { dropRowText, hookMarker, hookTooFar, NO_PHRASE, NO_STEADY_BEAT, spanLine, type DropChoice, type SnippetWindow } from "./audio-rules.ts";
import { BEAT_UNREAD, FINDING_DROPS } from "./studio.ts";
import {
  BACKGROUND_CHIPS,
  EDIT_ROWS,
  FRAMINGS,
  canTick,
  headline,
  isSpotifyOrdered,
  narrowChip,
  orderLine,
  pickedCount,
  playOrder,
  previewLabel,
  reelTimeline,
  summaryLine,
  totalLine,
  type BackgroundKind,
  type Framing,
  type ReelOptions,
} from "./reel.ts";

export type TrackInput = {
  id: string;
  title: string;
  /** Spotify's top-tracks place, or null for a Drive-only file (TK2). */
  spotifyRank: number | null;
  durationS: number;
  /** 0..1 peaks over the whole track (CT4's waveform). */
  waveform: number[];
  /** Every drop found (TK14: the bass returning on the Demucs bass stem), in time order. */
  drops: number[];
  /** TK14's picker lines, one per drop: "{m:ss.s} · bass returns after {n} bars". */
  dropLines?: string[];
  /** TK18: "running" reads "Finding the drops…" and can't be ticked; "failed" reads the failure line. Absent: done. */
  analysis?: "running" | "done" | "failed";
  /** TK3's plan for the track; null when it was refused. */
  window: Pick<SnippetWindow, "startS" | "endS" | "lengthS" | "dropS" | "cut" | "barsBefore" | "barsAfter"> | null;
  choice: Extract<DropChoice, { dropS: number }> | null;
  hook: { kind: "hook" | "too_far"; hookS: number } | { kind: "none" };
  /** The refusal (TK3's words with the title) when the track can't make a snippet. */
  refusal: string | null;
};

export type TrackRowView = {
  id: string;
  /** "1".. for a Spotify track, null for Drive-only. */
  n: string | null;
  title: string;
  picked: boolean;
  /** False when TK2 refuses the tick (Drive-only under Ranked or Level) or TK3 refused the track. */
  tickable: boolean;
  /** "Not on Spotify's top tracks, so it can't be ranked", or the TK3 refusal. */
  lockLine: string | null;
  /** The collapsed list's piece: "17.4 s, hook" or "13.5 s". */
  short: string | null;
  /** Under each track in the sheet: the drop row, the hook line, the span line. */
  lines: string[];
  wave: { durationS: number; peaks: number[]; drops: number[]; usedS: number | null; hookS: number | null; window: { startS: number; endS: number } | null; lastThirdFromS: number };
};

export type ChipView<T extends string | number> = { value: T; text: string; narrow?: string; selected: boolean };

export type EditRowView = { key: string; label: string; options: ChipView<string | number>[] };

export type RenderRowView = { id: string; fileName: string; status: "queued" | "rendering" | "ready" | "failed"; lengthLabel: string | null; line: string };

export type TopTracksView = {
  heading: string;
  acts: { id: string; name: string; open: boolean }[];
  previewLabel: string;
  framing: ChipView<Framing>[];
  tracksHeading: string;
  orderLine: string;
  rows: TrackRowView[];
  /** The collapsed picker: the picked rows, in the list's order. */
  pickedShort: { n: string | null; title: string; short: string }[];
  background: ChipView<BackgroundKind>[];
  summary: string;
  summaryShort: string;
  edit: EditRowView[];
  totalS: number;
  /** The reel can be made: at least 3 picked, every pick tickable. */
  canMake: boolean;
  renders: RenderRowView[];
};

const PICK_FLOOR = 3;

/** A render's length to the nearest second, "1:09" (as TK-G's render row and preview label read). */
function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function lengthText(s: number): string {
  return `${(Math.round(s * 10) / 10).toFixed(1)} s`;
}

function rowLines(t: TrackInput): string[] {
  if (t.analysis === "running") return [FINDING_DROPS];
  if (t.refusal) return t.refusal === BEAT_UNREAD ? [BEAT_UNREAD] : [t.refusal];
  const out: string[] = [];
  if (t.analysis === "failed") out.push(BEAT_UNREAD);
  if (t.choice) out.push(dropRowText(t.choice));
  if (t.hook.kind === "hook") out.push(hookMarker(t.hook.hookS));
  else if (t.hook.kind === "too_far") out.push(hookTooFar(t.hook.hookS));
  else out.push(NO_PHRASE);
  if (t.window && t.window.cut === "seconds" && t.analysis !== "failed") out.push(NO_STEADY_BEAT);
  if (t.window) out.push(spanLine(t.window));
  out.push(...(t.dropLines ?? []));
  return out;
}

export function buildTopTracksView(input: {
  eventCode: string | null;
  acts: { id: string; name: string }[];
  actId: string;
  artist: string;
  tracks: readonly TrackInput[];
  /** Picked track ids, in the list's order (Spotify's under Ranked and Level). */
  picked: readonly string[];
  options: ReelOptions;
  renders?: readonly { id: string; fileName: string; status: RenderRowView["status"]; lengthS: number | null }[];
}): TopTracksView {
  const { options, artist } = input;
  const n = options.tracks;
  const byId = new Map(input.tracks.map((t) => [t.id, t]));
  // Ranked and Level hold Spotify's order, never re-sorted (CT3).
  const listOrder = isSpotifyOrdered(options.framing)
    ? [...input.picked].sort((a, b) => (byId.get(a)?.spotifyRank ?? 1e9) - (byId.get(b)?.spotifyRank ?? 1e9))
    : [...input.picked];
  const rows: TrackRowView[] = input.tracks.map((t) => {
    const tick = canTick(options.framing, t);
    const lockLine = !tick.ok ? tick.line : t.refusal;
    return {
      id: t.id,
      n: t.spotifyRank != null ? String(t.spotifyRank) : null,
      title: t.title,
      picked: input.picked.includes(t.id),
      tickable: tick.ok && !t.refusal && t.analysis !== "running",
      lockLine,
      short: t.window ? `${lengthText(t.window.lengthS)}${t.hook.kind === "hook" ? ", hook" : ""}` : null,
      lines: rowLines(t),
      wave: {
        durationS: t.durationS,
        peaks: t.waveform,
        drops: t.drops,
        usedS: t.choice?.dropS ?? null,
        hookS: t.hook.kind === "hook" ? t.hook.hookS : null,
        window: t.window ? { startS: t.window.startS, endS: t.window.endS } : null,
        lastThirdFromS: Math.round((t.durationS * 2) / 3 * 1000) / 1000,
      },
    };
  });
  const pickedTracks = listOrder.map((id) => byId.get(id)).filter((t): t is TrackInput => Boolean(t));
  const played = playOrder(options.framing, pickedTracks);
  const timeline = reelTimeline(
    played.filter((t) => t.window).map((t) => ({ lengthS: t.window!.lengthS, dropInS: t.window!.dropS - t.window!.startS })),
    options.end,
  );
  const show = options.framing;
  const edit: EditRowView[] = EDIT_ROWS.filter((r) => !("levelOnly" in r && r.levelOnly && show !== "level") && !("dateOnly" in r && r.dateOnly && options.end !== "date")).map((r) => ({
    key: r.key,
    label: r.label,
    options: r.options.map((o) => ({ value: o.value, text: o.text, selected: (options as unknown as Record<string, unknown>)[r.key] === o.value })),
  }));
  return {
    heading: input.eventCode ? `${input.eventCode} · Top tracks` : "Top tracks",
    acts: input.acts.map((a) => ({ ...a, open: a.id === input.actId })),
    previewLabel: previewLabel(timeline.totalS),
    framing: FRAMINGS.map((f) => ({ value: f, text: headline(f, artist, n), narrow: narrowChip(f, artist, n), selected: f === options.framing })),
    tracksHeading: pickedCount(pickedTracks.length),
    orderLine: orderLine(options.framing),
    rows,
    pickedShort: pickedTracks.map((t) => {
      const r = rows.find((row) => row.id === t.id)!;
      return { n: r.n, title: t.title, short: r.short ?? "" };
    }),
    background: (Object.keys(BACKGROUND_CHIPS) as BackgroundKind[]).map((k) => ({ value: k, text: BACKGROUND_CHIPS[k], selected: k === options.background })),
    summary: summaryLine(options, timeline.totalS),
    summaryShort: totalLine(options.tracks, timeline.totalS),
    edit,
    totalS: timeline.totalS,
    canMake: pickedTracks.length >= PICK_FLOOR && pickedTracks.length === n && pickedTracks.every((t) => rows.find((r) => r.id === t.id)!.tickable),
    renders: (input.renders ?? []).map((r) => {
      const len = r.lengthS != null ? clock(r.lengthS) : null;
      const word = r.status === "ready" ? "ready" : r.status;
      return { id: r.id, fileName: r.fileName, status: r.status, lengthLabel: len, line: [r.fileName, word, len].filter(Boolean).join(" · ") };
    }),
  };
}
