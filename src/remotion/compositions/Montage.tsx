import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";

/**
 * M4a's 15 s montage (lib/render-templates/montage-plan.ts): sixteen clips
 * cut on the track's kicks, a white flash on each kick from the drop, and
 * the text arriving as master-size PNGs (lib/render-templates/layers.ts),
 * each changing on a cut. One master arrangement serves every ratio:
 *   - 9:16 is the master;
 *   - 4:5 is its pure centre crop (the 4:5 rectangle is y 285–1635);
 *   - 1:1 is the 4:5 arrangement at 0.8, the clips filling the square.
 * The declared track plays from the window's start; the clips are muted.
 */

export type MontageRatio = "9:16" | "4:5" | "1:1";

export type MontageProps = {
  ratio: MontageRatio;
  fps: number;
  durationInFrames: number;
  segments: { url: string; fromFrame: number; frames: number; startFromS: number; cropFocusX: number; cropFocusY: number }[];
  audioUrl: string;
  audioStartS: number;
  flashes: number[];
  /** Master-size (1080 × 1920) text layers, each on from `fromFrame` until `toFrame`. */
  layers: { url: string; fromFrame: number; toFrame: number }[];
};

export const MONTAGE_SIZE: Record<MontageRatio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
};

/** Where the master text layer sits in each ratio. */
export function layerPlacement(ratio: MontageRatio): { left: number; top: number; width: number; height: number } {
  if (ratio === "9:16") return { left: 0, top: 0, width: 1080, height: 1920 };
  if (ratio === "4:5") return { left: 0, top: -285, width: 1080, height: 1920 };
  return { left: 108, top: -228, width: 864, height: 1536 };
}

export const FLASH = { frames: 3, peak: 0.85 } as const;

export function flashOpacity(frame: number, flashes: readonly number[]): number {
  for (const k of flashes) if (frame >= k && frame < k + FLASH.frames) return FLASH.peak * (1 - (frame - k) / FLASH.frames);
  return 0;
}

export function Montage(props: MontageProps) {
  const frame = useCurrentFrame();
  const flash = flashOpacity(frame, props.flashes);
  const at = layerPlacement(props.ratio);
  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      {props.segments.map((s, i) => (
        <Sequence key={`v${i}`} from={s.fromFrame} durationInFrames={s.frames} layout="none">
          <AbsoluteFill>
            <OffthreadVideo
              src={s.url}
              muted
              startFrom={Math.round(s.startFromS * props.fps)}
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${(s.cropFocusX * 100).toFixed(2)}% ${(s.cropFocusY * 100).toFixed(2)}%` }}
            />
          </AbsoluteFill>
        </Sequence>
      ))}
      {props.audioUrl ? <Audio src={props.audioUrl} startFrom={Math.round(props.audioStartS * props.fps)} /> : null}
      {flash > 0 ? <AbsoluteFill style={{ backgroundColor: "white", opacity: flash }} /> : null}
      {props.layers.map((l, i) => (
        <Sequence key={`t${i}`} from={l.fromFrame} durationInFrames={Math.max(1, l.toFrame - l.fromFrame)} layout="none">
          <Img src={l.url} style={{ position: "absolute", left: at.left, top: at.top, width: at.width, height: at.height }} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
