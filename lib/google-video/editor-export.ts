/**
 * lib/google-video/editor-export.ts
 *
 * A Google Ads Editor CSV for a YouTube video plan. The Google Ads API
 * cannot create Video campaigns
 * (https://developers.google.com/google-ads/api/docs/video/overview), so
 * the operator imports this file in Editor: Account → Import → From
 * file, then reviews and posts.
 *
 * Every header and fixed value is spelled as in a campaign Editor
 * exported with 0 errors (`__tests__/fixtures/editor-template-export.tsv`):
 * Target CPV bidding, "Responsive video" ad groups, "Responsive video ad"
 * ads with slotted copy, placements in "Website" without a scheme, and
 * locations by ID. Editor deprecates Manual CPV and in-stream ad groups.
 * The file has no TV screen or location bid modifiers, frequency cap,
 * Google TV switch or logo; Review lists them as manual steps.
 *
 * UTF-8 with a byte-order mark, comma-separated, so `£` survives.
 *
 * Pure: the same tree gives the same bytes.
 */

import { editorLocation } from "./locations.ts";
import { AD_COPY_SLOTS, type AdLimitField } from "./types.ts";
import { parseYouTubeRef } from "./youtube-url.ts";
import {
  adCopySlots,
  adFinalUrl,
  adVideoId,
  campaignBudget,
  exportableAds,
  exportablePlacements,
  type VideoTreeLike,
} from "./validation.ts";

const SLOTTED: ReadonlyArray<[label: string, field: AdLimitField]> = [
  ["Call to action", "call_to_action"],
  ["Headline", "headline"],
  ["Long headline", "long_headline"],
  ["Description", "description"],
];

function slotColumns(label: string): string[] {
  return Array.from({ length: AD_COPY_SLOTS }, (_, i) => `${label} ${i + 1}`);
}

/** In the template's column order. */
export const EDITOR_COLUMNS: readonly string[] = [
  "Campaign",
  "Campaign Type",
  "Networks",
  "Budget",
  "Budget type",
  "EU political ads",
  "Languages",
  "Bid Strategy Type",
  "Start Date",
  "End Date",
  "Ad Group",
  "Target CPV",
  "Ad Group Type",
  "ID",
  "Location",
  "Location type",
  "Website",
  "Final URL",
  "Ad type",
  "Ad Name",
  "Video ID 1",
  ...SLOTTED.flatMap(([label]) => slotColumns(label)),
  "Business name",
  "Campaign Status",
  "Ad Group Status",
  "Status",
];

type Row = Record<string, string>;

const CAMPAIGN_TYPE = "Video";
const BID_STRATEGY = "Target CPV";
const AD_GROUP_TYPE = "Responsive video";
const AD_TYPE = "Responsive video ad";
const NO_EU_POLITICAL_ADS = "Doesn't have EU political ads";

function status(value: string): string {
  return value === "paused" ? "Paused" : "Enabled";
}

function money(value: number | null | undefined): string {
  return value == null ? "" : Number(value).toFixed(2);
}

function networks(includePartners: boolean): string {
  return ["YouTube Search", "YouTube Videos", ...(includePartners ? ["Video Partners"] : [])].join(";");
}

function csvCell(value: string | undefined): string {
  const text = value ?? "";
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** `www.youtube.com/watch?v=…`, `/channel/UC…` or `/@handle`, no scheme. */
export function placementWebsite(value: string): string | null {
  const ref = parseYouTubeRef(value);
  if (!ref) return null;
  if (ref.kind === "video") return `www.youtube.com/watch?v=${ref.id}`;
  if (ref.kind === "channel") return `www.youtube.com/channel/${ref.id}`;
  return `www.youtube.com/${ref.id.startsWith("@") ? ref.id : `@${ref.id}`}`;
}

export function buildEditorRows(tree: VideoTreeLike): Row[] {
  const { plan } = tree;
  const ads = exportableAds(tree);
  const rows: Row[] = [];
  for (const campaign of tree.campaigns) {
    const name = campaign.name;
    const campaignStatus = status(campaign.status);
    const budget = campaignBudget(plan, campaign);
    rows.push({
      Campaign: name,
      "Campaign Type": CAMPAIGN_TYPE,
      Networks: networks(plan.include_video_partners),
      Budget: money(budget?.amount),
      "Budget type": budget?.type ?? "",
      "EU political ads": NO_EU_POLITICAL_ADS,
      Languages: plan.language_codes.join(";"),
      "Bid Strategy Type": BID_STRATEGY,
      "Start Date": plan.start_date ?? "",
      "End Date": plan.end_date ?? "",
      "Campaign Status": campaignStatus,
    });
    for (const adGroup of campaign.ad_groups) {
      const groupRow = { Campaign: name, "Ad Group": adGroup.name };
      const adGroupStatus = status(adGroup.status);
      rows.push({
        ...groupRow,
        "Target CPV": money(adGroup.cpv_bid ?? plan.cpv_bid),
        "Ad Group Type": AD_GROUP_TYPE,
        "Campaign Status": campaignStatus,
        "Ad Group Status": adGroupStatus,
      });
      for (const p of exportablePlacements(adGroup)) {
        rows.push({
          ...groupRow,
          Website: placementWebsite(p.value) ?? "",
          "Campaign Status": campaignStatus,
          "Ad Group Status": adGroupStatus,
          Status: status(p.status),
        });
      }
      for (const ad of ads) {
        const row: Row = {
          ...groupRow,
          "Final URL": adFinalUrl(plan, ad) ?? "",
          "Ad type": AD_TYPE,
          "Ad Name": ad.name,
          "Video ID 1": adVideoId(ad) ?? "",
          "Business name": plan.business_name?.trim() ?? "",
          "Campaign Status": campaignStatus,
          "Ad Group Status": adGroupStatus,
          Status: status(ad.status),
        };
        for (const [label, field] of SLOTTED) {
          adCopySlots(plan, ad, field).forEach((value, i) => {
            row[`${label} ${i + 1}`] = value;
          });
        }
        rows.push(row);
      }
    }
    for (const geo of plan.geo_targets) {
      const loc = geo.negative ? null : editorLocation(geo.name);
      if (!loc) continue;
      rows.push({
        Campaign: name,
        ID: loc.id,
        Location: loc.location,
        "Location type": loc.type ?? "",
        "Campaign Status": campaignStatus,
        Status: "Enabled",
      });
    }
  }
  return rows;
}

export function buildEditorCsv(tree: VideoTreeLike): string {
  const lines = [EDITOR_COLUMNS.join(",")];
  for (const row of buildEditorRows(tree)) {
    lines.push(EDITOR_COLUMNS.map((c) => csvCell(row[c])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function editorCsvFilename(planName: string): string {
  const slug = planName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "video-plan";
  return `${slug}-google-ads-editor.csv`;
}
