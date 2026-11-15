import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Creatives } from "../../../components/steps/creatives.tsx";
import type { AdCreativeDraft } from "../../types.ts";

const LABEL = "Rotate variations in one ad (dynamic creative — not every ad account allows this)";

const enhancementsOff = {
  enabled: false,
  textOptimizations: false,
  visualEnhancements: false,
  musicEnhancements: false,
  autoVariations: false,
} as const;

function creative(overrides: Partial<AdCreativeDraft>): AdCreativeDraft {
  return {
    id: "poster",
    name: "Poster",
    sourceType: "new",
    mediaType: "image",
    assetMode: "single",
    identity: { pageId: "", instagramAccountId: "" },
    assetVariations: [
      { id: "v1", name: "Variation 1", assets: [] },
      { id: "v2", name: "Variation 2", assets: [] },
    ],
    captions: [{ id: "c", text: "" }],
    headline: "",
    description: "",
    destinationUrl: "",
    cta: "book_now",
    enhancements: enhancementsOff,
    ...overrides,
  };
}

function html(overrides: Partial<AdCreativeDraft>): string {
  return renderToStaticMarkup(
    createElement(Creatives, { creatives: [creative(overrides)], onChange() {} }),
  );
}

const shown = html({});
const hiddenOne = html({ assetVariations: [{ id: "v1", name: "Variation 1", assets: [] }] });
const hiddenDual = html({ assetMode: "dual" });
const hiddenPost = html({ sourceType: "existing_post" });

console.log(
  JSON.stringify({
    shown: shown.includes(LABEL),
    hiddenOne: hiddenOne.includes(LABEL),
    hiddenDual: hiddenDual.includes(LABEL),
    hiddenPost: hiddenPost.includes(LABEL),
  }),
);
