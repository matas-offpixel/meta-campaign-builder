/**
 * lib/db/google-search-plans.ts
 *
 * CRUD for the Google Search Campaign Creator data model (migration 096).
 * Mirrors the shape conventions in `lib/db/drafts.ts` and
 * `lib/db/tiktok-drafts.ts`, but uses an untyped `SupabaseClient` for the
 * new tables — they're not in `lib/db/database.types.ts` yet because
 * migration 096 hasn't been applied + regenerated. Ops applies via
 * Supabase MCP post-merge; a follow-up regen PR types the tables.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  GoogleSearchAdGroup,
  GoogleSearchAdGroupNode,
  GoogleSearchCampaign,
  GoogleSearchCampaignNode,
  GoogleSearchKeyword,
  GoogleSearchNegative,
  GoogleSearchPlan,
  GoogleSearchPlanDraftTree,
  GoogleSearchPlanTree,
  GoogleSearchRsa,
} from "../google-search/types.ts";

const SUPABASE_LIST_PAGE_LIMIT = 1_000;

export interface CreatePlanInput {
  user_id: string;
  name: string;
  event_id?: string | null;
  google_ads_account_id?: string | null;
  total_budget?: number | null;
  bidding_strategy?: GoogleSearchPlan["bidding_strategy"];
  geo_targets?: GoogleSearchPlan["geo_targets"];
  date_range?: GoogleSearchPlan["date_range"];
}

export async function createGoogleSearchPlan(
  supabase: SupabaseClient,
  input: CreatePlanInput,
): Promise<GoogleSearchPlan> {
  const { data, error } = await supabase
    .from("google_search_plans")
    .insert({
      user_id: input.user_id,
      event_id: input.event_id ?? null,
      google_ads_account_id: input.google_ads_account_id ?? null,
      name: input.name,
      total_budget: input.total_budget ?? null,
      bidding_strategy: input.bidding_strategy ?? "maximize_clicks",
      geo_targets: input.geo_targets ?? [],
      date_range: input.date_range ?? null,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`createGoogleSearchPlan failed: ${error?.message ?? "no row"}`);
  }
  return data as GoogleSearchPlan;
}

export async function listGoogleSearchPlansForEvent(
  supabase: SupabaseClient,
  eventId: string,
): Promise<GoogleSearchPlan[]> {
  const { data, error } = await supabase
    .from("google_search_plans")
    .select("*")
    .eq("event_id", eventId)
    .order("updated_at", { ascending: false })
    .limit(SUPABASE_LIST_PAGE_LIMIT);
  if (error) {
    throw new Error(`listGoogleSearchPlansForEvent failed: ${error.message}`);
  }
  return (data ?? []) as GoogleSearchPlan[];
}

export async function deleteGoogleSearchPlan(
  supabase: SupabaseClient,
  planId: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_plans")
    .delete()
    .eq("id", planId);
  if (error) throw new Error(`deleteGoogleSearchPlan failed: ${error.message}`);
}

// ─── Phase 3 push-back helpers ────────────────────────────────────────
//
// Per-row writers used by the Google Ads push adapter
// (`lib/google-ads/campaign-writer.ts`) to stamp `pushed_resource_name`
// onto each platform-created row. Kept tiny and per-row so partial
// success can persist incrementally — a single failing row doesn't
// roll back the rows that already succeeded.

export async function setGoogleSearchPlanStatus(
  supabase: SupabaseClient,
  planId: string,
  status: "pushed" | "partially_pushed",
  pushedAt: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_plans")
    .update({ status, pushed_at: pushedAt })
    .eq("id", planId);
  if (error) throw new Error(`setGoogleSearchPlanStatus failed: ${error.message}`);
}

export async function setGoogleSearchCampaignResource(
  supabase: SupabaseClient,
  campaignId: string,
  resourceName: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_campaigns")
    .update({ pushed_resource_name: resourceName })
    .eq("id", campaignId);
  if (error) {
    throw new Error(`setGoogleSearchCampaignResource failed: ${error.message}`);
  }
}

export async function setGoogleSearchAdGroupResource(
  supabase: SupabaseClient,
  adGroupId: string,
  resourceName: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_ad_groups")
    .update({ pushed_resource_name: resourceName })
    .eq("id", adGroupId);
  if (error) {
    throw new Error(`setGoogleSearchAdGroupResource failed: ${error.message}`);
  }
}

export async function setGoogleSearchKeywordResource(
  supabase: SupabaseClient,
  keywordId: string,
  resourceName: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_keywords")
    .update({ pushed_resource_name: resourceName })
    .eq("id", keywordId);
  if (error) {
    throw new Error(`setGoogleSearchKeywordResource failed: ${error.message}`);
  }
}

export async function setGoogleSearchNegativeResource(
  supabase: SupabaseClient,
  negativeId: string,
  resourceName: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_negatives")
    .update({ pushed_resource_name: resourceName })
    .eq("id", negativeId);
  if (error) {
    throw new Error(`setGoogleSearchNegativeResource failed: ${error.message}`);
  }
}

export async function setGoogleSearchRsaResource(
  supabase: SupabaseClient,
  rsaId: string,
  resourceName: string,
): Promise<void> {
  const { error } = await supabase
    .from("google_search_rsas")
    .update({ pushed_resource_name: resourceName })
    .eq("id", rsaId);
  if (error) {
    throw new Error(`setGoogleSearchRsaResource failed: ${error.message}`);
  }
}

/**
 * Single round-trip-ish load of the full nested plan tree. Five queries
 * scoped by the plan id (RLS enforces ownership on every table), then
 * an in-memory join. Page limit hits the 1k Supabase ceiling per
 * table — a single plan that produces >1k keywords, ad groups, or RSAs
 * is out of scope; the wizard surfaces a warning if any list saturates.
 */
