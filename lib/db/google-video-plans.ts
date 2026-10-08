/**
 * lib/db/google-video-plans.ts
 *
 * CRUD for YouTube video plans (migration 190). Session-bound client:
 * RLS limits every read and write to the plan owner. Saves update rows
 * in place; the plan tree's shape (campaigns, ad groups, placements,
 * ads) comes from the import and is not added to or removed here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  GoogleVideoAd,
  GoogleVideoAdGroupNode,
  GoogleVideoCampaignNode,
  GoogleVideoPlacement,
  GoogleVideoPlan,
  GoogleVideoPlanDraftTree,
  GoogleVideoPlanStatus,
  GoogleVideoPlanTree,
} from "@/lib/google-video/types";
import { parseYouTubeRef, videoIdFrom } from "@/lib/google-video/youtube-url";

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function hydrateVideoPlan(raw: Record<string, unknown>): GoogleVideoPlan {
  return {
    ...(raw as unknown as GoogleVideoPlan),
    daily_budget: num(raw.daily_budget),
    total_budget: num(raw.total_budget),
    cpv_bid: num(raw.cpv_bid),
    frequency_cap_per_day: num(raw.frequency_cap_per_day),
    frequency_cap_per_week: num(raw.frequency_cap_per_week),
    include_video_partners: raw.include_video_partners === true,
    device_exclusions: strArray(raw.device_exclusions),
    language_codes: strArray(raw.language_codes),
    geo_targets: jsonArray(raw.geo_targets),
    settings_rows: jsonArray(raw.settings_rows),
    targeting_rows: jsonArray(raw.targeting_rows),
  };
}

export async function listGoogleVideoPlansForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<GoogleVideoPlan[]> {
  const { data, error } = await supabase
    .from("google_video_plans")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`List video plans failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(hydrateVideoPlan);
}

export async function loadGoogleVideoPlanTree(
  supabase: SupabaseClient,
  planId: string,
): Promise<GoogleVideoPlanTree | null> {
  const { data: planRow, error } = await supabase
    .from("google_video_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();
  if (error) throw new Error(`Load video plan failed: ${error.message}`);
  if (!planRow) return null;

  const [campaignsRes, adsRes] = await Promise.all([
    supabase.from("google_video_campaigns").select("*").eq("plan_id", planId).order("sort_order"),
    supabase.from("google_video_ads").select("*").eq("plan_id", planId).order("sort_order"),
  ]);
  if (campaignsRes.error) throw new Error(`Load video campaigns failed: ${campaignsRes.error.message}`);
  if (adsRes.error) throw new Error(`Load video ads failed: ${adsRes.error.message}`);
  const campaignRows = (campaignsRes.data ?? []) as Record<string, unknown>[];
  const campaignIds = campaignRows.map((c) => String(c.id));

  const adGroupsRes = campaignIds.length
    ? await supabase.from("google_video_ad_groups").select("*").in("campaign_id", campaignIds).order("sort_order")
    : { data: [], error: null };
  if (adGroupsRes.error) throw new Error(`Load video ad groups failed: ${adGroupsRes.error.message}`);
  const adGroupRows = (adGroupsRes.data ?? []) as Record<string, unknown>[];
  const adGroupIds = adGroupRows.map((g) => String(g.id));

  const placementsRes = adGroupIds.length
    ? await supabase.from("google_video_placements").select("*").in("ad_group_id", adGroupIds).order("sort_order")
    : { data: [], error: null };
  if (placementsRes.error) throw new Error(`Load video placements failed: ${placementsRes.error.message}`);
  const placements = (placementsRes.data ?? []) as unknown as GoogleVideoPlacement[];

  const adGroups: GoogleVideoAdGroupNode[] = adGroupRows.map((g) => ({
    ...(g as unknown as GoogleVideoAdGroupNode),
    cpv_bid: num(g.cpv_bid),
    placements: placements.filter((p) => p.ad_group_id === g.id),
  }));
  const campaigns: GoogleVideoCampaignNode[] = campaignRows.map((c) => ({
    ...(c as unknown as GoogleVideoCampaignNode),
    daily_budget: num(c.daily_budget),
    ad_groups: adGroups.filter((g) => g.campaign_id === c.id),
  }));

  return {
    plan: hydrateVideoPlan(planRow as Record<string, unknown>),
    campaigns,
    ads: (adsRes.data ?? []) as unknown as GoogleVideoAd[],
  };
}

async function insertOne(
  supabase: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
  what: string,
): Promise<string> {
  const { data, error } = await supabase.from(table).insert(row).select("id").single();
  if (error || !data) throw new Error(`Insert ${what} failed: ${error?.message ?? "no row"}`);
  return (data as { id: string }).id;
}

export async function createGoogleVideoPlanTreeFromDraft(
  supabase: SupabaseClient,
  userId: string,
  draft: GoogleVideoPlanDraftTree,
  options: { event_id?: string | null; google_ads_account_id?: string | null } = {},
): Promise<{ plan_id: string }> {
  const planId = await insertOne(
    supabase,
    "google_video_plans",
    {
      ...draft.plan,
      user_id: userId,
      event_id: options.event_id ?? draft.plan.event_id,
      google_ads_account_id: options.google_ads_account_id ?? draft.plan.google_ads_account_id,
    },
    "video plan",
  );
  try {
    for (const { ad_groups, ...campaign } of draft.campaigns) {
      const campaignId = await insertOne(
        supabase,
        "google_video_campaigns",
        { ...campaign, plan_id: planId },
        `campaign "${campaign.name}"`,
      );
      for (const { placements, ...adGroup } of ad_groups) {
        const adGroupId = await insertOne(
          supabase,
          "google_video_ad_groups",
          { ...adGroup, campaign_id: campaignId },
          `ad group "${adGroup.name}"`,
        );
        if (placements.length > 0) {
          const { error } = await supabase
            .from("google_video_placements")
            .insert(placements.map((p) => ({ ...p, ad_group_id: adGroupId })));
          if (error) throw new Error(`Insert placements for "${adGroup.name}" failed: ${error.message}`);
        }
      }
    }
    if (draft.ads.length > 0) {
      const { error } = await supabase
        .from("google_video_ads")
        .insert(draft.ads.map((ad) => ({ ...ad, plan_id: planId })));
      if (error) throw new Error(`Insert ads failed: ${error.message}`);
    }
  } catch (err) {
    await supabase.from("google_video_plans").delete().eq("id", planId);
    throw err;
  }
  return { plan_id: planId };
}

const PLAN_EDITABLE = [
  "name",
  "event_id",
  "google_ads_account_id",
  "daily_budget",
  "total_budget",
  "start_date",
  "end_date",
  "cpv_bid",
  "include_video_partners",
  "device_exclusions",
  "frequency_cap_per_day",
  "frequency_cap_per_week",
  "language_codes",
  "geo_targets",
  "final_url",
  "display_url",
  "call_to_action",
] as const;

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

/** Updates every row of the tree in place. Ids not under this plan are ignored by RLS-scoped filters. */
export async function saveGoogleVideoPlanTree(
  supabase: SupabaseClient,
  tree: GoogleVideoPlanTree,
): Promise<void> {
  const planId = tree.plan.id;
  const updates: PromiseLike<{ error: { message: string } | null }>[] = [
    supabase.from("google_video_plans").update(pick(tree.plan, PLAN_EDITABLE)).eq("id", planId),
  ];
  for (const c of tree.campaigns) {
    updates.push(
      supabase
        .from("google_video_campaigns")
        .update({ name: c.name, status: c.status, daily_budget: c.daily_budget, google_campaign_resource_name: c.google_campaign_resource_name })
        .eq("id", c.id)
        .eq("plan_id", planId),
    );
    for (const ag of c.ad_groups) {
      updates.push(
        supabase
          .from("google_video_ad_groups")
          .update({ name: ag.name, status: ag.status, cpv_bid: ag.cpv_bid })
          .eq("id", ag.id)
          .eq("campaign_id", c.id),
      );
      for (const p of ag.placements) {
        const ref = parseYouTubeRef(p.value);
        updates.push(
          supabase
            .from("google_video_placements")
            .update({ label: p.label, value: p.value, kind: ref?.kind ?? null, resolved_id: ref?.id ?? null, status: p.status })
            .eq("id", p.id)
            .eq("ad_group_id", ag.id),
        );
      }
    }
  }
  for (const ad of tree.ads) {
    updates.push(
      supabase
        .from("google_video_ads")
        .update({
          name: ad.name,
          status: ad.status,
          video_value: ad.video_value,
          video_id: videoIdFrom(ad.video_value),
          final_url: ad.final_url,
          call_to_action: ad.call_to_action,
          headline: ad.headline,
          long_headline: ad.long_headline,
          description: ad.description,
        })
        .eq("id", ad.id)
        .eq("plan_id", planId),
    );
  }
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`Save video plan failed: ${failed.error.message}`);
}

export async function setGoogleVideoPlanStatus(
  supabase: SupabaseClient,
  planId: string,
  status: GoogleVideoPlanStatus,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "exported") patch.exported_at = new Date().toISOString();
  const { error } = await supabase.from("google_video_plans").update(patch).eq("id", planId);
  if (error) throw new Error(`Set video plan status failed: ${error.message}`);
}
