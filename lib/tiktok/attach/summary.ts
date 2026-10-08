import type { TikTokCampaignDraft, TikTokLaunchMode } from "../../types/tiktok-draft.ts";
import { suggestTikTokAdGroups } from "../../tiktok-wizard/review.ts";
import { tikTokAttachCreatives } from "./plan.ts";

export const TIKTOK_LAUNCH_MODE_LABELS: Record<TikTokLaunchMode, string> = {
  new: "New campaign",
  attach_campaign: "Existing campaign(s)",
  attach_adgroup: "Existing ad groups",
  attach_all_adgroups: "All ad groups in campaign(s)",
};

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Review confirmation for the attach modes; null for `"new"`. */
export function tikTokAttachConfirmMessage(draft: TikTokCampaignDraft): string | null {
  const summary = describeTikTokAttachLaunch(draft);
  if (!summary) return null;
  const state =
    draft.launchPaused === true
      ? "New ad groups and ads are created paused."
      : "New ad groups and ads are created live and deliver while their campaign and ad group are on.";
  return `Launch creates ${summary.headline}. ${state} Existing campaigns and ad groups are not changed.`;
}

/**
 * What Launch will create, where. From the selection-time snapshots —
 * `attach_all_adgroups` re-reads the ad groups at launch, so its count
 * is the one seen when the campaigns were picked.
 */
export function describeTikTokAttachLaunch(draft: TikTokCampaignDraft): {
  headline: string;
  into: string[];
} | null {
  const mode = draft.launchMode ?? "new";
  if (mode === "new") return null;

  if (mode === "attach_campaign") {
    const campaigns = draft.attachCampaigns ?? [];
    const adGroups = suggestTikTokAdGroups(draft);
    const adsPerCampaign = adGroups.reduce(
      (sum, group) =>
        sum +
        (draft.creativeAssignments.byAdGroupId[group.id] ?? []).filter((id) =>
          draft.creatives.items.some((item) => item.id === id && item.videoId),
        ).length,
      0,
    );
    return {
      headline: `${plural(adGroups.length, "ad group")} × ${plural(campaigns.length, "campaign")}, ${plural(adsPerCampaign * campaigns.length, "ad")}`,
      into: campaigns.map(
        (c) => `${c.name}${c.budgetOptimizeOn ? " (campaign budget — no ad-group budget sent)" : ""}`,
      ),
    };
  }

  const ads = tikTokAttachCreatives(draft).length;
  if (mode === "attach_adgroup") {
    const groups = draft.attachAdGroups ?? [];
    const campaigns = new Set(groups.map((g) => g.campaignId)).size;
    return {
      headline: `${plural(ads, "ad")} × ${plural(groups.length, "ad group")} in ${plural(campaigns, "campaign")}, ${plural(ads * groups.length, "ad")}`,
      into: groups.map((g) => `${g.name} — ${g.campaignName}`),
    };
  }

  const campaigns = draft.attachCampaigns ?? [];
  const known = campaigns.every((c) => c.adGroupCount != null);
  const groups = campaigns.reduce((sum, c) => sum + (c.adGroupCount ?? 0), 0);
  return {
    headline: known
      ? `${plural(ads, "ad")} × ${plural(groups, "ad group")} in ${plural(campaigns.length, "campaign")}, ${plural(ads * groups, "ad")} (ad groups as of selection; re-read at launch)`
      : `${plural(ads, "ad")} into every ad group of ${plural(campaigns.length, "campaign")} (ad groups read at launch)`,
    into: campaigns.map(
      (c) => `${c.name}${c.adGroupCount != null ? ` · ${plural(c.adGroupCount, "ad group")}` : ""}`,
    ),
  };
}
