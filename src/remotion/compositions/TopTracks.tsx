import { AbsoluteFill, Img, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";

import { REVEAL, endState, rowState, type EndKind, type ReelTimeline, type RowsAppear } from "../../../lib/creative-tests/top-tracks/frame";

/** One piece of type, set from the kit face on the render's own machine and placed in master px. */
export type TTImage = { url: string; left: number; top: number; width: number; height: number };

export type TTRow = {
  /** The rank or rung in white, and the same in the kit accent for the playing state; null for Forever and can't-live. */
  marker: TTImage | null;
  markerAccent: TTImage | null;
  title: TTImage[];
  withLine: TTImage[];
  /** The row's text extent, for the 6 px bar; and where the empty rule sits. */
  top: number;
  bottom: number;
  ruleTop: number;
};

export type TTBackground =
  | { kind: "still"; url: string; width: number; height: number; scale: number; left: number; top: number; push: boolean; pushOriginX: number; pushOriginY: number }
  | { kind: "clips"; clips: { url: string; sourceWidth: number; sourceHeight: number; cropFocusX: number; cropFocusY: number; inS: number; fromS: number; toS: number }[] };

export type TopTracksProps = {
  fps: number;
  durationInSeconds: number;
  background: TTBackground;
  /** O25's top band and TK8's side band at its chosen step, one dithered PNG at 1080 × 1920 (O46). */
  bandsUrl: string;
  headline: TTImage[];
  /** The list top-down. */
  rows: TTRow[];
  /** Which row each snippet fills, in play order (TK4). */
  playRows: number[];
  timeline: ReelTimeline;
  rowsAppear: RowsAppear;
  end: EndKind;
  list: "left" | "right";
  /** The bar's colour: the kit accent, or white when the accent misses 3:1 (TK8). */
  barColour: string;
  barLeft: number;
  /** Empty rows' rules (Forever, can't-live): the column. */
  column: { left: number; width: number };
  /** The date end's pieces (lockup, name, date, claim), already placed; null for the no-CTA end. */
  endCard: TTImage[] | null;
  /** O36's draft stamp, or null. */
  stamp: TTImage | null;
};

function Piece({ img, opacity = 1, dx = 0 }: { img: TTImage; opacity?: number; dx?: number }) {
  if (opacity <= 0) return null;
  return <Img src={img.url} style={{ position: "absolute", left: img.left + dx, top: img.top, width: img.width, height: img.height, opacity }} />;
}

/**
 * Top tracks (docs/design-record/2026-11-18-creative-lab-top-tracks.html): one
 * 9:16 at 1080 × 1920. A still or the artist's / promoter's clips under O25's
 * top band and TK8's side band; the headline from frame 0; the list's rows
 * revealing as each snippet starts (or on its drop), the playing row in the
 * accent with its 6 px bar, played rows at 70 %; then the end (TK9). It
 * renders silent: the joined snippets are muxed on afterwards, so the reel
 * sounds exactly as its audio was checked (−14 LUFS ± 1, −1 dBTP).
 */
export function TopTracks(props: TopTracksProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const W = 1080;
  const H = 1920;
  const ends = endState(t, props.timeline, props.end);
  const outer = props.list === "left" ? -1 : 1;
  const bg = props.background;
  let backdrop: React.ReactNode = null;
  if (bg.kind === "still") {
    const k = bg.push ? 1 + 0.04 * Math.min(1, Math.max(0, t / Math.max(0.001, props.durationInSeconds))) : 1;
    backdrop = (
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${k})`, transformOrigin: `${bg.pushOriginX}px ${bg.pushOriginY}px` }}>
        <Img src={bg.url} style={{ position: "absolute", left: bg.left, top: bg.top, width: bg.width * bg.scale, height: bg.height * bg.scale, maxWidth: "none" }} />
      </div>
    );
  } else {
    backdrop = bg.clips.map((c, i) => {
      const winH = c.sourceHeight;
      const winW = Math.min(c.sourceWidth, (winH * W) / H);
      const left = Math.min(c.sourceWidth - winW, Math.max(0, c.cropFocusX * c.sourceWidth - winW / 2));
      const scale = W / winW;
      const from = Math.round(c.fromS * fps);
      const dur = Math.max(1, Math.round((c.toS - c.fromS) * fps));
      return (
        <Sequence key={i} from={from} durationInFrames={dur} layout="none">
          <OffthreadVideo src={c.url} muted startFrom={Math.round(c.inS * fps)} style={{ position: "absolute", left: -left * scale, top: 0, width: c.sourceWidth * scale, height: c.sourceHeight * scale, maxWidth: "none" }} />
        </Sequence>
      );
    });
  }
  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      {backdrop}
      <Img src={props.bandsUrl} style={{ position: "absolute", left: 0, top: 0, width: W, height: H }} />
      {props.headline.map((img, i) => (
        <Piece key={`h${i}`} img={img} opacity={ends.listOpacity} />
      ))}
      {props.rows.map((row, r) => {
        const k = props.playRows.indexOf(r);
        const s = rowState(t, k, props.timeline, props.rowsAppear);
        const hold = ends.hold;
        const markerOpacity = (hold ? 1 : s.markerOpacity) * ends.listOpacity;
        const playing = s.playing && !hold && ends.endCardOpacity === 0;
        const titleOpacity = s.titleOpacity * (hold ? 1 : s.titleLevel) * ends.listOpacity;
        const dx = outer * s.slidePx;
        return (
          <div key={`r${r}`}>
            {row.marker ? playing && row.markerAccent ? <Piece img={row.markerAccent} opacity={ends.listOpacity} /> : <Piece img={row.marker} opacity={markerOpacity} /> : null}
            {!row.marker ? (
              <div style={{ position: "absolute", left: props.column.left, top: row.ruleTop, width: props.column.width, height: 2, background: "white", opacity: REVEAL.unplayed * (1 - s.titleOpacity) * ends.listOpacity }} />
            ) : null}
            {row.title.map((img, i) => (
              <Piece key={`t${i}`} img={img} opacity={titleOpacity} dx={dx} />
            ))}
            {row.withLine.map((img, i) => (
              <Piece key={`w${i}`} img={img} opacity={titleOpacity} dx={dx} />
            ))}
            {playing ? <div style={{ position: "absolute", left: props.barLeft, top: row.top, width: 6, height: row.bottom - row.top, background: props.barColour, opacity: ends.listOpacity }} /> : null}
          </div>
        );
      })}
      {props.endCard?.map((img, i) => (
        <Piece key={`e${i}`} img={img} opacity={ends.endCardOpacity} />
      ))}
      {props.stamp ? <Piece img={props.stamp} /> : null}
    </AbsoluteFill>
  );
}
