/**
 * lib/google-video/validation.ts
 *
 * Review step for a YouTube video plan. Blockers stop the Editor
 * download. Warnings don't. `editorOnly` lists sheet settings the Editor
 * CSV cannot carry, to set by hand in Editor after the import.
 *
 * What goes in the file (`exportable*`): enabled entities that pass the
 * checks, and paused ones only when they are complete. A paused
 * placement without a link, or a held ad without a video, is left out
 * with a warning naming it.
 */

import { derivePlanDailyBudget } from "../google-search/budget.ts";
import { headerKey } from "../google-search/header-key.ts";
import {
  AD_FIELD_LABELS,
  AD_LIMITS,
  CONNECTED_TV,
  type AdLimitField,
  type GoogleVideoPlanDraftTree,
} from "./types.ts";
import { parseYouTubeRef, videoIdFrom } from "./youtube-url.ts";

export type VideoTreeLike = Pick<GoogleVideoPlanDraftTree, "plan" | "campaigns" | "ads">;
type Ad = VideoTreeLike["ads"][number];
type Campaign = VideoTreeLike["campaigns"][number];
type AdGroup = Campaign["ad_groups"][number];
type Placement = AdGroup["placements"][number];

export interface VideoReviewIssue {
  code:
    | "no_daily_budget"
    | "ad_over_limit"
    | "placement_unparseable"
    | "ad_video_unparseable"
    | "no_enabled_placement"
    | "ad_missing_final_url"
    | "ad_missing_video"
    | "connected_tv_included"
    | "left_out"
    | "no_cpv_bid"
    | "start_date_past"
    | "no_enabled_ad";
  message: string;
}

export interface VideoReview {
  blockers: VideoReviewIssue[];
  warnings: VideoReviewIssue[];
  /** `Setting: value` lines to set by hand in Editor. */
  editorOnly: string[];
}

export function effectivePlanDailyBudget(plan: VideoTreeLike["plan"]): number | null {
  if (plan.daily_budget != null && Number(plan.daily_budget) > 0) return Number(plan.daily_budget);
  if (!plan.start_date || !plan.end_date) return null;
  return derivePlanDailyBudget(plan.total_budget, { since: plan.start_date, until: plan.end_date });
}

export function campaignDailyBudget(plan: VideoTreeLike["plan"], campaign: Campaign): number | null {
  if (campaign.daily_budget != null && Number(campaign.daily_budget) > 0) return Number(campaign.daily_budget);
  return effectivePlanDailyBudget(plan);
}

export function adFinalUrl(plan: VideoTreeLike["plan"], ad: Ad): string | null {
  return ad.final_url?.trim() || plan.final_url?.trim() || null;
}

export function adCallToAction(plan: VideoTreeLike["plan"], ad: Ad): string | null {
  return ad.call_to_action?.trim() || plan.call_to_action?.trim() || null;
}

export function adVideoId(ad: Ad): string | null {
  return videoIdFrom(ad.video_value) ?? videoIdFrom(ad.video_id);
}

function overLimit(plan: VideoTreeLike["plan"], ad: Ad): string[] {
  const out: string[] = [];
  for (const field of Object.keys(AD_LIMITS) as AdLimitField[]) {
    const value = field === "call_to_action" ? adCallToAction(plan, ad) : ad[field];
    if (value && value.length > AD_LIMITS[field]) {
      out.push(`${AD_FIELD_LABELS[field]} "${value}" is ${value.length} characters (limit ${AD_LIMITS[field]})`);
    }
  }
  return out;
}

function adComplete(plan: VideoTreeLike["plan"], ad: Ad): boolean {
  return adVideoId(ad) != null && adFinalUrl(plan, ad) != null && overLimit(plan, ad).length === 0;
}

export function exportableAds(tree: VideoTreeLike): Ad[] {
  return tree.ads.filter((ad) => adComplete(tree.plan, ad));
}

export function exportablePlacements(adGroup: AdGroup): Placement[] {
  return adGroup.placements.filter((p) => parseYouTubeRef(p.value) != null);
}

const EXPORTED_SETTINGS = new Set([
  "campaignname",
  "campaigntype",
  "bidstrategy",
  "budgettype",
  "budget",
  "dailybudget",
  "networks",
  "finalurl",
  "displayurl",
  "calltoaction",
]);

