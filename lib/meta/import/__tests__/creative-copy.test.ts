import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { validateStep } from "../../../validation.ts";
import {
  aspectRatioFromSize,
  extractImportedCreativeCopy,
  importedHeadlineNote,
} from "../creative-copy.ts";
import { mapMetaLiveCampaign } from "../map.ts";
import { buildMetaImportPicker, defaultMetaImportCarry } from "../picker.ts";
import { readMetaLiveCampaign } from "../readers.ts";
import type { MetaImportRecordedCall, MetaImportRequest, MetaLiveCampaignBundle } from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURED = join(HERE, "../__fixtures__/captured");
const DHB = "120249957259050453";
const DHB_ACCOUNT = "act_968594768066330";
const IRONWORKS = "52522388611107";
const IRONWORKS_ACCOUNT = "act_1967530076312";

const COPY_BLOCKER = /Primary text|Destination URL|Call to action|mode requires/;

function bundleFrom(file: string, account: string, campaignId: string): Promise<MetaLiveCampaignBundle> {
  const capture = JSON.parse(readFileSync(file, "utf8")) as { calls: MetaImportRecordedCall[] };
  const gets = capture.calls.filter((call) => call.method === "GET");
  const posts = capture.calls.filter((call) => call.method === "POST");
  let postAt = 0;
  const request: MetaImportRequest = {
    get: async (path, params) => {
      const after = params.after ?? "";
      const call = gets.find((row) => row.path === path && String(row.params.after ?? "") === after);
      if (!call) throw new Error(`no GET ${path}`);
      return call.data;
    },
    post: async () => {
      const call = posts[postAt % posts.length];
      postAt += 1;
      return call!.data;
    },
  };
  return readMetaLiveCampaign({
    adAccountId: account,
    campaignId,
    token: "token",
    request,
    sleep: async () => {},
  });
}

