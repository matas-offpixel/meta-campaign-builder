import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";

import { claimOpacity } from "../../../lib/creative-lab/t1-video-frame";
import { TRIPLE_FIT, partPlacements, type PartWindow } from "../../../lib/creative-lab/triple-fit-frame";

export type TripleFitOnClipProps = {
  clipUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  /** O109: the one window all three parts share (partWindow). */
  window: PartWindow;
  inS?: number;
  fps: number;
  durationInSeconds: number;
  /** O110: true for a clip with no track, or a muted one. Otherwise its own track plays once. */
  muted: boolean;
  /** O55's bands at 1080 × 1920, anchored to the blocks and running across the seams. */
  bandsUrl: string;
  /** T1 B's top block (lockup, name) and date, at 1080 × 1920, on from frame 0. */
  topUrl: string;
  /** The claim at 1080 × 1920, or null. Fades in at 1.5 s over 0.25 s (O37). */
  claimUrl: string | null;
  /** Drafts only (H106): TF1's band, seams and parts drawn over the frame. Never set on a launched render. */
  guideUrl?: string | null;
};

/**
 * The triple-fit (overlay templates issue 16, O109–O111): one landscape clip
 * in three 1080 × 640 parts through the same window, starting on the same
 * frame, so every part shows the same source frame in every output frame.
 * One part carries the clip's sound; the others are muted, so the track
 * plays once and is never layered. The type arrives as images, as T1OnClip.
 */
export function TripleFitOnClip(props: TripleFitOnClipProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = claimOpacity(frame / fps);
  const startFrom = Math.round((props.inS ?? 0) * fps);
  const parts = partPlacements({ width: props.sourceWidth, height: props.sourceHeight }, props.window, props.muted);
  const full = { position: "absolute" as const, left: 0, top: 0, width: 1080, height: 1920 };
  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      {parts.map((p) => (
        <div key={p.part} style={{ position: "absolute", left: 0, top: p.top, width: TRIPLE_FIT.part.width, height: TRIPLE_FIT.part.height, overflow: "hidden" }}>
          <OffthreadVideo src={props.clipUrl} muted={p.muted} startFrom={startFrom} style={{ position: "absolute", ...p.video, maxWidth: "none" }} />
        </div>
      ))}
      <Img src={props.bandsUrl} style={full} />
      <Img src={props.topUrl} style={full} />
      {props.claimUrl ? <Img src={props.claimUrl} style={{ ...full, opacity }} /> : null}
      {props.guideUrl ? <Img src={props.guideUrl} style={full} /> : null}
    </AbsoluteFill>
  );
}
