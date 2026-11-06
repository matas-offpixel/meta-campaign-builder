"use client";

import localFont from "next/font/local";
import { useRef, useState } from "react";

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
  compact = false,
}: {
  lines: readonly string[];
  src?: string | null;
  compact?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const copy = lines.map((line) => line.trim()).filter(Boolean).join("\n");
  const stroke = `${profile.strokeWidthPctOfFontSize * 2}em`;

  function toggle() {
    const node = video.current;
    if (!node) return;
    if (node.paused) void node.play();
    else node.pause();
  }

  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden bg-black" style={{ containerType: "inline-size" }}>
      {src ? (
        <video
          ref={video}
          className="h-full w-full object-cover"
          src={`${src}#t=0.5`}
          muted
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            const length = event.currentTarget.duration;
            setDuration(Number.isFinite(length) ? length : 0);
          }}
          onClick={toggle}
        />
      ) : null}
      {compact ? (
        <span
          aria-hidden
          className="absolute right-[8%] left-[8%] h-0.5 -translate-y-1/2 bg-white"
          style={{ top: `${profile.verticalCenterPctOfSourceHeight * 100}%`, outline: `1px solid ${profile.stroke}` }}
        />
      ) : copy ? (
        <p
          className={`${tiktokSans.className} pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-center whitespace-pre-line`}
          style={{
            left: `${profile.horizontalCenterPctOfWidth * 100}%`,
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
          {copy}
        </p>
      ) : null}
      {src && !compact ? (
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-2">
          <button type="button" className="h-7 w-7 shrink-0 text-left text-white" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
            {playing ? "❚❚" : "▶"}
          </button>
          <input
            aria-label="Scrub"
            className="h-1 min-w-0 flex-1 accent-white"
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={duration ? Math.min(time, duration) : 0}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (video.current) video.current.currentTime = next;
              setTime(next);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
