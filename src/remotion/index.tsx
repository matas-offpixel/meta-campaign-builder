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
    </>
  );
}

registerRoot(RemotionRoot);
