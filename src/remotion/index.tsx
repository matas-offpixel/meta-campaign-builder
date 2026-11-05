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
import {
  outputSize,
  profile,
  styleVersion,
} from "./caption-style/profile";

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
          const version = await styleVersion();
          if (p.styleVersion && p.styleVersion !== version) {
            throw new Error(`styleVersion ${p.styleVersion} does not match the bundled profile ${version}`);
          }
          if (p.lines.length > profile.maxLines) throw new Error(`${p.lines.length} lines; at most ${profile.maxLines}`);
          const over = p.lines.find((line) => line.length > profile.charsPerLine);
          if (over) throw new Error(`"${over}" exceeds ${profile.charsPerLine} characters`);
          const size = outputSize(p.sourceWidth, p.sourceHeight, p.aspect);
          const inS = p.inS ?? 0;
          const outS = p.outS ?? p.durationInSeconds;
          const frames = p.plate === "black" ? 1 : Math.max(1, Math.round((outS - inS) * (p.fps || 30)));
          return { width: size.width, height: size.height, durationInFrames: frames, fps: p.fps || 30 };
        }}
        fps={30}
        width={720}
        height={1280}
        durationInFrames={30}
        defaultProps={captionDefaultProps}
      />
    </>
  );
}

registerRoot(RemotionRoot);
