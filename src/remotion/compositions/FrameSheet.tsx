import { AbsoluteFill, OffthreadVideo } from "remotion";

/**
 * Eight frames of one clip in a single still, so the text check is one
 * Lambda call. Each cell seeks to its sample time.
 */
export function FrameSheet({ src, times, fps = 30 }: { src: string; times: number[]; fps?: number }) {
  const frames = (times ?? []).slice(0, 8);
  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: "row", background: "black" }}>
      {frames.map((time, index) => (
        <OffthreadVideo
          key={`${time}-${index}`}
          src={src}
          startFrom={Math.max(0, Math.round(time * fps))}
          muted
          style={{ width: 270, height: 480, objectFit: "cover" }}
        />
      ))}
    </AbsoluteFill>
  );
}
