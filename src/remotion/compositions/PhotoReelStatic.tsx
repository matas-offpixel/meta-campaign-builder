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
}

interface PhotoSlideProps {
  url: string;
  framesPerPhoto: number;
}

/**
 * Single photo slot inside a Sequence.
 * useCurrentFrame() here returns the frame local to this Sequence (0-indexed).
 */
function PhotoSlide({ url, framesPerPhoto }: PhotoSlideProps) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, Math.max(1, framesPerPhoto - 1)], [1.0, 1.04], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      {/* Background: full-cover, blurred, dark overlay */}
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img
          src={url}
          pauseWhenLoading
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(50px)",
          }}
        />
        <AbsoluteFill style={{ backgroundColor: "rgba(0,0,0,0.35)" }} />
      </AbsoluteFill>

      {/* Foreground: contain 1080×1620, centered, Ken Burns zoom */}
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
    </AbsoluteFill>
  );
}

/**
 * PhotoReelStatic — generic 1080×1920 photo reel at 30 fps.
 *
 * Hard cuts between photos. No cross-dissolves.
 * Each photo gets a subtle 1.00→1.04 Ken Burns zoom over its window.
 * Background is a blurred, darkened version of the same photo.
 *
 * durationInFrames = photos.length * framesPerPhoto (calculated via
 * calculateMetadata in src/remotion/index.tsx).
 */
export function PhotoReelStatic({ photos, framesPerPhoto }: PhotoReelStaticProps) {
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
          <PhotoSlide url={url} framesPerPhoto={framesPerPhoto} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
