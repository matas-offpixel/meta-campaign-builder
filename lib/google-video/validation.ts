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

import { derivePlanDailyBudget, inclusiveDays } from "../google-search/budget.ts";
import { headerKey } from "../google-search/header-key.ts";
import { editorLocation } from "./locations.ts";
import {
  AD_COPY_SLOTS,
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
    | "no_budget"
    | "total_budget_no_end_date"
    | "no_business_name"
    | "location_not_in_file"
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
  /** `Campaign: £150.00 campaign total` per campaign, as the file writes it. */
  budgets: string[];
  /** `Setting: value` lines to set by hand in Editor. */
  editorOnly: string[];
}

/** Editor's "Budget type" values. Editor imports "Daily" as "Avg. daily". */
export type EditorBudgetType = "Campaign total" | "Daily";

export interface CampaignBudget {
  amount: number;
  type: EditorBudgetType;
  /** Inclusive days from start to end date, when both are set. */
  days: number | null;
}

function planDays(plan: VideoTreeLike["plan"]): number | null {
  if (!plan.start_date || !plan.end_date) return null;
  return inclusiveDays({ since: plan.start_date, until: plan.end_date });
}

/** Display only: total ÷ inclusive days, or the daily budget. */
export function effectivePlanDailyBudget(plan: VideoTreeLike["plan"]): number | null {
  if (plan.daily_budget != null && Number(plan.daily_budget) > 0) return Number(plan.daily_budget);
  if (!plan.start_date || !plan.end_date) return null;
  return derivePlanDailyBudget(plan.total_budget, { since: plan.start_date, until: plan.end_date });
}

/**
 * Editor warns on an average daily budget with an end date, so a dated
 * plan is always a campaign total. The daily figure (the campaign's own,
 * else the plan's) × inclusive days, unless the campaign has no daily of
 * its own and the plan has a total, which is used as is. "Daily" only
 * when there are no start and end dates.
 */
export function campaignBudget(plan: VideoTreeLike["plan"], campaign: Campaign): CampaignBudget | null {
  const days = planDays(plan);
  const own = positive(campaign.daily_budget);
  const total = positive(plan.total_budget);
  if (own == null && total != null) return { amount: total, type: "Campaign total", days };
  const daily = own ?? positive(plan.daily_budget);
  if (daily == null) return null;
  if (days != null) return { amount: Math.round(daily * days * 100) / 100, type: "Campaign total", days };
  return { amount: daily, type: "Daily", days: null };
}

function positive(value: number | null | undefined): number | null {
  return value != null && Number(value) > 0 ? Number(value) : null;
}

export function describeBudget(budget: CampaignBudget): string {
  if (budget.type === "Daily") return `£${budget.amount.toFixed(2)} a day (no end date)`;
  const over = budget.days != null ? ` (≈ £${(budget.amount / budget.days).toFixed(2)}/day over ${budget.days} days)` : "";
  return `£${budget.amount.toFixed(2)} campaign total${over}`;
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

/** Slot 1 (CTA falls back to the plan default), then slots 2..5; blanks dropped. */
export function adCopySlots(plan: VideoTreeLike["plan"], ad: Ad, field: AdLimitField): string[] {
  const first = field === "call_to_action" ? adCallToAction(plan, ad) : ad[field]?.trim();
  const rest = (ad.extra_copy?.[field] ?? []).map((v) => v.trim());
  return [first ?? "", ...rest].filter(Boolean).slice(0, AD_COPY_SLOTS);
}

function overLimit(plan: VideoTreeLike["plan"], ad: Ad): string[] {
  const out: string[] = [];
  for (const field of Object.keys(AD_LIMITS) as AdLimitField[]) {
    for (const value of adCopySlots(plan, ad, field)) {
      if (value.length > AD_LIMITS[field]) {
        out.push(`${AD_FIELD_LABELS[field]} "${value}" is ${value.length} characters (limit ${AD_LIMITS[field]})`);
      }
    }
  }
  return out;
}

function percent(value: number): string {
  return `${value > 0 ? "+" : ""}${value}%`;
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
  if (plan.device_exclusions.includes(CONNECTED_TV)) {
    lines.push("Include Google TV: Disabled (TV screens are excluded)");
  }
  for (const geo of plan.geo_targets) {
    if (geo.negative) lines.push(`Excluded location: ${geo.name}`);
    else if (geo.bid_modifier_pct != null) lines.push(`Location bid adjustment: ${geo.name} ${percent(geo.bid_modifier_pct)}`);
  }
  lines.push("Logo: add it on each responsive video ad (an image asset)");
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

  const budgets: string[] = [];
  for (const campaign of tree.campaigns) {
    const budget = campaignBudget(plan, campaign);
    if (budget == null) {
      blockers.push({ code: "no_budget", message: `${campaign.name}: no budget. Set a total budget or a daily budget.` });
      continue;
    }
    budgets.push(`${campaign.name}: ${describeBudget(budget)}`);
    if (budget.type === "Campaign total" && !plan.end_date) {
      blockers.push({
        code: "total_budget_no_end_date",
        message: `${campaign.name}: a campaign total budget needs an end date.`,
      });
    }
  }
  if (!plan.business_name?.trim()) {
    blockers.push({ code: "no_business_name", message: "No business name. Every responsive video ad needs one; set it in Settings." });
  }
  for (const geo of plan.geo_targets) {
    if (geo.negative || editorLocation(geo.name)) continue;
    warnings.push({
      code: "location_not_in_file",
      message: `Location "${geo.name}" has no checked Google location ID, so it is left out of the file. Google has no English region targets; add the counties or cities you mean in Editor.`,
    });
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
  if (cpvMissing) warnings.push({ code: "no_cpv_bid", message: "No Target CPV. Editor will ask for one on each ad group." });
  if (plan.start_date && plan.start_date < today) {
    warnings.push({
      code: "start_date_past",
      message: `Start date ${plan.start_date} is in the past. Editor only takes today or a later date for a new campaign.`,
    });
  }

  return { blockers, warnings, budgets, editorOnly: editorOnlyLines(tree) };
}
