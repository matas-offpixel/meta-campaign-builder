import { Composition, registerRoot } from "remotion";
import type { FC } from "react";

import {
  FourTfCityStatic,
  type FourTfCityStaticProps,
} from "./compositions/FourTfCityStatic";
import {
  PhotoReelStatic,
  type PhotoReelStaticProps,
} from "./compositions/PhotoReelStatic";
import {
  CaptionOnClip,
  type CaptionOnClipProps,
} from "./compositions/CaptionOnClip";
import { FrameSheet } from "./compositions/FrameSheet";
import { T1OnClip, type T1OnClipProps } from "./compositions/T1OnClip";
import { FORMAT_SIZE } from "../../lib/creative-lab/t1-video-frame";
import {
  captionLimits,
  outputSize,
  profile,
  styleVersion,
  type CaptionSize,
} from "./caption-style/profile";
import { quoteStyleVersion } from "./caption-style/quote-profile";

const cityStaticDefaultProps: FourTfCityStaticProps = {
  city: "",
  venue: "",
  opponent_a: "",
  opponent_b: "",
  kick_off_at: "",
};

const photoReelDefaultProps: PhotoReelStaticProps = {
  photos: [],
  framesPerPhoto: 7,
};

const t1DefaultProps: T1OnClipProps = {
  clipUrl: "",
  format: "9:16",
  sourceWidth: 1080,
  sourceHeight: 1920,
  cropFocusY: 0.5,
  fps: 30,
  durationInSeconds: 1,
  muted: true,
  bandsUrl: "",
  topUrl: "",
  claimUrl: null,
};

const captionDefaultProps: CaptionOnClipProps = {
  clipUrl: "",
  lines: ["Luke Dean joins", "Enzo Siragusa for", "our 4th Birthday", "You in?"],
  styleVersion: "",
  aspect: "9:16",
  audio: "original",
  cropFocusY: 0.5,
  sourceWidth: 720,
  sourceHeight: 1280,
  fps: 30,
  durationInSeconds: 1,
  plate: "black",
};

function RemotionRoot() {
  return (
    <>
      <Composition
        id="4tfCityStatic"
        component={
          FourTfCityStatic as unknown as FC<Record<string, unknown>>
        }
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={cityStaticDefaultProps}
      />
      <Composition
        id="PhotoReelStatic"
        component={
          PhotoReelStatic as unknown as FC<Record<string, unknown>>
        }
        calculateMetadata={({ props }) => {
          const p = props as unknown as PhotoReelStaticProps;
          return {
            durationInFrames: Math.max(1, p.photos.length * p.framesPerPhoto),
          };
        }}
        fps={30}
        // 720x1280 (down from 1080x1920): the 3 GB Vercel Lambda OOMs on the
        // larger size with 40+ photos. 720p vertical is still natively accepted
        // by Reels (>=540p) and TikTok (>=540p). Cover-fit Img in PhotoReelStatic
        // uses width: "100%" / height: "100%" so no composition-side changes
        // are required to follow the frame size down.
        width={720}
        height={1280}
        defaultProps={photoReelDefaultProps}
      />
      <Composition
        id="CaptionOnClip"
        component={CaptionOnClip as unknown as FC<Record<string, unknown>>}
        calculateMetadata={async ({ props }) => {
          const p = props as unknown as CaptionOnClipProps;
          const quote = p.mode === "quote";
          const version = quote ? await quoteStyleVersion() : await styleVersion();
          if (p.styleVersion && p.styleVersion !== version) {
            throw new Error(`styleVersion ${p.styleVersion} does not match the bundled profile ${version}`);
          }
          if (p.aspect !== "9:16") throw new Error("video renders are 9:16 only");
          if (!quote) {
            const size = (p.size ?? "default") as CaptionSize;
            if (size === "long" && !profile.longApproved && !p.unapprovedProof) throw new Error("long caption size is not approved");
            const limits = captionLimits(size);
            if (!p.unapprovedProof && p.lines.length > limits.maxLines) throw new Error(`${p.lines.length} lines; at most ${limits.maxLines}`);
            const over = p.lines.find((line) => line.length > limits.charsPerLine);
            if (over) throw new Error(`"${over}" exceeds ${limits.charsPerLine} characters`);
          } else if (p.lines.length > 4) {
            throw new Error(`${p.lines.length} lines; a quote is at most 4`);
          }
          const frame = outputSize(p.sourceWidth, p.sourceHeight, p.aspect, p.cropFocusX ?? 0.5);
          const inS = p.inS ?? 0;
          const outS = p.outS ?? p.durationInSeconds;
          const frames = p.plate === "black" ? 1 : Math.max(1, Math.round((outS - inS) * (p.fps || 30)));
          return { width: frame.width, height: frame.height, durationInFrames: frames, fps: p.fps || 30 };
        }}
        fps={30}
        width={720}
        height={1280}
        durationInFrames={30}
        defaultProps={captionDefaultProps}
      />
      <Composition
        id="T1OnClip"
        component={T1OnClip as unknown as FC<Record<string, unknown>>}
        calculateMetadata={({ props }) => {
          const p = props as unknown as T1OnClipProps;
          const size = FORMAT_SIZE[p.format];
          return { width: size.width, height: size.height, fps: p.fps || 30, durationInFrames: Math.max(1, Math.round(p.durationInSeconds * (p.fps || 30))) };
        }}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={30}
        defaultProps={t1DefaultProps as unknown as Record<string, unknown>}
      />
      <Composition
        id="FrameSheet"
        component={FrameSheet as unknown as FC<Record<string, unknown>>}
        durationInFrames={1}
        fps={30}
        width={2160}
        height={480}
        defaultProps={{ src: "", times: [0.5, 1, 2, 3, 4, 5, 6, 7], fps: 30 }}
      />
    </>
  );
}

registerRoot(RemotionRoot);