export async function loadGoogleSearchPlanTree(
  supabase: SupabaseClient,
  planId: string,
): Promise<GoogleSearchPlanTree | null> {
  const { data: planRow, error: planErr } = await supabase
    .from("google_search_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();
  if (planErr) throw new Error(`loadGoogleSearchPlanTree (plan) failed: ${planErr.message}`);
  if (!planRow) return null;
  const plan = planRow as GoogleSearchPlan;

  const [campaignsRes, adGroupsRes, keywordsRes, rsasRes, negativesRes] =
    await Promise.all([
      supabase
        .from("google_search_campaigns")
        .select("*")
        .eq("plan_id", planId)
        .order("sort_order", { ascending: true })
        .limit(SUPABASE_LIST_PAGE_LIMIT),
      supabase
        .from("google_search_ad_groups")
        .select("*, campaign:google_search_campaigns!inner(plan_id)")
        .eq("campaign.plan_id", planId)
        .order("sort_order", { ascending: true })
        .limit(SUPABASE_LIST_PAGE_LIMIT),
      supabase
        .from("google_search_keywords")
        .select("*, ad_group:google_search_ad_groups!inner(campaign:google_search_campaigns!inner(plan_id))")
        .eq("ad_group.campaign.plan_id", planId)
        .limit(SUPABASE_LIST_PAGE_LIMIT),
      supabase
        .from("google_search_rsas")
        .select("*, ad_group:google_search_ad_groups!inner(campaign:google_search_campaigns!inner(plan_id))")
        .eq("ad_group.campaign.plan_id", planId)
        .limit(SUPABASE_LIST_PAGE_LIMIT),
      supabase
        .from("google_search_negatives")
        .select("*")
        .eq("plan_id", planId)
        .limit(SUPABASE_LIST_PAGE_LIMIT),
    ]);

  for (const [label, res] of Object.entries({
    campaigns: campaignsRes,
    ad_groups: adGroupsRes,
    keywords: keywordsRes,
    rsas: rsasRes,
    negatives: negativesRes,
  })) {
    if (res.error) {
      throw new Error(`loadGoogleSearchPlanTree (${label}) failed: ${res.error.message}`);
    }
  }

  const campaigns = (campaignsRes.data ?? []) as GoogleSearchCampaign[];
  const adGroups = (adGroupsRes.data ?? []) as GoogleSearchAdGroup[];
  const keywords = (keywordsRes.data ?? []) as GoogleSearchKeyword[];
  const rsas = (rsasRes.data ?? []) as GoogleSearchRsa[];
  const negatives = (negativesRes.data ?? []) as GoogleSearchNegative[];

  const keywordsByAdGroup = new Map<string, GoogleSearchKeyword[]>();
  for (const k of keywords) {
    const bucket = keywordsByAdGroup.get(k.ad_group_id) ?? [];
    bucket.push(k);
    keywordsByAdGroup.set(k.ad_group_id, bucket);
  }
  const rsasByAdGroup = new Map<string, GoogleSearchRsa[]>();
  for (const r of rsas) {
    const bucket = rsasByAdGroup.get(r.ad_group_id) ?? [];
    bucket.push(r);
    rsasByAdGroup.set(r.ad_group_id, bucket);
  }
  const adGroupsByCampaign = new Map<string, GoogleSearchAdGroupNode[]>();
  for (const ag of adGroups) {
    const node: GoogleSearchAdGroupNode = {
      ...ag,
      keywords: keywordsByAdGroup.get(ag.id) ?? [],
      rsas: rsasByAdGroup.get(ag.id) ?? [],
    };
    const bucket = adGroupsByCampaign.get(ag.campaign_id) ?? [];
    bucket.push(node);
    adGroupsByCampaign.set(ag.campaign_id, bucket);
  }
  const negativesByCampaign = new Map<string, GoogleSearchNegative[]>();
  const planNegatives: GoogleSearchNegative[] = [];
  for (const n of negatives) {
    if (n.campaign_id) {
      const bucket = negativesByCampaign.get(n.campaign_id) ?? [];
      bucket.push(n);
      negativesByCampaign.set(n.campaign_id, bucket);
    } else {
      planNegatives.push(n);
    }
  }

  const campaignNodes: GoogleSearchCampaignNode[] = campaigns.map((c) => ({
    ...c,
    ad_groups: adGroupsByCampaign.get(c.id) ?? [],
    negatives: negativesByCampaign.get(c.id) ?? [],
  }));

  return { plan, campaigns: campaignNodes, plan_negatives: planNegatives };
}

/**
 * Inserts a fresh tree (xlsx-import path). Sequential, all-or-nothing
 * within a request: the caller wraps in a try/catch and surfaces the
 * partial state. We avoid a transactional RPC for v0 to stay additive
 * to the schema; Phase 3 can move this into a Postgres function if
 * intermediate-state cleanup becomes painful.
 *
 * Returns the inserted plan id so the caller can route to the wizard.
 */
export async function createGoogleSearchPlanTreeFromDraft(
  supabase: SupabaseClient,
  userId: string,
  draft: GoogleSearchPlanDraftTree,
  options: { event_id?: string | null; google_ads_account_id?: string | null } = {},
): Promise<{ plan_id: string }> {
  const plan = await createGoogleSearchPlan(supabase, {
    user_id: userId,
    name: draft.plan.name,
    event_id: options.event_id ?? draft.plan.event_id ?? null,
    google_ads_account_id:
      options.google_ads_account_id ?? draft.plan.google_ads_account_id ?? null,
    total_budget: draft.plan.total_budget,
    bidding_strategy: draft.plan.bidding_strategy,
    geo_targets: draft.plan.geo_targets,
    date_range: draft.plan.date_range,
  });

  const campaignNameToId = new Map<string, string>();
  for (const campaignDraft of draft.campaigns) {
    const { data: campaignRow, error: campaignErr } = await supabase
      .from("google_search_campaigns")
      .insert({
        plan_id: plan.id,
        name: campaignDraft.name,
        priority: campaignDraft.priority,
        monthly_budget: campaignDraft.monthly_budget,
        daily_budget: campaignDraft.daily_budget,
        bid_adjustments: campaignDraft.bid_adjustments,
        notes: campaignDraft.notes,
        sort_order: campaignDraft.sort_order,
      })
      .select("id")
      .single();
    if (campaignErr || !campaignRow) {
      throw new Error(`Insert campaign "${campaignDraft.name}" failed: ${campaignErr?.message ?? "no row"}`);
    }
    const campaignId = (campaignRow as { id: string }).id;
    campaignNameToId.set(campaignDraft.name, campaignId);

    for (const adGroupDraft of campaignDraft.ad_groups) {
      const { data: adGroupRow, error: adGroupErr } = await supabase
        .from("google_search_ad_groups")
        .insert({
          campaign_id: campaignId,
          name: adGroupDraft.name,
          default_cpc: adGroupDraft.default_cpc,
          sort_order: adGroupDraft.sort_order,
        })
        .select("id")
        .single();
      if (adGroupErr || !adGroupRow) {
        throw new Error(`Insert ad group "${adGroupDraft.name}" failed: ${adGroupErr?.message ?? "no row"}`);
      }
      const adGroupId = (adGroupRow as { id: string }).id;

      if (adGroupDraft.keywords.length > 0) {
        const { error: kwErr } = await supabase
          .from("google_search_keywords")
          .insert(
            adGroupDraft.keywords.map((k) => ({
              ad_group_id: adGroupId,
              keyword: k.keyword,
              match_type: k.match_type,
              est_cpc_low: k.est_cpc_low,
              est_cpc_high: k.est_cpc_high,
              intent: k.intent,
              notes: k.notes,
            })),
          );
        if (kwErr) throw new Error(`Insert keywords for "${adGroupDraft.name}" failed: ${kwErr.message}`);
      }
      if (adGroupDraft.rsas.length > 0) {
        const { error: rsaErr } = await supabase
          .from("google_search_rsas")
          .insert(
            adGroupDraft.rsas.map((r) => ({
              ad_group_id: adGroupId,
              headlines: r.headlines,
              descriptions: r.descriptions,
              final_url: r.final_url,
              path1: r.path1,
              path2: r.path2,
            })),
          );
        if (rsaErr) throw new Error(`Insert RSAs for "${adGroupDraft.name}" failed: ${rsaErr.message}`);
      }
    }
  }

  if (draft.negatives.length > 0) {
    const negRows = draft.negatives.map((n) => {
      const campaignId =
        n.scope.kind === "campaign"
          ? campaignNameToId.get(n.scope.campaign_name) ?? null
          : null;
      return {
        plan_id: plan.id,
        campaign_id: campaignId,
        keyword: n.keyword,
        match_type: n.match_type,
        reason: n.reason,
      };
    });
    const { error: negErr } = await supabase
      .from("google_search_negatives")
      .insert(negRows);
    if (negErr) throw new Error(`Insert negatives failed: ${negErr.message}`);
  }

  return { plan_id: plan.id };
}

/**
 * Wizard autosave hook (Phase 2 caller). Updates the plan row in-place,
 * then nukes-and-rewrites the entire child subtree. ON DELETE CASCADE on
 * google_search_campaigns drops everything below in one statement.
 *
 * Caveat: any `pushed_resource_name` values on existing rows are lost.
 * That's fine for Phase 1/2 (no pusher yet); Phase 3 will replace this
 * with a diff-aware writer that preserves push metadata.
 */
export async function saveGoogleSearchPlanTree(
  supabase: SupabaseClient,
  tree: GoogleSearchPlanTree,
): Promise<void> {
  const { error: planErr } = await supabase
    .from("google_search_plans")
    .update({
      name: tree.plan.name,
      event_id: tree.plan.event_id,
      google_ads_account_id: tree.plan.google_ads_account_id,
      status: tree.plan.status,
      total_budget: tree.plan.total_budget,
      bidding_strategy: tree.plan.bidding_strategy,
      geo_targets: tree.plan.geo_targets,
      date_range: tree.plan.date_range,
    })
    .eq("id", tree.plan.id);
  if (planErr) throw new Error(`saveGoogleSearchPlanTree (plan update) failed: ${planErr.message}`);

  const { error: nukeErr } = await supabase
    .from("google_search_campaigns")
    .delete()
    .eq("plan_id", tree.plan.id);
  if (nukeErr) throw new Error(`saveGoogleSearchPlanTree (campaign nuke) failed: ${nukeErr.message}`);
  const { error: negNukeErr } = await supabase
    .from("google_search_negatives")
    .delete()
    .eq("plan_id", tree.plan.id);
  if (negNukeErr) throw new Error(`saveGoogleSearchPlanTree (negatives nuke) failed: ${negNukeErr.message}`);

  await createGoogleSearchPlanTreeFromDraft(
    supabase,
    tree.plan.user_id,
    treeToDraft(tree),
    {
      event_id: tree.plan.event_id,
      google_ads_account_id: tree.plan.google_ads_account_id,
    },
  );
}

function treeToDraft(tree: GoogleSearchPlanTree): GoogleSearchPlanDraftTree {
  const campaignIdToName = new Map(tree.campaigns.map((c) => [c.id, c.name]));
  return {
    plan: {
      name: tree.plan.name,
      event_id: tree.plan.event_id,
      google_ads_account_id: tree.plan.google_ads_account_id,
      status: tree.plan.status,
      total_budget: tree.plan.total_budget,
      bidding_strategy: tree.plan.bidding_strategy,
      geo_targets: tree.plan.geo_targets,
      date_range: tree.plan.date_range,
    },
    campaigns: tree.campaigns.map((c) => ({
      name: c.name,
      priority: c.priority,
      monthly_budget: c.monthly_budget,
      daily_budget: c.daily_budget,
      bid_adjustments: c.bid_adjustments,
      notes: c.notes,
      sort_order: c.sort_order,
      ad_groups: c.ad_groups.map((ag) => ({
        name: ag.name,
        default_cpc: ag.default_cpc,
        sort_order: ag.sort_order,
        keywords: ag.keywords.map((k) => ({
          keyword: k.keyword,
          match_type: k.match_type,
          est_cpc_low: k.est_cpc_low,
          est_cpc_high: k.est_cpc_high,
          intent: k.intent,
          notes: k.notes,
        })),
        rsas: ag.rsas.map((r) => ({
          headlines: r.headlines,
          descriptions: r.descriptions,
          final_url: r.final_url,
          path1: r.path1,
          path2: r.path2,
        })),
      })),
    })),
    negatives: [
      ...tree.plan_negatives.map((n) => ({
        keyword: n.keyword,
        match_type: n.match_type,
        reason: n.reason,
        scope: { kind: "plan" as const },
      })),
      ...tree.campaigns.flatMap((c) =>
        c.negatives.map((n) => ({
          keyword: n.keyword,
          match_type: n.match_type,
          reason: n.reason,
          scope: {
            kind: "campaign" as const,
            campaign_name: campaignIdToName.get(c.id) ?? c.name,
          },
        })),
      ),
    ],
    warnings: [],
  };
}
