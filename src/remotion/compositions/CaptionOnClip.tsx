import { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, Audio, cancelRender, continueRender, delayRender, OffthreadVideo } from "remotion";

import tiktokSansUrl from "../fonts/TikTokSans[opsz,slnt,wdth,wght].ttf";
import { captionInsideSafeRect, captionLayout, captionLimits, captionLineStrokes, profile, type CaptionAspect, type CaptionSize } from "../caption-style/profile";

export type CaptionAudio = "original" | "muted" | "replaced";

export type CaptionOnClipProps = {
  clipUrl: string;
  lines: string[];
  styleVersion: string;
  aspect: CaptionAspect;
  inS?: number;
  outS?: number;
  audio: CaptionAudio;
  replacementAudioUrl?: string;
  /** 0–1, the vertical centre of the 4:5 safe rectangle inside the 9:16 frame. 0.5 is centred. */
  cropFocusY: number;
  /** 0–1, horizontal centre of the 9:16 window on a source wider than 9:16. 0.5 is centred. */
  cropFocusX?: number;
  sourceWidth: number;
  sourceHeight: number;
  fps: number;
  durationInSeconds: number;
  /** "black" draws the caption alone, for the reference-frame check. */
  plate: "video" | "black";
  /** Absent is the locked default size. "long" refuses while the profile is unapproved. */
  size?: CaptionSize;
  /**
   * Local side-by-side only. Production renders never set this.
   * Lets the unapproved long size be photographed, including a line that
   * the validator would reject, so the type can be signed off.
   */
  unapprovedProof?: boolean;
};

// The full clip is extracted before this promise can resolve. 58s is not enough.
const fontHandle = delayRender("TikTok Sans", { timeoutInMilliseconds: 180_000 });
// A single weight pins the face but leaves the variable `wght` axis at its default (300).
const face = new FontFace(profile.fontFamily, `url(${tiktokSansUrl})`, { weight: "300 900", stretch: "75% 150%" });
const fontReady = face
  .load()
  .then((loaded) => {
    document.fonts.add(loaded);
    continueRender(fontHandle);
  })
  .catch((err: unknown) => {
    cancelRender(err instanceof Error ? err : new Error(String(err)));
    throw err;
  });

function variation(fontWidth: number): string {
  return `"opsz" 36, "slnt" 0, "wdth" ${fontWidth}, "wght" ${profile.fontWeight}`;
}

function measureLine(line: string, fontPx: number, fontWidth: number): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas to measure the caption");
  ctx.font = `${profile.fontWeight} ${fontPx}px "${profile.fontFamily}"`;
  // CanvasFontStretch is a keyword union. The wdth axis is a percentage.
  const axis = ctx as unknown as { fontStretch: string; fontVariationSettings: string };
  axis.fontStretch = `${fontWidth}%`;
  axis.fontVariationSettings = variation(fontWidth);
  return ctx.measureText(line).width;
}

/**
 * Burn a caption onto a 9:16 clip. The caption is static from frame 0.
 * Fails when a line is longer than the profile allows, wider than the safe
 * zone, or when any measured line leaves the 4:5 safe rectangle.
 */
export function CaptionOnClip(props: CaptionOnClipProps) {
  const size = props.size ?? "default";
  const layout = useMemo(
    () => captionLayout(props.sourceWidth, props.sourceHeight, props.aspect, props.cropFocusY, size, props.cropFocusX ?? 0.5),
    [props.sourceWidth, props.sourceHeight, props.aspect, props.cropFocusY, props.cropFocusX, size],
  );
  const { fontPx, safeWidth } = layout;
  const fontWidth = profile.fontWidth;
  const [measureHandle] = useState(() => delayRender("caption measure"));
  const [fontLoaded, setFontLoaded] = useState(false);

  useEffect(() => {
    let gone = false;
    fontReady.then(() => {
      if (!gone) setFontLoaded(true);
    }, () => {});
    return () => {
      gone = true;
    };
  }, []);

  useEffect(() => {
    let gone = false;
    (async () => {
      await fontReady;
      await document.fonts.ready;
      if (gone) return;
      if (size === "long" && !profile.longApproved && !props.unapprovedProof) {
        cancelRender(new Error("long caption size is not approved"));
        return;
      }
      const limits = captionLimits(size);
      const tooLong = props.lines.find((line) => line.length > limits.charsPerLine);
      if ((!props.unapprovedProof && props.lines.length > limits.maxLines) || tooLong) {
        cancelRender(new Error(tooLong ? `"${tooLong}" exceeds ${limits.charsPerLine} characters` : `${props.lines.length} lines`));
        return;
      }
      const widths = props.lines.map((line) => measureLine(line, fontPx, fontWidth));
      const tooWide = props.lines.find((line, i) => widths[i] > safeWidth);
      if (tooWide) {
        cancelRender(new Error(`"${tooWide}" is wider than the 9:16 safe zone`));
        return;
      }
      if (!props.unapprovedProof && !captionInsideSafeRect(layout, widths)) {
        cancelRender(new Error("caption leaves the 4:5 safe rectangle"));
        return;
      }
      continueRender(measureHandle);
    })().catch((err: unknown) => {
      cancelRender(err instanceof Error ? err : new Error(String(err)));
    });
    return () => {
      gone = true;
    };
  }, [fontPx, fontWidth, safeWidth, layout, measureHandle, props.lines, props.unapprovedProof, size]);

  const startFrom = Math.round((props.inS ?? 0) * props.fps);
  const endAt = props.outS == null ? undefined : Math.round(props.outS * props.fps);
  const videoHeight = props.sourceHeight * layout.scale;
  const strokes = captionLineStrokes(props.lines.length, layout);
  const type = {
    fontFamily: `"${profile.fontFamily}"`,
    fontWeight: profile.fontWeight,
    fontStretch: `${fontWidth}%`,
    fontVariationSettings: variation(fontWidth),
    fontSize: layout.fontPx,
    lineHeight: profile.lineHeight,
    textAlign: "center" as const,
    whiteSpace: "pre" as const,
  };

  return (
    <AbsoluteFill style={{ backgroundColor: props.plate === "black" && props.unapprovedProof ? "#00ff00" : "#000", overflow: "hidden" }}>
      {props.plate === "video" && fontLoaded ? (
        <OffthreadVideo
          src={props.clipUrl}
          startFrom={startFrom}
          endAt={endAt}
          muted={props.audio !== "original"}
          style={{
            position: "absolute",
            width: props.sourceWidth * layout.scale,
            height: videoHeight,
            top: -layout.crop.top * layout.scale,
            left: -layout.crop.left * layout.scale,
          }}
        />
      ) : null}
      {props.audio === "replaced" && props.replacementAudioUrl ? <Audio src={props.replacementAudioUrl} /> : null}
      <div
        style={{
          position: "absolute",
          left: layout.centerX,
          top: layout.centerY,
          transform: "translate(-50%, -50%)",
          ...type,
        }}
      >
        {props.lines.map((line, i) => {
          const stroke = strokes[i];
          return (
            <div key={i} style={{ position: "relative" }}>
              <div
                aria-hidden
                style={{
                  ...type,
                  position: "absolute",
                  left: 0,
                  top: 0,
                  right: 0,
                  color: "transparent",
                  WebkitTextStroke: `${stroke.drawnPx}px ${stroke.color}`,
                }}
              >
                {line}
              </div>
              <div style={{ ...type, position: "relative", color: profile.fill }}>{line}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
