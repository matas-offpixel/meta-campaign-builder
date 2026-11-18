"use client";

import { useEffect, useMemo, useState } from "react";

import { planTrack } from "@/lib/creative-tests/top-tracks/audio-rules";
import { dropPickerLine } from "@/lib/creative-tests/top-tracks/studio";
import { DEFAULT_OPTIONS, reelTimeline, type Framing, type ReelOptions, type TimedSnippet } from "@/lib/creative-tests/top-tracks/reel";
import { buildTopTracksView, type TrackInput } from "@/lib/creative-tests/top-tracks/view";
import { BAR_S, FIXTURE_ARTIST, FIXTURE_EVENT, FIXTURE_SNIPPETS_3, FIXTURE_SNIPPETS_5, FIXTURE_TRACKS, fixtureAnalysis, fixtureFeatures } from "@/scripts/plan-frames/top-tracks-fixtures";
import { fixtureWaveform } from "@/scripts/plan-frames/snippet-fixtures";
import type { TopTracksFrameId } from "@/scripts/plan-frames/top-tracks-ids";

import { LabTopTracks, STAND_IN_FAMILY, TopTracksStill, TrackWave, type StillTrack, type TopTracksData } from "./top-tracks";

/** Each fixture track's TK3 plan: the drop chosen, the hook found, the window. */
function fixtureTrackInputs(): TrackInput[] {
  return FIXTURE_TRACKS.map((t) => {
    const plan = planTrack({ title: t.title, features: fixtureFeatures(t), analysis: fixtureAnalysis(t) });
    const last = t.drops[t.drops.length - 1]!;
    // TK14: the picker lists each drop as "{m:ss.s} · bass returns after {n} bars".
    const base = { id: t.id, title: t.title, spotifyRank: t.spotifyRank, durationS: t.durationS, waveform: fixtureWaveform(400, t.durationS, last), drops: plan.drops.map((d) => d.tS), dropLines: plan.drops.map(dropPickerLine) };
    if (!plan.ok) return { ...base, window: null, choice: null, hook: { kind: "none" as const }, refusal: plan.refusal };
    return {
      ...base,
      window: plan.window,
      choice: plan.choice,
      hook: plan.hook.kind === "none" ? { kind: "none" as const } : { kind: plan.hook.kind, hookS: plan.hook.hookS },
      refusal: null,
    };
  });
}

function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const END = { lockup: "PUZZLE", date: FIXTURE_EVENT.date, claim: FIXTURE_EVENT.claim };

function stillTracks(inputs: TrackInput[], n: number): StillTrack[] {
  return inputs.slice(0, n).map((t) => ({ title: t.title, artists: FIXTURE_TRACKS.find((f) => f.id === t.id)!.artists, window: t.window! }));
}

/** The record's stills: framing, track count, end, time and timing for each. */
const EQUAL_5: TimedSnippet[] = Array.from({ length: 5 }, () => ({ lengthS: 7 * BAR_S, dropInS: 3 * BAR_S }));
const STILLS: Record<string, { framing: Framing; n: 3 | 5; tS: number; end: ReelOptions["end"]; snippets: TimedSnippet[]; guides?: boolean }> = {
  "TK-A": { framing: "ranked", n: 5, tS: 25.9, end: "date", snippets: FIXTURE_SNIPPETS_5, guides: true },
  "TK-B1": { framing: "ranked", n: 5, tS: 0.3, end: "date", snippets: FIXTURE_SNIPPETS_5 },
  "TK-B2": { framing: "ranked", n: 5, tS: 13.1, end: "date", snippets: FIXTURE_SNIPPETS_5 },
  "TK-B3": { framing: "ranked", n: 5, tS: 51.5, end: "date", snippets: FIXTURE_SNIPPETS_5 },
  "TK-B4": { framing: "ranked", n: 5, tS: 66.0, end: "date", snippets: FIXTURE_SNIPPETS_5 },
  // The record draws TK-C with every snippet 13.5 s, so 25.9 s is the third track.
  "TK-C1": { framing: "level", n: 5, tS: 25.9, end: "date", snippets: EQUAL_5 },
  "TK-C2": { framing: "forever", n: 5, tS: 25.9, end: "date", snippets: EQUAL_5 },
  "TK-C3": { framing: "cant-live", n: 5, tS: 25.9, end: "date", snippets: EQUAL_5 },
  "TK-D": { framing: "ranked", n: 3, tS: 13.1, end: "date", snippets: FIXTURE_SNIPPETS_3 },
  "TK-E": { framing: "ranked", n: 5, tS: 66.4, end: "nocta", snippets: FIXTURE_SNIPPETS_5 },
};

