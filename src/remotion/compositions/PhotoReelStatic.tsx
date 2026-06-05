import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";

export interface PhotoReelStaticProps {
  photos: string[];
  framesPerPhoto: number;
  /** Enable Ken-Burns slow zoom-in on each photo. Default false (static photos). */
  zoom?: boolean;
}

interface PhotoSlideProps {
  url: string;
  framesPerPhoto: number;
  zoom: boolean;
}

/**
 * Single photo slot inside a Sequence.
 * useCurrentFrame() here returns the frame local to this Sequence (0-indexed).
 *
 * Layout: single <Img> centred on the parent AbsoluteFill's black background.
 * The previous dual-layer design (blurred-cover bg + contained foreground)
 * OOM'd the 3 GB Vercel Lambda even at blur(20px) + concurrency=1, because
 * each active slide held two decoded 1080x1620 bitmaps + a GPU blur buffer.
 * Removing the background layer halves per-slide memory.
 */
function PhotoSlide({ url, framesPerPhoto, zoom }: PhotoSlideProps) {
  const frame = useCurrentFrame();
  const scale = zoom
    ? interpolate(frame, [0, Math.max(1, framesPerPhoto - 1)], [1.0, 1.04], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Img
        src={url}
        pauseWhenLoading
        style={{
          width: 1080,
          height: 1620,
          objectFit: "contain",
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      />
    </AbsoluteFill>
  );
}

/**
 * PhotoReelStatic — generic 1080×1920 photo reel at 30 fps.
 *
 * Hard cuts between photos. No cross-dissolves.
 * Photos sit centered on solid black (1080×1920) with minimal letterbox bars
 * top/bottom for portrait sources (2:3 → 9:16 leaves ~150px black each side).
 * Ken Burns zoom (1.00→1.04) is opt-in via `zoom: true`; default is static.
 *
 * durationInFrames = photos.length * framesPerPhoto (calculated via
 * calculateMetadata in src/remotion/index.tsx).
 */
export function PhotoReelStatic({ photos, framesPerPhoto, zoom = false }: PhotoReelStaticProps) {
  if (photos.length === 0) {
    return <AbsoluteFill style={{ backgroundColor: "#000" }} />;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {photos.map((url, i) => (
        <Sequence
          key={`${i}-${url}`}
          from={i * framesPerPhoto}
          durationInFrames={framesPerPhoto}
        >
          <PhotoSlide url={url} framesPerPhoto={framesPerPhoto} zoom={zoom} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
