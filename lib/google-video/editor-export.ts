/**
 * lib/google-video/editor-export.ts
 *
 * A Google Ads Editor CSV for a YouTube video plan. The Google Ads API
 * cannot create Video campaigns
 * (https://developers.google.com/google-ads/api/docs/video/overview), so
 * the operator imports this file in Editor: Account → Import → From
 * file, then reviews and posts.
 *
 * Format, per "Prepare a CSV file"
 * (https://support.google.com/google-ads/editor/answer/56368): a header
 * row, one entity per row, `;` between values in one cell. Every header
 * is a column on "CSV file columns"
 * (https://support.google.com/google-ads/editor/answer/57747). Values
 * those pages don't list are marked below; the Editor import decides.
 *
 * UTF-8 with a byte-order mark, so `£` in ad copy survives.
 *
 * Pure: the same tree gives the same bytes.
 */

import { lookupFallbackGeoConstant } from "../google-ads/geo-resolve.ts";
import { CONNECTED_TV } from "./types.ts";
import { parseYouTubeRef } from "./youtube-url.ts";
import {
  adCallToAction,
  adFinalUrl,
  adVideoId,
  campaignDailyBudget,
  exportableAds,
  exportablePlacements,
  type VideoTreeLike,
} from "./validation.ts";

export const EDITOR_COLUMNS = [
  "Campaign",
  "Campaign Type",
  "Campaign Status",
  "Budget",
  "Bid Strategy Type",
  "Networks",
  "Languages",
  "Start Date",
  "End Date",
  "TV Screen Bid Modifier",
  "Location",
  "Location ID",
  "Bid adjustment",
  "Type",
  "Ad Group",
  "Ad Group Type",
  "Ad Group Status",
  "Max CPV",
  "Placement",
  "Ad Name",
  "Video ID",
  "Headline",
  "Long headline",
  "Description",
  "Call to action",
  "Final URL",
  "Display URL",
  "Status",
] as const;

type Column = (typeof EDITOR_COLUMNS)[number];
type Row = Partial<Record<Column, string>>;

/** Documented: answer/57747 "Campaign type". */
const CAMPAIGN_TYPE = "Video";
/** Not in the CSV doc. The Editor video help (answer/6365848) names this bid strategy. */
const BID_STRATEGY = "Manual CPV";
/** Not in the CSV doc. The Editor video help (answer/6365848) names the in-stream ad group type. */
const AD_GROUP_TYPE = "In-stream";
/** Not in the CSV doc: the bid-modifier value format. Editor shows adjustments as percentages. */
const TV_EXCLUDED = "-100%";

function status(value: string): string {
  return value === "paused" ? "Paused" : "Enabled";
}

function money(value: number | null | undefined): string {
  return value == null ? "" : Number(value).toFixed(2);
}

function percent(value: number | null): string {
  if (value == null) return "";
  return `${value > 0 ? "+" : ""}${value}%`;
}

/** Documented: answer/57747 "Networks", video values. */
function networks(includePartners: boolean): string {
  return ["YouTube Search", "YouTube Videos", ...(includePartners ? ["Video Partners"] : [])].join(";");
}

function csvCell(value: string | undefined): string {
  const text = value ?? "";
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function placementUrl(value: string): string {
  return parseYouTubeRef(value)?.url ?? value;
}

export function buildEditorRows(tree: VideoTreeLike): Row[] {
  const { plan } = tree;
  const ads = exportableAds(tree);
  const rows: Row[] = [];
  for (const campaign of tree.campaigns) {
    const name = campaign.name;
    rows.push({
      Campaign: name,
      "Campaign Type": CAMPAIGN_TYPE,
      "Campaign Status": status(campaign.status),
      Budget: money(campaignDailyBudget(plan, campaign)),
      "Bid Strategy Type": BID_STRATEGY,
      Networks: networks(plan.include_video_partners),
      Languages: plan.language_codes.join(";"),
      "Start Date": plan.start_date ?? "",
      "End Date": plan.end_date ?? "",
      "TV Screen Bid Modifier": plan.device_exclusions.includes(CONNECTED_TV) ? TV_EXCLUDED : "",
    });
    for (const geo of plan.geo_targets) {
      const id = lookupFallbackGeoConstant(geo.name)?.replace("geoTargetConstants/", "") ?? "";
      rows.push({
        Campaign: name,
        Location: geo.name,
        "Location ID": id,
        "Bid adjustment": geo.negative ? "" : percent(geo.bid_modifier_pct),
        Type: geo.negative ? "Negative" : "",
      });
    }
    for (const adGroup of campaign.ad_groups) {
      rows.push({
        Campaign: name,
        "Ad Group": adGroup.name,
        "Ad Group Type": AD_GROUP_TYPE,
        "Ad Group Status": status(adGroup.status),
        "Max CPV": money(adGroup.cpv_bid ?? plan.cpv_bid),
      });
      for (const p of exportablePlacements(adGroup)) {
        rows.push({
          Campaign: name,
          "Ad Group": adGroup.name,
          Placement: placementUrl(p.value),
          Status: status(p.status),
        });
      }
      for (const ad of ads) {
        rows.push({
          Campaign: name,
          "Ad Group": adGroup.name,
          "Ad Name": ad.name,
          "Video ID": adVideoId(ad) ?? "",
          Headline: ad.headline ?? "",
          "Long headline": ad.long_headline ?? "",
          Description: ad.description ?? "",
          "Call to action": adCallToAction(plan, ad) ?? "",
          "Final URL": adFinalUrl(plan, ad) ?? "",
          "Display URL": plan.display_url ?? "",
          Status: status(ad.status),
        });
      }
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