function editorOnlyLines(tree: VideoTreeLike): string[] {
  const { plan } = tree;
  const lines: string[] = [];
  for (const row of plan.settings_rows) {
    const key = headerKey(row.setting);
    const timed = key.startsWith("start") && /\d{1,2}:\d{2}/.test(row.value);
    if (key.startsWith("start") || key.startsWith("end")) {
      if (timed) lines.push(`${row.setting}: ${row.value} (the file sets dates only)`);
      continue;
    }
    if (EXPORTED_SETTINGS.has(key)) continue;
    lines.push(`${row.setting}: ${row.value}`);
  }
  if (!plan.settings_rows.some((r) => headerKey(r.setting).includes("frequency"))) {
    if (plan.frequency_cap_per_day != null || plan.frequency_cap_per_week != null) {
      lines.push(
        `Frequency cap: ${plan.frequency_cap_per_day ?? "–"} per day, ${plan.frequency_cap_per_week ?? "–"} per week`,
      );
    }
  }
  for (const row of plan.targeting_rows) {
    const type = headerKey(row.type);
    if (type === "language") continue;
    if (type === "location" && !/presence|interest/i.test(row.setting)) continue;
    if (type === "device" && /\btv\b|connected/i.test(row.setting)) continue;
    lines.push(`${row.type}: ${row.setting}${row.value && row.value !== "—" ? ` (${row.value})` : ""}`);
  }
  return lines;
}

export function reviewGoogleVideoPlan(tree: VideoTreeLike, today: string): VideoReview {
  const { plan } = tree;
  const blockers: VideoReviewIssue[] = [];
  const warnings: VideoReviewIssue[] = [];

  for (const campaign of tree.campaigns) {
    if (campaignDailyBudget(plan, campaign) == null) {
      blockers.push({
        code: "no_daily_budget",
        message: `${campaign.name}: no daily budget. Set a daily budget, or a total budget with start and end dates.`,
      });
    }
  }

  const placements = tree.campaigns.flatMap((c) =>
    c.ad_groups.flatMap((ag) => ag.placements.map((p) => ({ campaign: c, adGroup: ag, p }))),
  );
  const enabled = placements.filter(
    ({ campaign, adGroup, p }) => campaign.status === "enabled" && adGroup.status === "enabled" && p.status === "enabled",
  );
  if (enabled.length === 0) {
    blockers.push({ code: "no_enabled_placement", message: "No enabled placement: nothing in the file would serve." });
  }
  for (const { campaign, p } of placements) {
    if (parseYouTubeRef(p.value) != null) continue;
    const where = `Placement "${p.label}" (${campaign.name}): "${p.value}" is not a YouTube video or channel link`;
    if (p.status === "enabled" && campaign.status === "enabled") {
      blockers.push({ code: "placement_unparseable", message: `${where}.` });
    } else {
      warnings.push({ code: "left_out", message: `${where}. It is paused, so it is left out of the file.` });
    }
  }

  let enabledAds = 0;
  for (const ad of tree.ads) {
    const issues: VideoReviewIssue[] = [];
    if (!adVideoId(ad)) {
      issues.push(
        ad.video_value
          ? { code: "ad_video_unparseable", message: `${ad.name}: Video "${ad.video_value}" is not a YouTube video link.` }
          : { code: "ad_missing_video", message: `${ad.name}: no video.` },
      );
    }
    if (!adFinalUrl(plan, ad)) {
      issues.push({ code: "ad_missing_final_url", message: `${ad.name}: no final URL, and the plan has none to fall back on.` });
    }
    for (const line of overLimit(plan, ad)) {
      issues.push({ code: "ad_over_limit", message: `${ad.name}: ${line}.` });
    }
    if (ad.status === "enabled") {
      enabledAds += 1;
      blockers.push(...issues);
    } else if (issues.length > 0) {
      warnings.push({
        code: "left_out",
        message: `${ad.name} is paused and left out of the file: ${issues.map((i) => i.message.replace(`${ad.name}: `, "")).join(" ")}`,
      });
    }
  }
  if (enabledAds === 0) warnings.push({ code: "no_enabled_ad", message: "No enabled ad: the ad groups would have nothing to show." });

  if (!plan.device_exclusions.includes(CONNECTED_TV)) {
    warnings.push({
      code: "connected_tv_included",
      message: "Connected TV is not excluded. A click on a TV screen cannot reach a checkout.",
    });
  }
  const cpvMissing = tree.campaigns.some((c) => c.ad_groups.some((ag) => (ag.cpv_bid ?? plan.cpv_bid) == null));
  if (cpvMissing) warnings.push({ code: "no_cpv_bid", message: "No CPV bid. Editor will ask for a Max CPV on each ad group." });
  if (plan.start_date && plan.start_date < today) {
    warnings.push({
      code: "start_date_past",
      message: `Start date ${plan.start_date} is in the past. Editor only takes today or a later date for a new campaign.`,
    });
  }

  return { blockers, warnings, editorOnly: editorOnlyLines(tree) };
}
