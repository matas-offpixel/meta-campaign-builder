import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { TikTokLaunchModeSection } from "../../../components/tiktok-wizard/launch-mode-section.tsx";
import { ReviewLaunchStep } from "../../../components/tiktok-wizard/steps/review-launch.tsx";
import {
  createDefaultTikTokDraft,
  type TikTokAttachCampaignSnapshot,
  type TikTokCampaignDraft,
} from "../../types/tiktok-draft.ts";

const CAMPAIGN: TikTokAttachCampaignSnapshot = {
  id: "1874142286754113",
  name: "Ironworks — On Sale",
  status: "ENABLE",
  objectiveType: "WEB_CONVERSIONS",
  budgetMode: "BUDGET_MODE_DAY",
  budgetOptimizeOn: true,
  automationType: "MANUAL",
  adGroupCount: 3,
  capturedAt: "2026-10-08T09:00:00.000Z",
};

function draftFor(over: Partial<TikTokCampaignDraft>): TikTokCampaignDraft {
  const draft = createDefaultTikTokDraft("render-draft");
  draft.accountSetup.advertiserId = "7000000000000000001";
  draft.campaignSetup.eventCode = "IW";
  return { ...draft, ...over };
}

const router = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
};

function render(node: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, node));
}

async function noop() {}

function openTag(html: string, label: string): string {
  const idx = html.indexOf(label);
  if (idx < 0) return "";
  const start = html.lastIndexOf("<button", idx);
  return html.slice(start, html.indexOf(">", start));
}

const allAdGroups = draftFor({ launchMode: "attach_all_adgroups", attachCampaigns: [CAMPAIGN] });
const review = render(createElement(ReviewLaunchStep, { draft: allAdGroups, onSave: noop, onOpenStep() {} }));

const reviewNew = render(createElement(ReviewLaunchStep, { draft: draftFor({}), onSave: noop, onOpenStep() {} }));

const section = render(createElement(TikTokLaunchModeSection, { draft: allAdGroups, onSave: noop }));

const smartPlus = render(
  createElement(TikTokLaunchModeSection, {
    draft: draftFor({
      launchMode: "attach_campaign",
      attachCampaigns: [{ ...CAMPAIGN, automationType: "UPGRADED_SMART_PLUS" }],
    }),
    onSave: noop,
  }),
);

const published = render(
  createElement(TikTokLaunchModeSection, {
    draft: draftFor({
      launchMode: "attach_campaign",
      attachCampaigns: [CAMPAIGN],
      status: "published",
      publishedIds: {
        campaignId: CAMPAIGN.id,
        adgroupIds: ["1"],
        adIds: ["2"],
        launchedAt: "2026-10-08T09:05:00.000Z",
        launchMode: "attach_campaign",
        campaignIds: [CAMPAIGN.id],
      },
    }),
    onSave: noop,
  }),
);

const tileTags = ["Create new campaign", "Add to existing campaign", "Add to existing ad group"].map((label) =>
  openTag(published, label),
);

process.stdout.write(
  JSON.stringify({
    reviewSummary: review.includes('aria-label="Launching into"') && review.includes("Launch creates"),
    reviewEditLink: />Edit<\/button>/.test(review),
    reviewNoPicker:
      !review.includes("What do you want to do?") &&
      !review.includes("tiktok-attach-campaign-search") &&
      !review.includes("tiktok-launch-into"),
    reviewDefaultsPaused:
      /<option value="paused" selected="">/.test(review) &&
      /<option value="live" selected="">/.test(reviewNew),
    campaignTilePressed: openTag(section, "Add to existing campaign").includes('aria-pressed="true"'),
    subTilePressed:
      openTag(section, "Attach ads to all existing ad groups").includes('aria-pressed="true"') &&
      openTag(section, "Create new ad group").includes('aria-pressed="false"'),
    cardFacts:
      section.includes("Selected campaign") &&
      section.includes(CAMPAIGN.id) &&
      section.includes("Raw objective: WEB_CONVERSIONS") &&
      section.includes("CBO on") &&
      section.includes(">ACTIVE<") &&
      section.includes(">Sales<") &&
      section.includes("Attach-all mode."),
    smartPlusBadge: smartPlus.includes("Smart+ — not supported") && smartPlus.includes("is Smart+"),
    publishedTilesDisabled: tileTags.every((tag) => tag.includes("disabled")),
    publishedNote: published.includes("Already launched: duplicate the draft to launch again."),
    publishedNoRemove: !published.includes("Remove Ironworks"),
    publishedNoSearch: !published.includes("tiktok-attach-campaign-search"),
  }),
);
