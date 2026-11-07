"use client";

import localFont from "next/font/local";

import { useClipVideo } from "@/components/dashboard/events/creative-lab/use-clip-video";
import { profile } from "../../../../src/remotion/caption-style/profile";

const tiktokSans = localFont({
  src: "../../../../src/remotion/fonts/TikTokSans[opsz,slnt,wdth,wght].ttf",
  display: "swap",
  adjustFontFallback: false,
});

const variation = `"opsz" 36, "slnt" 0, "wdth" ${profile.fontWidth}, "wght" ${profile.fontWeight}`;

/**
 * The locked caption on a 9:16 frame. The block's centre is the measured
 * point from the render (~36% down). Stroke is drawn first and the fill
 * covers the inner half, matching CaptionOnClip. At cell size the words
 * are omitted: only the band shows where the text sits.
 */
export function CaptionOverlay({
  lines,
  src,
  poster = null,
  compact = false,
  inS = 0,
  outS = null,
}: {
  lines: readonly string[];
  src?: string | null;
  poster?: string | null;
  compact?: boolean;
  inS?: number;
  outS?: number | null;
}) {
  const { videoProps, rangeProps, playing, toggle } = useClipVideo(inS, outS);
  const shown = lines.map((line) => line.trim()).filter(Boolean);
  const stroke = `${profile.strokeWidthPctOfFontSize * 2}em`;

  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden bg-black" style={{ containerType: "inline-size" }}>
      {src ? (
        <video
          {...videoProps}
          className="h-full w-full object-cover"
          src={src}
          poster={poster ?? undefined}
          muted
          playsInline
          preload="metadata"
        />
      ) : null}
      {compact ? (
        <span
          aria-hidden
          className="absolute right-[8%] left-[8%] h-0.5 -translate-y-1/2 bg-white"
          style={{ top: `${profile.verticalCenterPctOfSourceHeight * 100}%`, outline: `1px solid ${profile.stroke}` }}
        />
      ) : shown.length ? (
        // The safe-area box: 8% in from each side, 84% of the frame. Lines
        // break only where the validator broke them; nothing wraps here.
        <p
          data-caption-lines={shown.length}
          className={`${tiktokSans.className} pointer-events-none absolute right-[8%] left-[8%] -translate-y-1/2 text-center whitespace-pre`}
          style={{
            top: `${profile.verticalCenterPctOfSourceHeight * 100}%`,
            fontSize: `${profile.fontSizePctOfWidth * 100}cqw`,
            fontWeight: profile.fontWeight,
            fontStretch: `${profile.fontWidth}%`,
            fontVariationSettings: variation,
            lineHeight: profile.lineHeight,
            color: profile.fill,
            WebkitTextStroke: `${stroke} ${profile.stroke}`,
            paintOrder: "stroke fill",
          }}
        >
          {shown.map((line, index) => (
            <span key={index} data-caption-line className="block">{line}</span>
          ))}
        </p>
      ) : null}
      {src && !compact ? (
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-2">
          <button type="button" className="h-7 w-7 shrink-0 text-left text-white" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
            {playing ? "❚❚" : "▶"}
          </button>
          <input aria-label="Scrub" className="h-1 min-w-0 flex-1 accent-white" {...rangeProps} />
        </div>
      ) : null}
    </div>
  );
}
