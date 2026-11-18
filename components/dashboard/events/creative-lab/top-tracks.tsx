"use client";

/**
 * The Lab's Top tracks tab (docs/design-record/2026-11-18-creative-lab-top-tracks.html,
 * TK10, frame TK-G): the act chips, the 9:16 preview leading the card, the
 * three visible inputs (Framing, Tracks in a sheet, Background), the summary
 * with Edit (TK10's six rows, defaults first), "Make the reel", and the
 * render rows. At 393 the preview sits full width above the inputs; the
 * track picker and Edit open as bottom sheets; the chips wrap.
 *
 * Every string is reel.ts's, audio-rules.ts's or view.ts's (the record's).
 * Also here: TopTracksStill, an HTML replica of the TopTracks composition at
 * one moment, drawn from the same frame.ts / reel.ts rules in a stand-in
 * condensed face (as the record's frames are), for the preview and the TK
 * frames. Renders use the kit's own faces (O24, O49–O51) through Remotion.
 */

import localFont from "next/font/local";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { mmss } from "@/lib/creative-tests/top-tracks/audio-rules";
import { layoutEndCard, type Rect } from "@/lib/creative-tests/top-tracks/layout";
import {
  BACKGROUND_LABEL,
  DEFAULT_OPTIONS,
  FRAMING_LABEL,
  MAKE_THE_REEL,
  TRACKS_LABEL,
  TOP_TRACKS,
  TOP_TRACKS_TAB,
  endState,
  headline,
  headlineTooLong,
  isLayout,
  kitCase,
  layoutReel,
  rowForPlay,
  rowMarkers,
  rowState,
  titleTooLong,
  type Framing,
  type ReelOptions,
  type ReelTimeline,
} from "@/lib/creative-tests/top-tracks/reel";
import { buildTopTracksView, type TrackInput, type TrackRowView } from "@/lib/creative-tests/top-tracks/view";

const standIn = localFont({
  src: "../../../../src/remotion/fonts/TikTokSans[opsz,slnt,wdth,wght].ttf",
  display: "block",
  adjustFontFallback: false,
});

/** The stand-in face's CSS family, for a frame to wait on. */
export const STAND_IN_FAMILY = standIn.style.fontFamily;

/** The stand-in condensed face for the replica: TikTok Sans at 75 % width, bold. */
const STAND_IN_VARIATION = '"opsz" 36, "slnt" 0, "wdth" 75, "wght" 700';
const CAP_PER_EM = 0.705;

/** What the tab needs, from the route (or a fixture in frames). */
export type TopTracksData = {
  eventCode: string | null;
  acts: { id: string; name: string }[];
  actId: string;
  artist: string;
  tracks: TrackInput[];
  /** Spotify's artist list per track id, for TK5's "with" line in the preview. */
  trackArtists: Record<string, string[]>;
  renders: { id: string; fileName: string; status: "queued" | "rendering" | "ready" | "failed"; lengthS: number | null }[];
  /** The latest render's mp4, played with sound as CT5's preview is. */
  previewUrl: string | null;
  /** For the replica's end card. */
  end: { lockup: string; date: string; claim: string | null };
  kitCase: "upper" | "as-is";
};

const FILE_NAME_STYLE = { fontFeatureSettings: '"calt" 0' } as const;

