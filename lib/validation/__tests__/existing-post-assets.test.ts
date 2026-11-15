import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import type { AdCreativeDraft } from "../../types.ts";
import { validateStep } from "../../validation.ts";

function existingPost(overrides: Partial<AdCreativeDraft> = {}): AdCreativeDraft {
  return {
    id: "feed-1",
    name: "Feed Post 1",
    sourceType: "existing_post",
    mediaType: "image",
    assetMode: "dual",
    identity: { pageId: "111", instagramAccountId: "" },
    assetVariations: [
      {
        id: "var-imported",
        name: "Imported",
        assets: [
          { id: "a45", aspectRatio: "4:5", uploadStatus: "pending" },
          { id: "a916", aspectRatio: "9:16", uploadStatus: "pending" },
        ],
      },
    ],
    captions: [],
    headline: "",
    description: "",
    destinationUrl: "",
    cta: "buy_tickets",
    enhancements: {
      enabled: false,
      textOptimizations: false,
      visualEnhancements: false,
      musicEnhancements: false,
      autoVariations: false,
    },
    existingPost: {
      source: "instagram",
      postId: "18028187387911356",
      instagramAccountId: "999",
      mediaKind: "image",
    },
    ...overrides,
  };
}

describe("existing post asset checks", () => {
  it("validateStep step 4: existing-post creative with assetMode \"dual\" and no assets → no completeness or \"not yet uploaded\" errors; same creative with no post selected → still errors", () => {
    const draft = createDefaultDraft();
    draft.creatives = [existingPost()];
    const joined = validateStep(4, draft).errors.join("\n");
    assert.doesNotMatch(joined, /mode requires/);
    assert.doesNotMatch(joined, /not yet uploaded/);

    draft.creatives = [existingPost({
      existingPost: {
        source: "instagram",
        postId: "",
        instagramAccountId: "999",
        mediaKind: "image",
      },
    })];
    assert.match(validateStep(4, draft).errors.join("\n"), /Select an existing post/);

    const creatives = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../components/steps/creatives.tsx"),
      "utf8",
    );
    const newAd = creatives.slice(creatives.indexOf("NEW AD MODE"), creatives.indexOf("EXISTING POST MODE"));
    assert.match(newAd, /Media Type/);
    assert.match(newAd, /Asset Mode/);
    assert.match(newAd, /Asset Variations/);
    assert.match(newAd, /sourceType \?\? "new"\) === "new"/);
  });
});
