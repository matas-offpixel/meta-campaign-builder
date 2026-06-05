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
        width={1080}
        height={1920}
        defaultProps={photoReelDefaultProps}
      />
    </>
  );
}

registerRoot(RemotionRoot);
