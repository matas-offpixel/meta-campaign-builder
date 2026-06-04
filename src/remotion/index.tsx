import { Composition, registerRoot } from "remotion";
import type { FC } from "react";

import {
  FourTfCityStatic,
  type FourTfCityStaticProps,
} from "./compositions/FourTfCityStatic";

const defaultProps: FourTfCityStaticProps = {
  city: "",
  venue: "",
  opponent_a: "",
  opponent_b: "",
  kick_off_at: "",
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
        defaultProps={defaultProps}
      />
    </>
  );
}

registerRoot(RemotionRoot);
