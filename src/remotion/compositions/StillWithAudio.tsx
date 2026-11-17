import { AbsoluteFill, Img } from "remotion";

/**
 * CT1: the audio snippet static. One existing 9:16 static, unchanged, held
 * for the whole snippet at 1080 × 1920. No words are added. It renders
 * silent: the cut (fades, −14 LUFS, −1 dBTP, AAC 256 kbps) is muxed on
 * after the render without re-encoding (lib/creative-tests/snippet-render.ts),
 * so the snippet runs exactly as the preview played it.
 */
export type StillWithAudioProps = {
  imageUrl: string;
  durationInSeconds: number;
  fps: number;
};

export function StillWithAudio({ imageUrl }: StillWithAudioProps) {
  return (
    <AbsoluteFill style={{ background: "black" }}>
      {imageUrl ? <Img src={imageUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
    </AbsoluteFill>
  );
}
