import type { ResolvedChannelDefaults } from "../clients/channel-defaults.ts";
import { VIZ_PLATFORM_LABEL, type VizPlatform } from "../viz/tokens.ts";
import type { PlanPreflightIssue } from "./preflight.ts";
import type { CampaignPlan, PlanAdapterName } from "./types.ts";

const LIVE_STATUSES = new Set(["live", "live_partial", "launching"]);

function sharePct(daily: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((daily / total) * 100);
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Canon §2.2 block (2) / item 19: an unconnected channel holding a
 * share > 0 blocks Launch. Already-live plans are untouched.
 */
export function unconnectedShareIssue(
  plan: CampaignPlan,
  resolved: ResolvedChannelDefaults,
): PlanPreflightIssue | null {
  if (LIVE_STATUSES.has(plan.status)) return null;

  const budget = plan.intent.budget;
  const total = budget.totalDaily || budget.metaDaily + budget.tiktokDaily + budget.googleDaily;
  if (total <= 0) return null;

  const channels: Array<{
    adapter: PlanAdapterName;
    platform: VizPlatform;
    daily: number;
    connected: boolean;
  }> = [
    {
      adapter: "meta",
      platform: "meta",
      daily: budget.metaDaily,
      connected: Boolean(resolved.metaAdAccount.value),
    },
    {
      adapter: "tiktok",
      platform: "tiktok",
      daily: budget.tiktokDaily,
      connected: Boolean(resolved.tiktokAdvertiser.value),
    },
    {
      adapter: "google",
      platform: "google",
      daily: budget.googleDaily,
      connected: Boolean(resolved.googleAdsCustomer.value),
    },
  ];

  const offenders = channels.filter((channel) => channel.daily > 0 && !channel.connected);
  if (offenders.length === 0) return null;

  const names = offenders.map((channel) => VIZ_PLATFORM_LABEL[channel.platform]);
  const share = sharePct(
    offenders.reduce((sum, channel) => sum + channel.daily, 0),
    total,
  );
  const message =
    names.length === 1
      ? `${names[0]} has ${share}% of the budget but no account — connect, or set ${names[0]} to 0`
      : `${joinNames(names)} hold ${share}% of the budget but no accounts — connect, or set them to 0`;

  return {
    adapter: offenders[0]!.adapter,
    id: "plan:unconnected_share",
    field: "budget",
    message,
    blocking: true,
  };
}
