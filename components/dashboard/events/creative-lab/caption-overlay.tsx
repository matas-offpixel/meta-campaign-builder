"use client";

import localFont from "next/font/local";

import { ClipSound, showSoundToggle, useClipVideo } from "@/components/dashboard/events/creative-lab/use-clip-video";
import { captionBoxInsets } from "@/lib/creative-lab/surface";
import { profile } from "../../../../src/remotion/caption-style/profile";
import { quoteTextEm } from "../../../../src/remotion/caption-style/quote-measure";
import { quoteProfile, type QuoteWeight } from "../../../../src/remotion/caption-style/quote-profile";

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
  weight = 700,
  crop = false,
  time = null,
  muted = false,
  hasAudio,
  initialAudible = false,
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
}) {
  const { videoProps, rangeProps, playing, toggle, audible, toggleSound } = useClipVideo(inS, outS, { initialAudible });
  const shown = lines.map((line) => line.trim()).filter(Boolean);
  const stroke = `${profile.strokeWidthPctOfFontSize * 2}em`;
  const quoteCrop = mode === "quote" && crop;
  // Same width: a 4:5 frame is this fraction of the 9:16 height.
  const heightRatio = (5 / 4) / (16 / 9);
  const quoteSize = (quoteCrop ? quoteProfile.fontSizePctOfHeight / heightRatio : quoteProfile.fontSizePctOfHeight) * 100;
  const quotePitch = (quoteCrop ? quoteProfile.pitchPctOfHeight / heightRatio : quoteProfile.pitchPctOfHeight) * 100;
  const quoteTop = (quoteCrop ? quoteProfile.verticalCenterInFourFive : quoteProfile.verticalCenterPctOfSourceHeight) * 100;

  return (
    <div className={`relative w-full overflow-hidden bg-black ${quoteCrop ? "aspect-[4/5]" : "aspect-[9/16]"}`} style={{ containerType: mode === "quote" ? "size" : "inline-size" }}>
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
      {mode === "quote" && shown.length ? (
        <p
          className={`${tiktokSans.className} pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-center`}
          style={{
            left: `${quoteProfile.horizontalCenterPctOfWidth * 100}%`,
            top: `${quoteTop}%`,
            width: `${quoteProfile.wrapPctOfWidth * 100}%`,
            fontFamily: `"TikTok Sans", ${tiktokSans.style.fontFamily}`,
            fontSize: `${quoteSize}cqh`,
            lineHeight: `${quotePitch}cqh`,
            fontWeight: weight,
            fontKerning: "none",
            fontVariationSettings: `"opsz" 36, "slnt" 0, "wdth" 100, "wght" ${weight}`,
            color: quoteProfile.fill,
          }}
        >
          {shown.map((line, index) => (
            <span
              key={index}
              data-quote-line=""
              data-quote-em={index === 0 ? quoteTextEm(line, weight) : undefined}
              className="block"
              style={{ whiteSpace: "nowrap", width: "fit-content", marginInline: "auto" }}
            >
              {line}
            </span>
          ))}
        </p>
      ) : compact ? (
        <span
          aria-hidden
          className="absolute h-0.5 -translate-y-1/2 bg-white"
          style={{ left: `${box.left}%`, right: `${box.right}%`, top: `${profile.verticalCenterPctOfSourceHeight * 100}%`, outline: `1px solid ${profile.stroke}` }}
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
      {mode === "quote" && !src ? (
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 text-white">
          <span className="text-xs">▶</span>
          <span className="h-0.5 flex-1 bg-white/80" />
          {time ? <span className="text-[10px]">{time}</span> : null}
        </div>
      ) : src && !compact ? (
        <>
          {showSoundToggle(hasAudio) ? <ClipSound audible={audible} onToggle={toggleSound} /> : null}
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-2">
            <button type="button" className="h-7 w-7 shrink-0 text-left text-white" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
              {playing ? "❚❚" : "▶"}
            </button>
            <input aria-label="Scrub" className="h-1 min-w-0 flex-1 accent-white" {...rangeProps} />
          </div>
        </>
      ) : null}
    </div>
  );
}