describe("DHB creative copy", () => {
  const bundlePromise = bundleFrom(
    join(CAPTURED, `meta-import-capture-${DHB}.json`),
    DHB_ACCOUNT,
    DHB,
  );

  it("reads bodies, url, CTA and description from asset_feed_spec, and does not use the name as the headline", async () => {
    const bundle = await bundlePromise;
    const draft = mapMetaLiveCampaign({
      bundle,
      adAccountId: DHB_ACCOUNT,
      carry: defaultMetaImportCarry(buildMetaImportPicker(bundle)),
      availability: [],
    });

    for (const name of ["Static - Ahmed", "Static - Artwork", "Motion - Ahmed"]) {
      const creative = draft.creatives.find((row) => row.name.startsWith(name));
      assert.ok(creative, name);
      assert.equal(creative.captions.length, 1);
      assert.match(creative.captions[0]!.text, /Sign up for tickets|DHB lands|Can't wait|sign up/i);
      assert.equal(creative.captions[0]!.text.length > 0, true);
      assert.equal(creative.headline, "");
      assert.notEqual(creative.headline, creative.name);
      assert.equal(creative.destinationUrl, "https://drop.cobrand.com/d/Deephousebible/dhbdubai");
      assert.equal(creative.cta, "sign_up");
      assert.match(creative.description, /DHB lands in UAE/);
      assert.equal(creative.assetMode, "dual");
      const ratios = creative.assetVariations[0]!.assets.map((asset) => asset.aspectRatio).sort();
      assert.deepEqual(ratios, ["4:5", "9:16"]);
      assert.equal(importedHeadlineNote(creative, draft.importMeta?.copyNotes), "No headline was on this creative in Meta.");
    }

    for (const creative of draft.creatives) {
      assert.notEqual(creative.headline, creative.name);
      assert.equal(creative.assetMode === "full", false);
    }

    const blockers = validateStep(4, draft).errors.filter((error) => COPY_BLOCKER.test(error));
    assert.deepEqual(blockers, []);
  });
});

describe("object_story_spec fallback", () => {
  const bundlePromise = bundleFrom(
    join(CAPTURED, `meta-import-capture-${IRONWORKS}.json`),
    IRONWORKS_ACCOUNT,
    IRONWORKS,
  );

  it("a link creative with no asset_feed_spec keeps message, link and CTA, as Single", async () => {
    const bundle = await bundlePromise;
    const draft = mapMetaLiveCampaign({
      bundle,
      adAccountId: IRONWORKS_ACCOUNT,
      carry: defaultMetaImportCarry(buildMetaImportPicker(bundle)),
      availability: [],
    });
    const creative = draft.creatives.find((row) => row.destinationUrl === "https://www.evntr.ee/jamiejones?ref=lineup" && row.mediaType === "image");
    assert.ok(creative);
    assert.equal(creative.captions.some((caption) => caption.text.length > 0), true);
    assert.equal(creative.cta, "sign_up");
    assert.equal(creative.assetMode, "single");
    assert.equal(creative.headline, "");
    assert.notEqual(creative.headline, creative.name);
    assert.ok(draft.importMeta?.dropped.some((row) => row.creativeId === creative.id && row.field === "aspect_ratio" && row.value === "not_recorded"));
  });

  it("SEE_DETAILS is dropped rather than stored as a CTA the app does not have", async () => {
    const bundle = await bundlePromise;
    const draft = mapMetaLiveCampaign({
      bundle,
      adAccountId: IRONWORKS_ACCOUNT,
      carry: defaultMetaImportCarry(buildMetaImportPicker(bundle)),
      availability: [],
      imageSizes: { bf611c0661f741402c32a21f7e193b69: { width: 1080, height: 1350 } },
    });
    const dropped = draft.importMeta?.dropped.find((row) => row.field === "call_to_action_type" && row.value === "SEE_DETAILS");
    assert.ok(dropped);
    const creative = draft.creatives.find((row) => row.id === dropped.creativeId);
    assert.equal(creative?.cta, "");
  });

  it("a measured 4:5 image with no label imports as Single 4:5", async () => {
    const bundle = await bundlePromise;
    const draft = mapMetaLiveCampaign({
      bundle,
      adAccountId: IRONWORKS_ACCOUNT,
      carry: defaultMetaImportCarry(buildMetaImportPicker(bundle)),
      availability: [],
      imageSizes: { bf611c0661f741402c32a21f7e193b69: { width: 1080, height: 1350 } },
    });
    const creative = draft.creatives.find((row) =>
      row.assetVariations[0]?.assets.some((asset) => asset.assetHash === "bf611c0661f741402c32a21f7e193b69"),
    );
    assert.ok(creative);
    assert.equal(creative.assetMode, "single");
    assert.equal(creative.assetVariations[0]?.assets[0]?.aspectRatio, "4:5");
    assert.equal(
      draft.importMeta?.dropped.some((row) => row.creativeId === creative.id && row.field === "aspect_ratio"),
      false,
    );
  });
});

describe("extractor", () => {
  it("titles become the headline and every body becomes a caption", () => {
    const copy = extractImportedCreativeCopy({
      name: "Do not use this name",
      asset_feed_spec: {
        bodies: [{ text: "First" }, { text: "Second" }],
        titles: [{ text: "The headline" }],
        descriptions: [{ text: "The description" }],
        link_urls: [{ website_url: "https://example.com/tickets" }],
        call_to_action_types: ["LEARN_MORE"],
      },
    });
    assert.deepEqual(copy.captions, ["First", "Second"]);
    assert.equal(copy.headline, "The headline");
    assert.notEqual(copy.headline, "Do not use this name");
    assert.equal(copy.description, "The description");
    assert.equal(copy.destinationUrl, "https://example.com/tickets");
    assert.equal(copy.cta, "learn_more");
    assert.equal(copy.headlineAbsent, false);
  });

  it("falls back to link_data when asset_feed_spec is absent", () => {
    const copy = extractImportedCreativeCopy({
      name: "Creative name",
      object_story_spec: {
        link_data: {
          message: "Body from the link",
          name: "Headline from the link",
          description: "Desc",
          link: "https://example.com/oss",
          call_to_action: { type: "BUY_TICKETS", value: { link: "https://example.com/cta" } },
        },
      },
    });
    assert.deepEqual(copy.captions, ["Body from the link"]);
    assert.equal(copy.headline, "Headline from the link");
    assert.equal(copy.destinationUrl, "https://example.com/oss");
    assert.equal(copy.cta, "buy_tickets");
  });

  it("a size within 8% of 4:5 is 4:5, and a distant size is not a ratio", () => {
    assert.equal(aspectRatioFromSize(1080, 1350), "4:5");
    assert.equal(aspectRatioFromSize(1080, 1920), "9:16");
    assert.equal(aspectRatioFromSize(1000, 1000), "1:1");
    assert.equal(aspectRatioFromSize(1000, 400), null);
  });

  it("the row note hides once the operator writes a headline", () => {
    const notes = [{ creativeId: "c1", text: "No headline was on this creative in Meta." }];
    assert.equal(importedHeadlineNote({ id: "c1", headline: "" }, notes), "No headline was on this creative in Meta.");
    assert.equal(importedHeadlineNote({ id: "c1", headline: "Written" }, notes), null);
    assert.equal(importedHeadlineNote({ id: "c2", headline: "" }, notes), null);
  });
});
