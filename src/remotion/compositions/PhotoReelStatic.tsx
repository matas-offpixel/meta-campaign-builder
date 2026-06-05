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
 * Layout: single <Img> filling the parent AbsoluteFill (1080×1920) with
 * objectFit: cover — photo is scaled up to cover the frame and cropped on
 * the long axis. For 2:3 portrait sources this trims ~10% off top + bottom.
 * Background blur layer was removed earlier to fit the 3 GB Vercel Lambda.
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
    <AbsoluteFill>
      <Img
        src={url}
        pauseWhenLoading
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center center",
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
 * Photos fill the entire 1080×1920 frame via objectFit: cover (crops the
 * long axis ~10% for 2:3 portrait sources). No background layer.
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
