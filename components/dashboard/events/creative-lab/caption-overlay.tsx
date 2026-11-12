"use client";

import localFont from "next/font/local";

import { ClipSound, showSoundToggle, useClipVideo } from "@/components/dashboard/events/creative-lab/use-clip-video";
import { captionBoxInsets } from "@/lib/creative-lab/surface";
import { captionCharEm } from "@/lib/creative-lab/video-band";
import { profile } from "../../../../src/remotion/caption-style/profile";
import type { QuoteWeight } from "../../../../src/remotion/caption-style/quote-profile";

const tiktokSans = localFont({
  src: "../../../../src/remotion/fonts/TikTokSans[opsz,slnt,wdth,wght].ttf",
  display: "swap",
  adjustFontFallback: false,
});

const variation = `"opsz" 36, "slnt" 0, "wdth" ${profile.fontWidth}, "wght" ${profile.fontWeight}`;
const box = captionBoxInsets(profile.horizontalCenterPctOfWidth);

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
  mode = "caption",
  weight: _weight = 700,
  crop = false,
  time = null,
  muted = false,
  hasAudio,
  initialAudible = false,
  placementCenter = null,
  placementScale = null,
}: {
  lines: readonly string[];
  src?: string | null;
  poster?: string | null;
  compact?: boolean;
  inS?: number;
  outS?: number | null;
  mode?: "caption" | "quote";
  weight?: QuoteWeight;
  /** Feed crop. The 9:16 centre 0.28 H reads as 0.187 of this 4:5. */
  crop?: boolean;
  time?: string | null;
  muted?: boolean;
  hasAudio?: boolean | null;
  initialAudible?: boolean;
  /** Fraction of the frame height. Absent is today's spot. */
  placementCenter?: number | null;
  /** Fraction of the standard size. Absent is 1. */
  placementScale?: number | null;
}) {
  const { videoProps, rangeProps, playing, toggle, audible, toggleSound } = useClipVideo(inS, outS, { initialAudible });
  const shown = lines.map((line) => line.trim()).filter(Boolean);
  const stroke = `${profile.strokeWidthPctOfFontSize * 2}em`;
  const quoteCrop = mode === "quote" && crop;
  const centre = placementCenter ?? profile.verticalCenterPctOfSourceHeight;
  const scale = placementScale ?? 1;

  return (
    <div className={`relative w-full overflow-hidden bg-black ${quoteCrop ? "aspect-[4/5]" : "aspect-[9/16]"}`} style={{ containerType: "inline-size" }}>
      {src ? (
        <video
          {...videoProps}
          className="h-full w-full object-cover"
          src={src}
          poster={poster ?? undefined}
          playsInline
          preload="metadata"
        />
      ) : mode === "quote" ? (
        <div className="absolute inset-0" style={{ background: "linear-gradient(160deg,#2a241c,#6a5a48)", filter: muted ? "saturate(.6)" : undefined }} />
      ) : null}
      {compact ? (
        <span
          aria-hidden
          className="absolute h-0.5 -translate-y-1/2 bg-white"
          style={{ left: `${box.left}%`, right: `${box.right}%`, top: `${centre * 100}%`, outline: `1px solid ${profile.stroke}` }}
        />
      ) : shown.length ? (
        // The safe-area box: 84% of the frame, centred on the profile's
        // horizontal centre (captionBoxInsets). Lines
        // break only where the validator broke them; nothing wraps here.
        <p
          data-caption-lines={shown.length}
          className={`${tiktokSans.className} pointer-events-none absolute -translate-y-1/2 text-center whitespace-pre`}
          style={{
            left: `${box.left}%`,
            right: `${box.right}%`,
            top: `${centre * 100}%`,
            fontSize: `${profile.fontSizePctOfWidth * scale * 100}cqw`,
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
            <span
              key={index}
              data-caption-line=""
              data-caption-em={index === 0 ? [...line].reduce((em, char) => em + captionCharEm(char), 0) : undefined}
              className="block"
            >
              {line}
            </span>
          ))}
        </p>
      ) : null}
      {mode === "quote" && !src ? (
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 text-white">
          <span className="text-xs">▶</span>
          <span className="h-0.5 flex-1 bg-white/80" />
          {time ? <span className="text-[10px]">{time}</span> : null}
        </div>
      ) : src && !compact ? (
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-2">
          <button type="button" className="h-7 w-7 shrink-0 text-left text-white" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
            {playing ? "❚❚" : "▶"}
          </button>
          <input aria-label="Scrub" className="h-1 min-w-0 flex-1 accent-white" {...rangeProps} />
          {showSoundToggle(hasAudio) ? <ClipSound audible={audible} onToggle={toggleSound} placement="inline" /> : null}
        </div>
      ) : null}
    </div>
  );
}