/** TK-F2: the five-track fixture's timeline, Ranked, with the date end. */
function TimelineFrame() {
  const tl = reelTimeline(FIXTURE_SNIPPETS_5, "date");
  const x = (s: number) => `${(s / tl.totalS) * 100}%`;
  const labels = ["#5", "#4", "#3", "#2", "#1"];
  return (
    <div className="space-y-2 font-mono text-[11px]">
      <p className="text-muted-foreground">Tracks</p>
      <div className="relative h-16">
        {tl.startsS.map((s, i) => (
          <div key={s} className="absolute flex h-7 items-center overflow-hidden rounded-sm border border-foreground/60 bg-foreground/10 px-1" style={{ left: x(s), width: x(FIXTURE_SNIPPETS_5[i]!.lengthS), top: i % 2 ? 34 : 0 }}>
            {`${labels[i]} · ${FIXTURE_SNIPPETS_5[i]!.lengthS.toFixed(1)} s${i === 4 ? " · hook" : ""}`}
          </div>
        ))}
        <div className="absolute top-0 h-full rounded-sm bg-success/30" style={{ left: x(tl.endFromS), width: x(tl.totalS - tl.endFromS) }} />
      </div>
      <p className="text-muted-foreground">Drops</p>
      <div className="relative h-6 border-b border-border">
        {tl.dropsS.map((d) => (
          <div key={d} className="absolute top-0 h-full w-[3px] bg-destructive" style={{ left: x(d) }} />
        ))}
      </div>
      <div className="relative h-4 text-muted-foreground">
        {[0, ...tl.startsS.slice(1), tl.totalS].map((s, i, all) => (
          <span key={s} className="absolute whitespace-nowrap" style={{ left: x(s), transform: i === all.length - 1 ? "translateX(-100%)" : i ? "translateX(-50%)" : undefined }}>
            {`${s.toFixed(1)}${i === all.length - 1 ? " s" : ""}`}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The TK frames from the fixture (scripts/plan-frames/top-tracks-fixtures.ts),
 * at whatever width the runner opens. data-frame-ready carries the frame
 * ("top-tracks/TK-B1") once the stand-in face has loaded and been measured.
 */
export function TopTracksFrameMount({ id }: { id: TopTracksFrameId }) {
  const inputs = useMemo(() => fixtureTrackInputs(), []);
  const [ready, setReady] = useState(false);
  const still = STILLS[id];

  useEffect(() => {
    if (still) return;
    let live = true;
    void document.fonts.load(`700 100px ${STAND_IN_FAMILY}`).then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (live) setReady(true);
        }),
      ),
    );
    return () => {
      live = false;
    };
  }, [still]);

  if (still) {
    const options: ReelOptions = { ...DEFAULT_OPTIONS, framing: still.framing, tracks: still.n, end: still.end };
    return (
      <main className="bg-black">
        <div data-frame-ready={ready ? `top-tracks/${id}` : undefined} style={{ width: 1080, height: 1920 }}>
          <TopTracksStill
            scale={1}
            framing={still.framing}
            artist={FIXTURE_ARTIST}
            kase={FIXTURE_EVENT.kitCase}
            tracks={stillTracks(inputs, still.n)}
            options={options}
            tS={still.tS}
            end={END}
            guides={still.guides}
            timeline={reelTimeline(still.snippets, still.end)}
            onReady={() => setReady(true)}
          />
        </div>
      </main>
    );
  }

  const data: TopTracksData = {
    eventCode: FIXTURE_EVENT.code,
    acts: [
      { id: "luke-dean", name: "Luke Dean" },
      { id: "enzo-siragusa", name: "Enzo Siragusa" },
    ],
    actId: "luke-dean",
    artist: FIXTURE_ARTIST,
    tracks: inputs,
    trackArtists: Object.fromEntries(FIXTURE_TRACKS.map((t) => [t.id, t.artists])),
    renders: [{ id: "r1", fileName: "P26-BDAY_luke-dean_top-tracks-ranked-5tracks-cta-on-sale_r1_9x16.mp4", status: "ready", lengthS: reelTimeline(FIXTURE_SNIPPETS_5, "date").totalS }],
    previewUrl: null,
    end: END,
    kitCase: FIXTURE_EVENT.kitCase,
  };

  return (
    <main data-frame-ready={ready ? `top-tracks/${id}` : undefined} className="min-h-screen bg-background p-4 text-sm text-foreground sm:p-8">
      <div className="mx-auto max-w-[72rem] space-y-6 rounded-lg border border-border bg-card p-4">
        {id === "TK-G" ? <LabTopTracks eventId="frame-event" data={data} initialPicks={FIXTURE_TRACKS.map((t) => t.id)} previewAt={25.9} /> : null}
        {id === "TK-F2" ? <TimelineFrame /> : null}
        {id === "TK-F3"
          ? buildTopTracksView({ eventCode: data.eventCode, acts: data.acts, actId: data.actId, artist: data.artist, tracks: inputs, picked: [], options: DEFAULT_OPTIONS })
              .rows.filter((r) => r.id === "t1" || r.id === "t3")
              .map((r) => (
                <div key={r.id} className="space-y-1">
                  <p className="text-sm font-medium">{`${r.title} · ${clock(r.wave.durationS)}`}</p>
                  <TrackWave wave={r.wave} phrase={FIXTURE_TRACKS.find((f) => f.id === r.id)!.phrase} />
                  {r.lines.map((line) => (
                    <p key={line} className="text-[11.5px] text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </div>
              ))
          : null}
      </div>
    </main>
  );
}
