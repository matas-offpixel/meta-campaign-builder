import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AssignCreatives } from "../../../components/steps/assign-creatives.tsx";
import type { AdCreativeDraft, AdSetSuggestion } from "../../types.ts";

const enhancementsOff = {
  enabled: false,
  textOptimizations: false,
  visualEnhancements: false,
  musicEnhancements: false,
  autoVariations: false,
} as const;

function creative(id: string, variations: number): AdCreativeDraft {
  return {
    id,
    name: id,
    sourceType: "new",
    mediaType: "image",
    assetMode: "single",
    identity: { pageId: "pg", instagramAccountId: "" },
    assetVariations: Array.from({ length: variations }, (_, i) => ({
      id: `${id}-v${i}`,
      name: `Variation ${i + 1}`,
      assets: [{ id: `${id}-a${i}`, aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: `h${i}` }],
    })),
    captions: [{ id: "c", text: "On sale" }],
    headline: "Show",
    description: "",
    destinationUrl: "https://example.com",
    cta: "book_now",
    enhancements: enhancementsOff,
  };
}

const adSets: AdSetSuggestion[] = [
  {
    id: "as-broad",
    name: "Broad",
    sourceType: "blank",
    sourceId: "",
    sourceName: "",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 5,
    advantagePlus: true,
    enabled: true,
  },
];

console.log(
  renderToStaticMarkup(
    createElement(AssignCreatives, {
      adSets,
      creatives: [creative("rotation", 2), creative("static", 1)],
      assignments: { "as-broad": ["rotation", "static"] },
      onChange() {},
      onSplitRotation() {},
    }),
  ),
);