export function LabTopTracks({
  eventId,
  data: initialData = null,
  initialPicks,
  initialOptions = DEFAULT_OPTIONS,
  previewAt = null,
}: {
  eventId: string;
  /** Frames pass the data and never fetch. */
  data?: TopTracksData | null;
  initialPicks?: string[];
  initialOptions?: ReelOptions;
  /** Frames: the replica's moment in the preview, seconds. */
  previewAt?: number | null;
}) {
  const frame = initialData != null;
  const [data, setData] = useState<TopTracksData | null>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<ReelOptions>(initialOptions);
  const [picks, setPicks] = useState<string[]>(initialPicks ?? []);
  const [sheet, setSheet] = useState<"tracks" | "edit" | null>(null);

  const load = useCallback(
    async (artist: string | null) => {
      if (frame) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/creative-lab/events/${eventId}/top-tracks${artist ? `?artist=${encodeURIComponent(artist)}` : ""}`);
        const json = (await res.json().catch(() => ({}))) as { data?: TopTracksData; error?: string };
        if (!res.ok || !json.data) setError(json.error ?? null);
        else {
          setData(json.data);
          setError(null);
        }
      } finally {
        setBusy(false);
      }
    },
    [eventId, frame],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const view = useMemo(
    () => (data ? buildTopTracksView({ eventCode: data.eventCode, acts: data.acts, actId: data.actId, artist: data.artist, tracks: data.tracks, picked: picks, options, renders: data.renders }) : null),
    [data, picks, options],
  );

  async function make() {
    if (frame || !view?.canMake) return;
    setBusy(true);
    const res = await fetch(`/api/creative-lab/events/${eventId}/top-tracks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "make", artistId: data?.actId, picked: picks, options }) });
    setBusy(false);
    if (!res.ok) setError(String(((await res.json().catch(() => ({}))) as { error?: string }).error ?? ""));
    await load(data?.actId ?? null);
  }

  function toggle(row: TrackRowView) {
    if (!row.tickable) return;
    setPicks((p) => (p.includes(row.id) ? p.filter((id) => id !== row.id) : p.length >= options.tracks ? p : [...p, row.id]));
  }

  if (!view || !data) {
    return (
      <section className="space-y-2">
        <h3 className="font-medium">{TOP_TRACKS_TAB}</h3>
        {error ? <p className="text-destructive">{error}</p> : null}
      </section>
    );
  }

  const listRows = view.pickedShort;
  const playing = previewAt ?? 0;
  const stillTracks = picks
    .map((id) => data.tracks.find((t) => t.id === id))
    .filter((t): t is TrackInput => Boolean(t && t.window))
    .sort((a, b) => (options.framing === "ranked" || options.framing === "level" ? (a.spotifyRank ?? 99) - (b.spotifyRank ?? 99) : 0));

  return (
    <section className="space-y-4" aria-busy={busy}>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{view.heading}</p>
      {error ? <p className="text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2" role="tablist">
        {view.acts.map((act) => (
          <button
            key={act.id}
            type="button"
            role="tab"
            aria-selected={act.open}
            onClick={() => void load(act.id)}
            className={`rounded-full border px-3 py-1 text-xs ${act.open ? "border-foreground bg-foreground text-background" : "border-border-strong bg-background"}`}
          >
            {act.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[13.5rem_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <div className="relative mx-auto aspect-[9/16] w-full overflow-hidden rounded bg-black sm:w-[13.5rem]">
            {data.previewUrl ? (
              <video src={data.previewUrl} controls playsInline className="h-full w-full object-cover" />
            ) : stillTracks.length ? (
              <ScaledStill>
                {(scale) => (
                  <TopTracksStill
                    scale={scale}
                    framing={options.framing}
                    artist={data.artist}
                    kase={data.kitCase}
                    tracks={stillTracks.map((t) => ({ title: t.title, artists: data.trackArtists[t.id] ?? [], window: t.window! }))}
                    options={options}
                    tS={playing}
                    end={data.end}
                  />
                )}
              </ScaledStill>
            ) : null}
          </div>
          <p className="text-center font-mono text-[10px] text-muted-foreground">{view.previewLabel}</p>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{FRAMING_LABEL}</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Framing">
              {view.framing.map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  role="radio"
                  aria-checked={chip.selected}
                  onClick={() => setOptions((o) => ({ ...o, framing: chip.value as Framing }))}
                  className={`rounded-full border px-3 py-1 text-left text-xs ${chip.selected ? "border-foreground bg-foreground text-background" : "border-border-strong bg-background"}`}
                >
                  <span className="max-sm:hidden">{chip.text}</span>
                  <span className="sm:hidden">{chip.narrow}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{`${TRACKS_LABEL} · ${view.tracksHeading}`}</p>
            <p className="text-sm">
              <span className="max-sm:hidden">
                {listRows.map((r, i) => (
                  <span key={`${r.title}-${i}`}>
                    {i ? " · " : ""}
                    {r.n ? <span className="font-mono text-xs text-muted-foreground">{r.n} </span> : null}
                    {r.title}
                    {r.short ? <span className="text-muted-foreground">{` · ${r.short}`}</span> : null}
                  </span>
                ))}
              </span>
              <span className="sm:hidden">{listRows.map((r) => r.title).join(", ")}</span>
            </p>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">{view.orderLine}</span>
              <button type="button" onClick={() => setSheet("tracks")} className="underline">
                Change
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{BACKGROUND_LABEL}</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Background">
              {view.background.map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  role="radio"
                  aria-checked={chip.selected}
                  onClick={() => setOptions((o) => ({ ...o, background: chip.value }))}
                  className={`rounded-full border px-3 py-1 text-xs ${chip.selected ? "border-foreground bg-foreground text-background" : "border-border-strong bg-background"}`}
                >
                  {chip.text}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-3 text-xs">
            <span className="text-muted-foreground">
              <span className="max-sm:hidden">{view.summary}</span>
              <span className="sm:hidden">{view.summaryShort}</span>
            </span>
            <button type="button" onClick={() => setSheet("edit")} className="underline">
              Edit
            </button>
          </div>

          <button
            type="button"
            disabled={busy || !view.canMake}
            onClick={make}
            className="rounded bg-foreground px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-background disabled:opacity-40"
          >
            {MAKE_THE_REEL}
          </button>
        </div>
      </div>

      {view.renders.length ? (
        <div className="space-y-1">
          {view.renders.map((r) => (
            <div key={r.id} className="border-t border-border py-1.5">
              <p style={FILE_NAME_STYLE} className={`truncate text-sm ${r.status === "failed" ? "text-destructive" : ""}`}>
                {r.line}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {sheet === "tracks" ? (
        <Sheet label={TRACKS_LABEL} onClose={() => setSheet(null)}>
          <p className="text-sm font-medium">{`${TRACKS_LABEL} · ${view.tracksHeading}`}</p>
          <p className="text-xs text-muted-foreground">{view.orderLine}</p>
          <div>
            {view.rows.map((row) => (
              <TrackPickRow key={row.id} row={row} onToggle={() => toggle(row)} />
            ))}
          </div>
        </Sheet>
      ) : null}

      {sheet === "edit" ? (
        <Sheet label="Edit" onClose={() => setSheet(null)}>
          <div className="space-y-3">
            {view.edit.map((row) => (
              <div key={row.key} className="space-y-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{row.label}</p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={row.label}>
                  {row.options.map((o) => (
                    <button
                      key={String(o.value)}
                      type="button"
                      role="radio"
                      aria-checked={o.selected}
                      onClick={() => setOptions((prev) => ({ ...prev, [row.key]: o.value }) as ReelOptions)}
                      className={`rounded-full border px-3 py-1 text-xs ${o.selected ? "border-foreground bg-foreground text-background" : "border-border-strong bg-background"}`}
                    >
                      {o.text}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}

/** A sheet: centred at 1280, a bottom sheet at 393 (TK10). */
function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-label={label} className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[85vh] w-full overflow-auto rounded-t-lg border border-border bg-card p-4 sm:max-w-3xl sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}

function TrackPickRow({ row, onToggle }: { row: TrackRowView; onToggle: () => void }) {
  return (
    <div className="grid grid-cols-[1.375rem_1.625rem_minmax(0,1fr)] gap-x-2 gap-y-1 border-t border-border py-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={row.picked}
        aria-label={row.title}
        disabled={!row.tickable}
        onClick={onToggle}
        className={`mt-0.5 h-4 w-4 rounded-[3px] border-[1.5px] ${row.picked ? "border-foreground bg-foreground" : "border-foreground"} disabled:border-muted-foreground disabled:opacity-45`}
      />
      <span className="font-mono text-xs text-muted-foreground">{row.n ?? "·"}</span>
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm">{row.title}</p>
        {row.lockLine && !row.tickable ? <p className="text-[11.5px] text-destructive">{row.lockLine}</p> : null}
        <TrackWave wave={row.wave} />
        {row.lines.map((line) => (
          <p key={line} className="text-[11.5px] text-muted-foreground">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

/** A label at a fraction of the track: start-aligned at the left edge, end-aligned at the right, centred between. */
function labelShift(fraction: number): string {
  if (fraction < 0.04) return "0%";
  if (fraction > 0.96) return "-100%";
  return "-50%";
}

/**
 * TK3 / TK10: a track's waveform with every drop found (the one used marked,
 * brick), the hook marker (ochre) and the window. The last third is shaded.
 */
export function TrackWave({ wave, phrase = null }: { wave: TrackRowView["wave"]; phrase?: number[] | null }) {
  const d = Math.max(1, wave.durationS);
  const x = (s: number) => (s / d) * 1000;
  return (
    <div className="space-y-0.5">
      <div className="relative h-4">
        {wave.hookS != null ? (
          <span className="absolute bottom-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.12em] text-warning" style={{ left: `${(wave.hookS / d) * 100}%`, transform: `translateX(${labelShift(wave.hookS / d)})` }}>
            {`HOOK · ${mmss(wave.hookS)}`}
          </span>
        ) : null}
      </div>
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="h-16 w-full">
        <rect x={x(wave.lastThirdFromS)} y={0} width={1000 - x(wave.lastThirdFromS)} height={100} className="fill-foreground/5" />
        {wave.peaks.map((peak, i) => {
          const w = 1000 / Math.max(1, wave.peaks.length);
          const h = Math.max(1, peak * 80);
          return <rect key={i} x={i * w} y={50 - h / 2} width={Math.max(0.6, w * 0.7)} height={h} className="fill-foreground/35" />;
        })}
        {wave.window ? <rect x={x(wave.window.startS)} y={4} width={x(wave.window.endS - wave.window.startS)} height={92} className="fill-foreground/10 stroke-foreground" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
        {(phrase ?? []).map((p) => (
          <rect key={`p${p}`} x={x(p)} y={88} width={x(4 * (60 / 124) * 2)} height={8} className="fill-warning/60" />
        ))}
        {wave.drops.map((s) => (
          <line key={s} x1={x(s)} x2={x(s)} y1={0} y2={100} className="stroke-destructive" strokeWidth={s === wave.usedS ? 3 : 1} strokeDasharray={s === wave.usedS ? undefined : "3 3"} vectorEffect="non-scaling-stroke" />
        ))}
        {wave.hookS != null ? <line x1={x(wave.hookS)} x2={x(wave.hookS)} y1={0} y2={100} className="stroke-warning" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <div className="relative h-3.5 font-mono text-[10px] text-muted-foreground">
        {[0, ...wave.drops, wave.durationS].map((s, i, all) => (
          <span key={`${s}-${i}`} className="absolute top-0 whitespace-nowrap" style={{ left: `${(s / d) * 100}%`, transform: `translateX(${i === all.length - 1 ? "-100%" : labelShift(s / d)})` }}>
            {mmss(s)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Fits a 1080 × 1920 child to the box's width. */
function ScaledStill({ children }: { children: (scale: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.2);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setScale(el.getBoundingClientRect().width / TOP_TRACKS.width);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="absolute inset-0">
      {children(scale)}
    </div>
  );
}

// ── The replica ─────────────────────────────────────────────────────────────

type Metrics = { measure: (text: string, capPx: number) => number; baseline: (capPx: number) => number };

/** Measures the stand-in face in the DOM once it has loaded: widths, and where the baseline sits in a line box as tall as the font size. */
function useStandInMetrics(): Metrics | null {
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    let live = true;
    const family = standIn.style.fontFamily;
    void document.fonts.load(`700 100px ${family}`).then(() => {
      if (!live) return;
      const host = document.createElement("div");
      host.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:pre";
      document.body.appendChild(host);
      const span = document.createElement("span");
      span.style.fontFamily = family;
      span.style.fontVariationSettings = STAND_IN_VARIATION;
      span.style.lineHeight = "1";
      host.appendChild(span);
      const probe = document.createElement("div");
      probe.style.cssText = `font-family:${family};font-variation-settings:${STAND_IN_VARIATION};font-size:100px;line-height:100px`;
      probe.innerHTML = 'H<span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>';
      host.appendChild(probe);
      const baseAt100 = (probe.lastElementChild as HTMLElement).offsetTop - probe.offsetTop;
      const cache = new Map<string, number>();
      const measure = (text: string, capPx: number) => {
        const key = `${text}|${capPx}`;
        const hit = cache.get(key);
        if (hit != null) return hit;
        span.style.fontSize = `${capPx / CAP_PER_EM}px`;
        span.textContent = text;
        const w = span.getBoundingClientRect().width;
        cache.set(key, w);
        return w;
      };
      setM({ measure, baseline: (capPx) => (baseAt100 / 100) * (capPx / CAP_PER_EM) });
    });
    return () => {
      live = false;
    };
  }, []);
  return m;
}

export type StillTrack = { title: string; artists: string[]; window: { startS: number; endS: number; lengthS: number; dropS: number } };

const KIT_ACCENT = "#FE3232";

/**
 * The TopTracks composition at one moment, in HTML: the schematic press shot
 * (the head at 0.74 W, or 0.26 W for a list on the right), O25's top band and
 * TK8's side band, the headline, the list's rows by frame.ts's rowState and
 * endState, and TK9's end. `tracks` is the list top-down. `guides` overlays
 * TK-A's crops. `timelineOverride` lets a frame use the record's timing.
 */
export function TopTracksStill({
  scale,
  framing,
  artist,
  kase,
  tracks,
  options,
  tS,
  end,
  guides = false,
  timeline: timelineOverride = null,
  onReady,
}: {
  scale: number;
  framing: Framing;
  artist: string;
  kase: "upper" | "as-is";
  tracks: StillTrack[];
  options: ReelOptions;
  tS: number;
  end: { lockup: string; date: string; claim: string | null };
  guides?: boolean;
  timeline?: ReelTimeline | null;
  onReady?: () => void;
}) {
  const metrics = useStandInMetrics();
  const W = TOP_TRACKS.width;
  const H = TOP_TRACKS.height;
  const n = tracks.length as 3 | 4 | 5;
  const play = framing === "ranked" ? [...tracks].reverse() : tracks;
  const timeline = useMemo<ReelTimeline>(() => {
    if (timelineOverride) return timelineOverride;
    let t = 0;
    const startsS: number[] = [];
    const dropsS: number[] = [];
    for (const tr of play) {
      startsS.push(t);
      dropsS.push(t + (tr.window.dropS - tr.window.startS));
      t += tr.window.lengthS - 0.75;
    }
    const totalS = t + 0.75;
    return { startsS, dropsS, totalS, endFromS: totalS - (options.end === "date" ? 3 : 2.5) };
  }, [timelineOverride, play, options.end]);
  const markers = rowMarkers(framing, n, options.ladder);
  const markerKind = framing === "ranked" ? "number" : framing === "level" ? "rung" : "none";
  const layout = useMemo(() => {
    if (!metrics) return null;
    const rows = tracks.map((t, i) => {
      const others = t.artists.filter((a) => a.toLowerCase() !== artist.toLowerCase());
      const withText = others.length && !/\b(feat\.|with)\s/i.test(t.title) ? `with ${others.length === 1 ? others[0] : `${others.slice(0, -1).join(", ")} & ${others.at(-1)}`}` : null;
      return { title: kitCase(t.title, kase), withText: withText ? kitCase(withText, kase) : null, marker: markers[i] ?? null };
    });
    return layoutReel({ headline: kitCase(headline(framing, artist, n), kase), artist: kitCase(artist, kase), rows, list: options.list, measure: metrics.measure, markerKind });
  }, [metrics, tracks, markers, framing, artist, n, kase, options.list, markerKind]);
  const card = useMemo(() => {
    if (!metrics || !layout || !isLayout(layout) || options.end !== "date") return null;
    const res = layoutEndCard({ column: layout.column, lockupAspect: 3, name: kitCase(artist, kase), date: end.date, claim: end.claim, measure: metrics.measure });
    return "refused" in res ? null : res;
  }, [metrics, layout, options.end, artist, kase, end]);
  useEffect(() => {
    if (metrics && layout) onReady?.();
  }, [metrics, layout, onReady]);

  const ends = endState(tS, timeline, options.end);
  const playRows = rowForPlay(framing, n);
  const listLeft = options.list === "left";
  const headX = (listLeft ? 0.74 : 0.26) * W;
  const head: Rect = { left: headX - 130, top: 0.4 * H - 165, width: 260, height: 330 };
  const family = standIn.style.fontFamily;
  const text = (key: string, line: { text: string; capPx: number; capTop: number; left: number }, opacity: number, color = "#FFFFFF", dx = 0) =>
    metrics && opacity > 0 ? (
      <span
        key={key}
        style={{
          position: "absolute",
          left: line.left + dx,
          top: line.capTop + line.capPx - metrics.baseline(line.capPx),
          fontFamily: family,
          fontVariationSettings: STAND_IN_VARIATION,
          fontSize: line.capPx / CAP_PER_EM,
          lineHeight: 1,
          whiteSpace: "pre",
          color,
          opacity,
        }}
      >
        {line.text}
      </span>
    ) : null;

  return (
    <div style={{ width: W * scale, height: H * scale, overflow: "hidden", position: "relative" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${scale})`, transformOrigin: "0 0", background: "#2a2622", overflow: "hidden" }}>
        {/* The schematic press shot: a lit backdrop, shoulders, the head (TK7). */}
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 70% 45% at ${listLeft ? 72 : 28}% 38%, #6b5a4c 0%, #3b332d 55%, #1d1a17 100%)` }} />
        <div style={{ position: "absolute", left: headX - 330, top: 0.4 * H + 230, width: 660, height: 900, borderRadius: "330px 330px 40px 40px", background: "#15120f" }} />
        <div style={{ position: "absolute", left: head.left, top: head.top, width: head.width, height: head.height, borderRadius: "50%", background: "#8a7262" }} />
        {/* O25's top band and TK8's side band (55 %, to 0 at 0.60 W). */}
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0) ${0.44 * 100}%)` }} />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(to ${listLeft ? "right" : "left"}, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 60%)` }} />
        {layout && isLayout(layout) ? (
          <>
            {layout.headline.map((l, i) => text(`h${i}`, l, ends.listOpacity))}
            {layout.rows.map((row, r) => {
              const k = playRows.indexOf(r);
              const s = rowState(tS, k, timeline, options.rowsAppear);
              const hold = ends.hold;
              const isPlaying = s.playing && !hold && ends.endCardOpacity === 0;
              const markerOpacity = (hold ? 1 : s.markerOpacity) * ends.listOpacity;
              const titleOpacity = s.titleOpacity * (hold ? 1 : s.titleLevel) * ends.listOpacity;
              const dx = (listLeft ? -1 : 1) * s.slidePx;
              const last = row.withLine.at(-1) ?? row.title.at(-1)!;
              return (
                <div key={`r${r}`}>
                  {row.marker ? text(`m${r}`, row.marker, isPlaying ? ends.listOpacity : markerOpacity, isPlaying ? KIT_ACCENT : "#FFFFFF") : null}
                  {!row.marker ? <div style={{ position: "absolute", left: layout.column.left, top: row.title[0]!.capTop + row.title[0]!.capPx, width: layout.column.right - layout.column.left, height: 2, background: "#FFFFFF", opacity: 0.4 * (1 - s.titleOpacity) * ends.listOpacity }} /> : null}
                  {row.title.map((l, i) => text(`t${r}-${i}`, l, titleOpacity, "#FFFFFF", dx))}
                  {row.withLine.map((l, i) => text(`w${r}-${i}`, l, titleOpacity, "#FFFFFF", dx))}
                  {isPlaying ? <div style={{ position: "absolute", left: layout.bar.left, top: row.top, width: 6, height: last.capTop + last.capPx - row.top, background: KIT_ACCENT, opacity: ends.listOpacity }} /> : null}
                </div>
              );
            })}
            {card && ends.endCardOpacity > 0 ? (
              <>
                <div style={{ position: "absolute", left: card.lockup.left, top: card.lockup.top, width: card.lockup.width, height: card.lockup.height, border: "4px solid #FFFFFF", opacity: ends.endCardOpacity, display: "grid", placeItems: "center", color: "#FFFFFF", fontFamily: family, fontVariationSettings: STAND_IN_VARIATION, fontSize: card.lockup.height * 0.45 }}>
                  {end.lockup}
                </div>
                {card.name.map((l, i) => text(`n${i}`, l, ends.endCardOpacity))}
                {card.date ? text("d", card.date, ends.endCardOpacity) : null}
                {card.claim.map((l, i) => text(`c${i}`, l, ends.endCardOpacity))}
              </>
            ) : null}
          </>
        ) : null}
        {layout && !isLayout(layout) ? (
          <p data-refusal style={{ position: "absolute", left: 120, top: 353, width: 840, color: "#FFFFFF", fontSize: 40, lineHeight: 1.2 }}>
            {layout.refused === "headline" ? headlineTooLong(artist) : titleTooLong(layout.title)}
          </p>
        ) : null}
        {guides ? <Guides head={head} column={layout && isLayout(layout) ? layout.column : null} /> : null}
      </div>
    </div>
  );
}

/** TK-A's overlays: the Reels controls, O96's band, Feed's 4:5, the last baseline, the grown head box, the list column. */
function Guides({ head, column }: { head: Rect; column: { left: number; right: number } | null }) {
  const g = 0.02 * 1920;
  const label = (t: string, left: number, top: number, color: string) => (
    <span style={{ position: "absolute", left, top, color, fontFamily: "ui-monospace, monospace", fontSize: 22, letterSpacing: 1 }}>{t}</span>
  );
  return (
    <>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 269, background: "rgba(255,255,255,0.18)" }} />
      <div style={{ position: "absolute", left: 0, top: 1248, width: 1080, height: 672, background: "rgba(255,255,255,0.18)" }} />
      {label("REELS UI · y 0–269", 24, 230, "#FFFFFF")}
      <div style={{ position: "absolute", left: 120, top: 285, width: 840, height: 963, border: "3px solid #3b82f6" }} />
      {label("BAND x 120–960 · y 285–1248", 130, 292, "#3b82f6")}
      <div style={{ position: "absolute", left: 0, top: 1238, width: 1080, height: 0, borderTop: "3px dashed #3b82f6" }} />
      {label("LAST BASELINE 1238", 130, 1200, "#3b82f6")}
      <div style={{ position: "absolute", left: 0, top: 285, width: 1080, height: 0, borderTop: "3px solid #eab308" }} />
      <div style={{ position: "absolute", left: 0, top: 1635, width: 1080, height: 0, borderTop: "3px solid #eab308" }} />
      {label("FEED 4:5 ENDS · y 1635", 24, 1645, "#eab308")}
      <div style={{ position: "absolute", left: head.left - g, top: head.top - g, width: head.width + 2 * g, height: head.height + 2 * g, border: "3px solid #ef4444" }} />
      {label("HEAD BOX +0.02 H", head.left - g, head.top - g - 30, "#ef4444")}
      {column ? (
        <>
          <div style={{ position: "absolute", left: column.left, top: 353, width: column.right - column.left, height: 885, border: "2px dashed rgba(255,255,255,0.7)" }} />
          {label(`LIST · x ${column.left}–${column.right}`, column.left + 8, 1250, "#FFFFFF")}
        </>
      ) : null}
    </>
  );
}
