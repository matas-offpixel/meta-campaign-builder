import {
  buildTikTokPreflightChecks,
  suggestTikTokAdGroups,
} from "./review.ts";
import { stripLockedEventCodePrefix } from "./campaign-setup.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";

export interface TikTokBriefContext {
  eventName?: string | null;
  eventDate?: string | null;
  clientName?: string | null;
  advertiserName?: string | null;
}

export function buildTikTokBriefMarkdown(
  draft: TikTokCampaignDraft,
  context: TikTokBriefContext = {},
): string {
  const checks = buildTikTokPreflightChecks(draft);
  const adGroups = suggestTikTokAdGroups(draft);
  const lines: string[] = [
    `# ${briefTitle(draft)}`,
    "",
    "## Overview",
    `- Event: ${valueWithDate(context.eventName, context.eventDate)}`,
    `- Client: ${value(context.clientName)}`,
    `- TikTok advertiser: ${value(context.advertiserName ?? draft.accountSetup.advertiserId)}`,
    "",
    "## Campaign config",
    `- Objective: ${value(draft.campaignSetup.objective)}`,
    `- Optimisation goal: ${value(draft.campaignSetup.optimisationGoal)}`,
    `- Bid strategy: ${value(draft.campaignSetup.bidStrategy)}${draft.optimisation.smartPlusEnabled ? " (Smart+)" : ""}`,
    "",
    "## Optimisation",
    `- Pacing: ${value(draft.optimisation.pacing)}`,
    `- Benchmarks: CPV ${money(draft.optimisation.benchmarkCpv)}, CPC ${money(draft.optimisation.benchmarkCpc)}, CPM ${money(draft.optimisation.benchmarkCpm)}`,
    `- Guardrails: max daily ${money(draft.optimisation.maxDailySpend)}, max lifetime ${money(draft.optimisation.maxLifetimeSpend)}`,
    "",
    "## Audiences",
    `- Locations: ${list(draft.audiences.locationCodes)}`,
    `- Demographics: ages ${draft.audiences.ageMin}-${draft.audiences.ageMax}, gender ${list(draft.audiences.genders)}, languages ${list(draft.audiences.languages)}`,
    `- Interest categories: ${recordValues(draft.audiences.interestCategoryLabels)}`,
    `- Behaviours: ${recordValues(draft.audiences.behaviourCategoryLabels)}`,
    `- Custom audiences: ${recordValues(draft.audiences.customAudienceLabels)}`,
    `- Lookalikes: ${recordValues(draft.audiences.lookalikeAudienceLabels)}`,
    "",
    "## Budget & schedule",
    `- Mode: ${value(draft.budgetSchedule.budgetMode)}`,
    `- Amount: ${money(draft.budgetSchedule.budgetAmount)}`,
    `- Schedule: ${value(draft.budgetSchedule.scheduleStartAt)} → ${value(draft.budgetSchedule.scheduleEndAt)}`,
    `- Frequency cap: ${value(draft.budgetSchedule.frequencyCap)}`,
    "",
    "## Creatives",
  ];

  if (draft.creatives.items.length === 0) {
    lines.push("No creatives configured");
  } else {
    draft.creatives.items.forEach((creative, index) => {
      lines.push(
        "",
        `### ${value(creative.baseName || creative.name)} · v${index + 1}`,
        `- Video: ${value(creative.videoId)} (${value(creative.thumbnailUrl)})`,
        `- Ad text: ${value(creative.adText)}`,
        `- Display name: ${value(creative.displayName)}`,
        `- Landing page: ${value(creative.landingPageUrl)}`,
        `- CTA: ${value(creative.cta)}`,
      );
    });
  }

  lines.push("", "## Assignments");
  if (draft.creatives.items.length === 0 || adGroups.length === 0) {
    lines.push("No creative assignments configured");
  } else {
    lines.push(
      `| Creative | ${adGroups.map((adGroup) => escapeTableCell(adGroup.name)).join(" | ")} |`,
      `| --- | ${adGroups.map(() => "---").join(" | ")} |`,
    );
    draft.creatives.items.forEach((creative) => {
      lines.push(
        `| ${escapeTableCell(creative.name)} | ${adGroups
          .map((adGroup) =>
            (draft.creativeAssignments.byAdGroupId[adGroup.id] ?? []).includes(
              creative.id,
            )
              ? "✓"
              : "✗",
          )
          .join(" | ")} |`,
      );
    });
  }

  lines.push(
    "",
    "## Pre-flight checks",
    ...checks.map((check) => `- ${check.severity === "green" ? "✓" : "✗"} ${check.label}: ${check.detail}`),
    "",
  );

  return lines.join("\n");
}

export function buildTikTokBriefFilename(draft: TikTokCampaignDraft): string {
  return `${sanitizeFilename(briefTitle(draft))} - TikTok brief.md`;
}

function briefTitle(draft: TikTokCampaignDraft): string {
  const eventCode = draft.campaignSetup.eventCode
    ? `[${draft.campaignSetup.eventCode}]`
    : "[no-event-code]";
  const name = stripLockedEventCodePrefix(
    draft.campaignSetup.eventCode,
    draft.campaignSetup.campaignName,
  );
  return `${eventCode} ${name || "Untitled campaign"}`;
}

function value(input: string | number | null | undefined): string {
  if (input === null || input === undefined || input === "") return "Not set";
  return String(input);
}

function valueWithDate(name: string | null | undefined, date: string | null | undefined): string {
  if (!name && !date) return "Not set";
  if (!date) return value(name);
  return `${value(name)} on ${date}`;
}

function money(input: number | null | undefined): string {
  return input == null ? "Not set" : `£${input}`;
}

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "Not set";
}

function recordValues(values: Record<string, string>): string {
  return list(Object.values(values));
}

function escapeTableCell(valueToEscape: string): string {
  return valueToEscape.replaceAll("|", "\\|");
}

function sanitizeFilename(input: string): string {
  return input.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}
