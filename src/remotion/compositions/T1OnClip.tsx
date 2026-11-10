import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";

import { FORMAT_SIZE, claimOpacity, footageWindow, type VideoFormat } from "../../../lib/creative-lab/t1-video-frame";

export type T1OnClipProps = {
  clipUrl: string;
  format: VideoFormat;
  sourceWidth: number;
  sourceHeight: number;
  /** O41: where the footage sits under the fixed type, per format (0–1). */
  cropFocusY: number;
  cropFocusX?: number;
  inS?: number;
  fps: number;
  durationInSeconds: number;
  muted: boolean;
  /** O38 / O46: the band layer at the format's size (dithered 8-bit PNG), on from frame 0. */
  bandsUrl: string;
  /** The top block (name, details, lockup) with O6's shadow, at the format's size, on from frame 0. */
  topUrl: string;
  /** The claim with its shadow at the format's size, or null (a clip under 4.75 s, or no claim). Fades in at 1.5 s over 0.25 s (O37). */
  claimUrl: string | null;
};

/**
 * T1 on a clip (overlay templates issue 6). The type arrives as images set
 * from the kit face on the render's own machine, so the browser never loads a
 * kit font; a server render is gated by the face's licence first (O45,
 * lib/creative-lab/t1-lambda.ts). The footage covers the frame through
 * footageWindow (O41, O42: a crop, no pillarbox, no extension); the type
 * never moves with it.
 */
export function T1OnClip(props: T1OnClipProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = FORMAT_SIZE[props.format];
  const win = footageWindow({ width: props.sourceWidth, height: props.sourceHeight }, props.format, props.cropFocusY, props.cropFocusX ?? 0.5);
  const scale = out.width / win.width;
  const opacity = claimOpacity(frame / fps);
  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <OffthreadVideo
        src={props.clipUrl}
        muted={props.muted}
        startFrom={Math.round((props.inS ?? 0) * fps)}
        style={{ position: "absolute", left: -win.left * scale, top: -win.top * scale, width: props.sourceWidth * scale, height: props.sourceHeight * scale, maxWidth: "none" }}
      />
      <Img src={props.bandsUrl} style={{ position: "absolute", left: 0, top: 0, width: out.width, height: out.height }} />
      <Img src={props.topUrl} style={{ position: "absolute", left: 0, top: 0, width: out.width, height: out.height }} />
      {props.claimUrl ? <Img src={props.claimUrl} style={{ position: "absolute", left: 0, top: 0, width: out.width, height: out.height, opacity }} /> : null}
    </AbsoluteFill>
  );
}
