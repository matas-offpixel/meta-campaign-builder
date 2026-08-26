/**
 * Supabase glue for M.4 cross-channel shadow. The pure evaluator lives in
 * lib/optimisation/cross-channel.ts so node --test can load it; this file
 * only loads plan-linked subjects and event-day rollups.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CampaignAutomationInput } from "@/lib/optimisation/tick-runner";
import {
  aggregateChannelRollup,
  channelRollupColumns,
  crossChannelCampaignId,
  rollupWindowEndDate,
  rollupWindowStartDate,
  type ChannelRollupWindow,
  type CrossChannelName,
  type CrossChannelSubject,
} from "@/lib/optimisation/cross-channel";
import type { RuleTimeWindow } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

function anySb(supabase: SupabaseClient): AnySupabase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as unknown as any;
}

interface MetaLaunchRow {
  plan_id: string;
  draft_id: string | null;
}

interface PlanRow {
  id: string;
  event_id: string | null;
  daily_budget_tiktok: number | string | null;
  daily_budget_google: number | string | null;
  name: string | null;
  status: string | null;
}

interface LaunchChildRow {
  plan_id: string;
  draft_id: string | null;
  platform_campaign_id: string | null;
  status: string | null;
}

function asMajor(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function childIsLinked(row: LaunchChildRow | undefined): boolean {
  if (!row) return false;
  return Boolean(row.draft_id?.trim() || row.platform_campaign_id?.trim());
}

/**
 * For each opted-in Meta draft that is a plan child, emit TikTok / Google
 * subjects when that channel has a linked draft or platform campaign and
 * a non-zero plan daily split. Rules come from the Meta campaign input.
 */
export async function loadPlanLinkedChannelSubjects(
  supabase: SupabaseClient,
  metaCampaigns: CampaignAutomationInput[],
): Promise<CrossChannelSubject[]> {
  if (metaCampaigns.length === 0) return [];
  const sb = anySb(supabase);
  const byDraft = new Map(metaCampaigns.map((c) => [c.draftId, c]));
  const draftIds = [...byDraft.keys()];

  const { data: metaLaunches, error: metaErr } = await sb
    .from("campaign_plan_meta_launch")
    .select("plan_id, draft_id")
    .in("draft_id", draftIds);
  if (metaErr) {
    throw new Error(`loadPlanLinkedChannelSubjects: meta launch query failed: ${metaErr.message}`);
  }
  const launches = (metaLaunches ?? []) as MetaLaunchRow[];
  if (launches.length === 0) return [];

  const planIds = [...new Set(launches.map((row) => row.plan_id))];
  const [{ data: plans, error: planErr }, { data: tiktokRows, error: tiktokErr }, { data: googleRows, error: googleErr }] =
    await Promise.all([
      sb
        .from("campaign_plans")
        .select("id, event_id, daily_budget_tiktok, daily_budget_google, name, status")
        .in("id", planIds),
      sb
        .from("campaign_plan_tiktok_launch")
        .select("plan_id, draft_id, platform_campaign_id, status")
        .in("plan_id", planIds),
      sb
        .from("campaign_plan_google_launch")
        .select("plan_id, draft_id, platform_campaign_id, status")
        .in("plan_id", planIds),
    ]);

  if (planErr) {
    throw new Error(`loadPlanLinkedChannelSubjects: plans query failed: ${planErr.message}`);
  }
  if (tiktokErr) {
    throw new Error(`loadPlanLinkedChannelSubjects: tiktok launch query failed: ${tiktokErr.message}`);
  }
  if (googleErr) {
    throw new Error(`loadPlanLinkedChannelSubjects: google launch query failed: ${googleErr.message}`);
  }

  const planById = new Map(((plans ?? []) as PlanRow[]).map((row) => [row.id, row]));
  const tiktokByPlan = new Map(((tiktokRows ?? []) as LaunchChildRow[]).map((row) => [row.plan_id, row]));
  const googleByPlan = new Map(((googleRows ?? []) as LaunchChildRow[]).map((row) => [row.plan_id, row]));

  const subjects: CrossChannelSubject[] = [];
  for (const launch of launches) {
    const meta = launch.draft_id ? byDraft.get(launch.draft_id) : undefined;
    const plan = planById.get(launch.plan_id);
    if (!meta || !plan || plan.status === "archived") continue;
    const eventId = plan.event_id?.trim();
    if (!eventId) continue;

    const channels: Array<{
      channel: CrossChannelName;
      daily: number;
      child: LaunchChildRow | undefined;
    }> = [
      {
        channel: "tiktok",
        daily: asMajor(plan.daily_budget_tiktok),
        child: tiktokByPlan.get(plan.id),
      },
      {
        channel: "google",
        daily: asMajor(plan.daily_budget_google),
        child: googleByPlan.get(plan.id),
      },
    ];

    for (const { channel, daily, child } of channels) {
      if (daily <= 0 || !childIsLinked(child)) continue;
      subjects.push({
        planId: plan.id,
        eventId,
        metaDraftId: meta.draftId,
        channel,
        campaignId: crossChannelCampaignId(plan.id, channel, child?.platform_campaign_id),
        adAccountId: meta.adAccountId,
        dailyBudgetMajor: daily,
        optimisationStrategy: meta.optimisationStrategy,
        objective: meta.objective,
        campaignName: `${plan.name || meta.campaignName} · ${channel}`,
      });
    }
  }
  return subjects;
}

export async function fetchEventChannelRollup(
  supabase: SupabaseClient,
  eventId: string,
  channel: CrossChannelName,
  window: RuleTimeWindow,
  now: Date = new Date(),
): Promise<ChannelRollupWindow> {
  const sb = anySb(supabase);
  const cols = channelRollupColumns(channel);
  const from = rollupWindowStartDate(now, window);
  const to = rollupWindowEndDate(now);
  const { data, error } = await sb
    .from("event_daily_rollups")
    .select(`date, ${cols.spend}, ${cols.results}, ${cols.impressions}`)
    .eq("event_id", eventId)
    .gte("date", from)
    .lte("date", to);

  if (error) {
    throw new Error(`fetchEventChannelRollup: ${error.message}`);
  }
  return aggregateChannelRollup((data ?? []) as Array<Record<string, unknown>>, channel);
}
